import assert from "node:assert/strict"
import { test } from "node:test"
import SubagentThrottle from "../src/index.ts"

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

type Hook = (input: unknown, output: unknown) => Promise<void>
type EventHook = (input: unknown) => Promise<void>

interface PromptCall {
  path: { id: string }
  body: {
    noReply: boolean
    parts: Array<{ type: string; text: string; ignored: boolean }>
  }
}

function requireCall(promptCalls: PromptCall[], index: number): PromptCall {
  const call = promptCalls[index]
  if (call === undefined) throw new Error(`no prompt call at index ${index}`)
  return call
}

function requireTextPart(call: PromptCall): { type: string; text: string; ignored: boolean } {
  const part = call.body.parts[0]
  if (part === undefined) throw new Error("no text part")
  return part
}

function makeMockInput(promptCalls: PromptCall[] = []) {
  return {
    client: {
      app: { log: () => Promise.resolve() },
      session: {
        prompt: async (options: PromptCall) => {
          promptCalls.push(options)
          return { data: undefined }
        },
      },
    },
    project: {},
    directory: "/tmp",
    worktree: "/tmp",
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:0"),
    $: {},
  } as unknown as Parameters<typeof SubagentThrottle>[0]
}

const mockInput = makeMockInput()

test("factory returns all hooks", async () => {
  const hooks = await SubagentThrottle(mockInput, { maxParallel: 2 })
  assert.equal(typeof hooks["tool.execute.before"], "function")
  assert.equal(typeof hooks["tool.execute.after"], "function")
  assert.equal(typeof hooks.event, "function")
  assert.equal(typeof hooks.dispose, "function")
  await hooks.dispose?.()
})

test("foreground task fan-out drains FIFO through after hooks", async () => {
  const hooks = await SubagentThrottle(mockInput, { maxParallel: 2 })
  const before = hooks["tool.execute.before"] as unknown as Hook
  const after = hooks["tool.execute.after"] as unknown as Hook
  const done = Array(5).fill(false) as boolean[]
  const starts = ["c1", "c2", "c3", "c4", "c5"].map((callID, index) =>
    before({ tool: "task", sessionID: "s", callID }, { args: {}, output: "", metadata: {} }).then(() => {
      done[index] = true
    }),
  )
  await tick()
  assert.deepEqual(done, [true, true, false, false, false])

  const complete = (callID: string, childSessionID: string) =>
    after(
      { tool: "task", sessionID: "s", callID, args: {} },
      {
        title: "",
        output: `<task id="${childSessionID}" state="completed">x</task>`,
        metadata: { sessionId: childSessionID },
      },
    )
  await complete("c1", "child1")
  await tick()
  assert.equal(done[2], true)
  await complete("c2", "child2")
  await tick()
  assert.equal(done[3], true)
  await complete("c3", "child3")
  await complete("c4", "child4")
  await complete("c5", "child5")
  await Promise.all(starts)
  await hooks.dispose?.()
})

test("background task releases after child idle event", async () => {
  const hooks = await SubagentThrottle(mockInput, { maxParallel: 1 })
  const before = hooks["tool.execute.before"] as unknown as Hook
  const after = hooks["tool.execute.after"] as unknown as Hook
  await before(
    { tool: "task", sessionID: "s", callID: "bg1" },
    { args: { background: true }, output: "", metadata: {} },
  )
  await after(
    { tool: "task", sessionID: "s", callID: "bg1", args: { background: true } },
    { title: "", output: "", metadata: { sessionId: "child9" } },
  )
  let secondDone = false
  const second = before(
    { tool: "task", sessionID: "s", callID: "bg2" },
    { args: {}, output: "", metadata: {} },
  ).then(() => {
    secondDone = true
  })
  await tick()
  assert.equal(secondDone, false)
  await (hooks.event as unknown as EventHook)({
    event: { type: "session.idle", properties: { sessionID: "child9" } },
  })
  await second
  assert.equal(secondDone, true)
  await hooks.dispose?.()
})

test("task error event releases the slot", async () => {
  const hooks = await SubagentThrottle(mockInput, { maxParallel: 1 })
  const before = hooks["tool.execute.before"] as unknown as Hook
  await before({ tool: "task", sessionID: "s", callID: "cE" }, { args: {}, output: "", metadata: {} })
  await (hooks.event as unknown as EventHook)({
    event: {
      type: "message.part.updated",
      properties: {
        sessionID: "s",
        part: { type: "tool", tool: "task", callID: "cE", state: { status: "error", error: "boom" } },
        time: 1,
      },
    },
  })
  let done = false
  const next = before(
    { tool: "task", sessionID: "s", callID: "next" },
    { args: {}, output: "", metadata: {} },
  ).then(() => {
    done = true
  })
  await next
  assert.equal(done, true)
  await hooks.dispose?.()
})

test("non-task tools bypass throttling", async () => {
  const hooks = await SubagentThrottle(mockInput, { maxParallel: 1 })
  const before = hooks["tool.execute.before"] as unknown as Hook
  await before({ tool: "bash", sessionID: "s", callID: "bash" }, { args: {}, output: "", metadata: {} })
  await before({ tool: "task", sessionID: "s", callID: "task" }, { args: {}, output: "", metadata: {} })
  let done = false
  const second = before(
    { tool: "task", sessionID: "s", callID: "queued" },
    { args: {}, output: "", metadata: {} },
  ).then(() => {
    done = true
  })
  await tick()
  assert.equal(done, false)
  await hooks.dispose?.()
  await second
})

test("notifyQueue injects queued and started lines", async () => {
  const promptCalls: PromptCall[] = []
  const hooks = await SubagentThrottle(makeMockInput(promptCalls), {
    maxParallel: 1,
    notifyQueue: true,
  })
  const before = hooks["tool.execute.before"] as unknown as Hook
  const after = hooks["tool.execute.after"] as unknown as Hook

  await before(
    { tool: "task", sessionID: "s", callID: "c1" },
    { args: { description: "first" }, output: "", metadata: {} },
  )
  assert.equal(promptCalls.length, 0)
  const second = before(
    { tool: "task", sessionID: "s", callID: "c2" },
    { args: { description: "second" }, output: "", metadata: {} },
  )
  await tick()
  assert.equal(promptCalls.length, 1)
  const queuedCall = requireCall(promptCalls, 0)
  assert.equal(queuedCall.path.id, "s")
  assert.equal(queuedCall.body.noReply, true)
  const queuedPart = requireTextPart(queuedCall)
  assert.equal(queuedPart.type, "text")
  assert.equal(queuedPart.ignored, true)
  assert.match(queuedPart.text, /queued/)
  assert.match(queuedPart.text, /position 1/)
  assert.match(queuedPart.text, /second/)

  await after(
    { tool: "task", sessionID: "s", callID: "c1", args: {} },
    { title: "", output: '<task id="child1" state="completed">x</task>', metadata: { sessionId: "child1" } },
  )
  await second
  assert.equal(promptCalls.length, 2)
  assert.match(requireTextPart(requireCall(promptCalls, 1)).text, /started/)
  await hooks.dispose?.()
})

test("no injection when notifyQueue is off", async () => {
  const promptCalls: PromptCall[] = []
  const hooks = await SubagentThrottle(makeMockInput(promptCalls), { maxParallel: 1 })
  const before = hooks["tool.execute.before"] as unknown as Hook

  await before({ tool: "task", sessionID: "s", callID: "c1" }, { args: {}, output: "", metadata: {} })
  const second = before(
    { tool: "task", sessionID: "s", callID: "c2" },
    { args: {}, output: "", metadata: {} },
  )
  await tick()
  assert.equal(promptCalls.length, 0)
  await hooks.dispose?.()
  await second
})

test("background queued line marks background", async () => {
  const promptCalls: PromptCall[] = []
  const hooks = await SubagentThrottle(makeMockInput(promptCalls), {
    maxParallel: 1,
    notifyQueue: true,
  })
  const before = hooks["tool.execute.before"] as unknown as Hook

  await before({ tool: "task", sessionID: "s", callID: "c1" }, { args: {}, output: "", metadata: {} })
  const second = before(
    { tool: "task", sessionID: "s", callID: "c2" },
    { args: { background: true, description: "bg task" }, output: "", metadata: {} },
  )
  await tick()
  assert.equal(promptCalls.length, 1)
  assert.match(requireTextPart(requireCall(promptCalls, 0)).text, /, background/)
  await hooks.dispose?.()
  await second
})

test("non-task tools never trigger notifications", async () => {
  const promptCalls: PromptCall[] = []
  const hooks = await SubagentThrottle(makeMockInput(promptCalls), {
    maxParallel: 1,
    notifyQueue: true,
  })
  const before = hooks["tool.execute.before"] as unknown as Hook

  await before({ tool: "bash", sessionID: "s", callID: "b1" }, { args: {}, output: "", metadata: {} })
  await before({ tool: "read", sessionID: "s", callID: "r1" }, { args: {}, output: "", metadata: {} })
  await tick()
  assert.equal(promptCalls.length, 0)
  await hooks.dispose?.()
})

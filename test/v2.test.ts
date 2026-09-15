import assert from "node:assert/strict"
import { test } from "node:test"
import plugin from "../src/index.ts"

type V2Event = {
  tool: string
  sessionID?: string
  id?: string
  input?: Record<string, unknown>
  status?: "completed" | "error"
  result?: unknown
  error?: unknown
}

type V2Hook = (event: V2Event) => void | Promise<void>

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test("plugin exports an id/setup definition", () => {
  assert.equal(plugin.id, "@beremaran/opencode-subagent-throttle")
  assert.equal(typeof plugin.setup, "function")
})

test("plugin throttles task hooks and releases on completion", async () => {
  const hooks = new Map<string, V2Hook>()
  const context = {
    options: { maxParallel: 1 },
    tool: {
      hook: async (name: string, callback: V2Hook) => {
        hooks.set(name, callback)
        return {
          dispose: async () => {
            void hooks.delete(name)
          },
        }
      },
    },
  }
  const cleanup = await plugin.setup(context)
  const before = hooks.get("execute.before")
  const after = hooks.get("execute.after")
  assert.ok(before)
  assert.ok(after)

  await before({ tool: "task", sessionID: "s", id: "c1", input: {} })
  let secondStarted = false
  const second = Promise.resolve(before({ tool: "task", sessionID: "s", id: "c2", input: {} })).then(() => {
    secondStarted = true
  })
  await tick()
  assert.equal(secondStarted, false)

  await after({
    tool: "task",
    sessionID: "s",
    id: "c1",
    status: "completed",
    result: { output: '<task id="child1" state="completed">done</task>' },
  })
  await second
  assert.equal(secondStarted, true)
  await after({ tool: "task", sessionID: "s", id: "c2", status: "completed", result: { output: "done" } })
  await cleanup?.()
})

test("plugin releases failed tasks", async () => {
  const hooks = new Map<string, V2Hook>()
  const cleanup = await plugin.setup({
    options: { maxParallel: 1 },
    tool: {
      hook: async (name: string, callback: V2Hook) => {
        hooks.set(name, callback)
        return {
          dispose: async () => {
            void hooks.delete(name)
          },
        }
      },
    },
  })
  const before = hooks.get("execute.before")
  const after = hooks.get("execute.after")
  assert.ok(before)
  assert.ok(after)
  await before({ tool: "subagent", sessionID: "s", id: "c1", input: {} })
  await after({ tool: "subagent", sessionID: "s", id: "c1", status: "error", error: new Error("boom") })
  await before({ tool: "subagent", sessionID: "s", id: "c2", input: {} })
  await after({ tool: "subagent", sessionID: "s", id: "c2", status: "completed", result: { output: "done" } })
  await cleanup?.()
})

test("plugin releases background tasks on idle events", async () => {
  const hooks = new Map<string, V2Hook>()
  let resolveEvent: ((result: IteratorResult<unknown>) => void) | undefined
  const stream: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<unknown>>((resolve) => {
          resolveEvent = resolve
        }),
    }),
  }
  const cleanup = await plugin.setup({
    options: { maxParallel: 1 },
    tool: {
      hook: async (name: string, callback: V2Hook) => {
        hooks.set(name, callback)
        return {
          dispose: async () => {
            void hooks.delete(name)
          },
        }
      },
    },
    event: { subscribe: () => stream },
  })
  const before = hooks.get("execute.before")
  const after = hooks.get("execute.after")
  assert.ok(before)
  assert.ok(after)

  await before({ tool: "task", sessionID: "s", id: "bg1", input: { background: true } })
  await after({
    tool: "task",
    sessionID: "s",
    id: "bg1",
    status: "completed",
    result: { metadata: { sessionId: "child1" } },
  })
  let secondStarted = false
  const second = Promise.resolve(before({ tool: "task", sessionID: "s", id: "bg2", input: {} })).then(() => {
    secondStarted = true
  })
  await tick()
  assert.equal(secondStarted, false)

  resolveEvent?.({
    value: { type: "session.status", data: { sessionID: "child1", status: { type: "idle" } } },
    done: false,
  })
  await second
  assert.equal(secondStarted, true)
  await after({ tool: "task", sessionID: "s", id: "bg2", status: "completed", result: { output: "done" } })
  await cleanup?.()
})

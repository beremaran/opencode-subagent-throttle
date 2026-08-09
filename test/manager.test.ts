import assert from "node:assert/strict"
import { test } from "node:test"
import type { QueueEventInfo } from "../src/manager.ts"
import { ThrottleManager } from "../src/manager.ts"

function createFakeTimers() {
  let counter = 0
  const pending = new Map<number, () => void>()
  return {
    setTimer: (fn: () => void, _ms: number) => {
      const id = ++counter
      pending.set(id, fn)
      return id
    },
    clearTimer: (handle: unknown) => {
      pending.delete(handle as number)
    },
    fire: (id: number) => {
      const fn = pending.get(id)
      if (fn) {
        pending.delete(id)
        fn()
      }
    },
    fireAll: () => {
      for (const id of [...pending.keys()]) pending.get(id)?.()
      pending.clear()
    },
    count: () => pending.size,
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function manager(
  timers: ReturnType<typeof createFakeTimers>,
  options: Partial<ConstructorParameters<typeof ThrottleManager>[0]> = {},
) {
  return new ThrottleManager({
    maxParallel: 2,
    mode: "session",
    maxWaitMs: 5,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    ...options,
  })
}

test("ThrottleManager preserves foreground FIFO", async () => {
  const timers = createFakeTimers()
  const throttle = manager(timers)
  const done: boolean[] = Array(5).fill(false)
  const starts = done.map((_, index) =>
    throttle.startTask("s", `c${index}`, false).then(() => {
      done[index] = true
    }),
  )
  await tick()
  assert.deepEqual(throttle.stats, { running: 2, queued: 3 })
  assert.deepEqual(done, [true, true, false, false, false])

  throttle.endTask("s", "c0")
  throttle.endTask("s", "c1")
  await Promise.all(starts.slice(0, 4))
  assert.deepEqual(done, [true, true, true, true, false])
  assert.deepEqual(throttle.stats, { running: 2, queued: 1 })
  throttle.endTask("s", "c2")
  throttle.endTask("s", "c3")
  await starts[4]
  throttle.endTask("s", "c4")
  await Promise.all(starts)
  assert.deepEqual(throttle.stats, { running: 0, queued: 0 })
  throttle.dispose()
})

test("queue events report FIFO positions and order", async () => {
  const timers = createFakeTimers()
  const queuedEvents: QueueEventInfo[] = []
  const startedEvents: QueueEventInfo[] = []
  const throttle = manager(timers, {
    onQueued: (info) => queuedEvents.push(info),
    onStarted: (info) => startedEvents.push(info),
  })
  const starts = ["c0", "c1", "c2", "c3", "c4"].map((callID) => throttle.startTask("s", callID, false))

  await tick()
  assert.deepEqual(
    queuedEvents.map((event) => event.callID),
    ["c2", "c3", "c4"],
  )
  assert.deepEqual(
    queuedEvents.map((event) => event.position),
    [1, 2, 3],
  )
  assert.ok(queuedEvents.every((event) => event.running === 2))
  assert.equal(startedEvents.length, 0)

  throttle.endTask("s", "c0")
  throttle.endTask("s", "c1")
  await Promise.all(starts.slice(0, 4))
  assert.deepEqual(
    startedEvents.map((event) => event.callID),
    ["c2", "c3"],
  )

  throttle.endTask("s", "c2")
  throttle.endTask("s", "c3")
  throttle.endTask("s", "c4")
  await Promise.all(starts)
  assert.equal(startedEvents.length, 3)
  for (const callID of ["c2", "c3", "c4"]) {
    assert.ok(
      queuedEvents.findIndex((event) => event.callID === callID) <=
        startedEvents.findIndex((event) => event.callID === callID),
    )
  }
  throttle.dispose()

  const synchronousTimers = createFakeTimers()
  const synchronousQueued: QueueEventInfo[] = []
  const synchronous = manager(synchronousTimers, {
    onQueued: (info) => synchronousQueued.push(info),
  })
  const held = [synchronous.startTask("s", "held0", false), synchronous.startTask("s", "held1", false)]
  const pending = synchronous.startTask("s", "c9", false)
  assert.equal(synchronousQueued.length, 1)
  synchronous.dispose()
  await Promise.all([...held, pending])
})

test("queue events carry description and background flag", async () => {
  const timers = createFakeTimers()
  const queuedEvents: QueueEventInfo[] = []
  const throttle = manager(timers, {
    maxParallel: 1,
    onQueued: (info) => queuedEvents.push(info),
  })
  await throttle.startTask("s", "c1", false)
  const pending = throttle.startTask("s", "c2", true, "review parser")

  await tick()
  assert.deepEqual(queuedEvents, [
    {
      sessionID: "s",
      callID: "c2",
      description: "review parser",
      position: 1,
      running: 1,
      queued: 1,
      background: true,
    },
  ])
  throttle.endTask("s", "c1")
  await pending
  throttle.endTask("s", "c2")
  throttle.dispose()
})

test("no queue events when a slot is free", async () => {
  const timers = createFakeTimers()
  const queuedEvents: QueueEventInfo[] = []
  const startedEvents: QueueEventInfo[] = []
  const throttle = manager(timers, {
    onQueued: (info) => queuedEvents.push(info),
    onStarted: (info) => startedEvents.push(info),
  })

  await throttle.startTask("s", "c1", false)
  assert.equal(queuedEvents.length, 0)
  assert.equal(startedEvents.length, 0)
  throttle.endTask("s", "c1")
  throttle.dispose()
})

test("background slots release on child session idle", async () => {
  const timers = createFakeTimers()
  const throttle = manager(timers)
  await throttle.startTask("s", "c", true)
  throttle.endTask("s", "c", "child1")
  assert.equal(throttle.stats.running, 1)
  throttle.onSessionIdle("child1")
  assert.equal(throttle.stats.running, 0)
  throttle.dispose()
})

test("recently idle sessions handle races and expire", async () => {
  const timers = createFakeTimers()
  const throttle = manager(timers)
  throttle.onSessionIdle("childX")
  await throttle.startTask("s", "c", true)
  throttle.endTask("s", "c", "childX")
  assert.equal(throttle.stats.running, 0)
  throttle.dispose()

  const expiryTimers = createFakeTimers()
  const expiryManager = manager(expiryTimers)
  expiryManager.onSessionIdle("childY")
  expiryTimers.fireAll()
  await expiryManager.startTask("s", "c", true)
  expiryManager.endTask("s", "c", "childY")
  assert.equal(expiryManager.stats.running, 1)
  expiryManager.dispose()
})

test("tool errors release a slot", async () => {
  const timers = createFakeTimers()
  const throttle = manager(timers)
  await throttle.startTask("s", "c", false)
  throttle.onToolError("s", "c")
  assert.deepEqual(throttle.stats, { running: 0, queued: 0 })
  throttle.dispose()
})

test("watchdog releases abandoned slots and warns", async () => {
  const timers = createFakeTimers()
  const warnings: string[] = []
  const throttle = manager(timers, { onWarn: (message) => warnings.push(message) })
  await throttle.startTask("s", "c", false)
  timers.fireAll()
  assert.deepEqual(throttle.stats, { running: 0, queued: 0 })
  assert.equal(warnings.length, 1)
  throttle.dispose()

  const normalTimers = createFakeTimers()
  const normalWarnings: string[] = []
  const normal = manager(normalTimers, { onWarn: (message) => normalWarnings.push(message) })
  await normal.startTask("s", "c", false)
  normal.endTask("s", "c")
  normalTimers.fireAll()
  assert.deepEqual(normal.stats, { running: 0, queued: 0 })
  assert.equal(normalWarnings.length, 0)
  normal.dispose()
})

test("release paths are idempotent", async () => {
  const timers = createFakeTimers()
  const throttle = manager(timers)
  await throttle.startTask("s", "c", false)
  throttle.endTask("s", "c")
  throttle.onToolError("s", "c")
  throttle.onSessionIdle("child")
  throttle.endTask("s", "c", "child")
  throttle.endTask("s", "c")
  assert.deepEqual(throttle.stats, { running: 0, queued: 0 })
  assert.ok(throttle.stats.running >= 0)
  throttle.dispose()
})

test("session mode maintains independent pools", async () => {
  const timers = createFakeTimers()
  const throttle = manager(timers)
  await Promise.all([
    throttle.startTask("a", "a1", false),
    throttle.startTask("a", "a2", false),
    throttle.startTask("b", "b1", false),
    throttle.startTask("b", "b2", false),
  ])
  assert.deepEqual(throttle.stats, { running: 4, queued: 0 })
  for (const [sessionID, callID] of [
    ["a", "a1"],
    ["a", "a2"],
    ["b", "b1"],
    ["b", "b2"],
  ] as const)
    throttle.endTask(sessionID, callID)
  throttle.dispose()
})

test("global mode shares one pool", async () => {
  const timers = createFakeTimers()
  const throttle = manager(timers, { mode: "global" })
  const done: boolean[] = [false, false, false, false]
  const starts = ["a1", "a2", "b1", "b2"].map((callID, index) => {
    const sessionID = index < 2 ? "a" : "b"
    return throttle.startTask(sessionID, callID, false).then(() => {
      done[index] = true
    })
  })
  await tick()
  assert.deepEqual(throttle.stats, { running: 2, queued: 2 })
  throttle.endTask("a", "a1")
  throttle.endTask("a", "a2")
  await Promise.all(starts)
  assert.deepEqual(done, [true, true, true, true])
  throttle.endTask("b", "b1")
  throttle.endTask("b", "b2")
  assert.deepEqual(throttle.stats, { running: 0, queued: 0 })
  throttle.dispose()
})

test("dispose releases slots, clears timers, and resolves queued starts", async () => {
  const timers = createFakeTimers()
  const throttle = manager(timers)
  const starts = ["c1", "c2", "c3"].map((callID) => throttle.startTask("s", callID, false))
  await tick()
  assert.equal(timers.count(), 2)
  throttle.dispose()
  await Promise.all(starts)
  assert.deepEqual(throttle.stats, { running: 0, queued: 0 })
  assert.equal(timers.count(), 0)
  await throttle.startTask("s", "after-dispose", false)
  assert.deepEqual(throttle.stats, { running: 0, queued: 0 })
})

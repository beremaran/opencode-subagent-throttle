import assert from "node:assert/strict"
import { test } from "node:test"
import { Semaphore } from "../src/queue.ts"

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test("Semaphore queues excess acquires in FIFO order", async () => {
  const semaphore = new Semaphore(2)
  const order: number[] = []
  const releases: Array<() => void> = []
  const promises = Array.from({ length: 5 }, (_, id) =>
    semaphore.acquire().then((release) => {
      order.push(id + 1)
      releases.push(release)
      return release
    }),
  )

  await tick()
  assert.equal(semaphore.running, 2)
  assert.equal(semaphore.queued, 3)
  assert.deepEqual(order, [1, 2])

  releases[0]?.()
  releases[1]?.()
  await Promise.all(promises.slice(0, 4))
  assert.equal(semaphore.running, 2)
  assert.equal(semaphore.queued, 1)
  assert.deepEqual(order, [1, 2, 3, 4])

  releases[2]?.()
  releases[3]?.()
  await Promise.all(promises)
  assert.deepEqual(order, [1, 2, 3, 4, 5])
  releases[4]?.()
  assert.equal(semaphore.running, 0)
  assert.equal(semaphore.queued, 0)
})

test("Semaphore with max one is serial", async () => {
  const semaphore = new Semaphore(1)
  const first = await semaphore.acquire()
  let secondResolved = false
  const secondPromise = semaphore.acquire().then((release) => {
    secondResolved = true
    return release
  })

  await tick()
  assert.equal(secondResolved, false)
  assert.equal(semaphore.queued, 1)
  first()
  const second = await secondPromise
  assert.equal(semaphore.running, 1)
  second()
  assert.equal(semaphore.running, 0)
})

test("Semaphore rejects invalid maximums", () => {
  assert.throws(() => new Semaphore(0))
  assert.throws(() => new Semaphore(1.5))
  assert.throws(() => new Semaphore("2" as any))
})

test("Semaphore releases are idempotent", async () => {
  const semaphore = new Semaphore(1)
  const release = await semaphore.acquire()
  release()
  release()
  assert.equal(semaphore.running, 0)
  assert.equal(semaphore.queued, 0)
})

test("Semaphore has no queue when exactly max is acquired", async () => {
  const semaphore = new Semaphore(3)
  const releases = await Promise.all([semaphore.acquire(), semaphore.acquire(), semaphore.acquire()])
  assert.equal(semaphore.running, 3)
  assert.equal(semaphore.queued, 0)
  for (const release of releases) release()
  assert.equal(semaphore.running, 0)
})

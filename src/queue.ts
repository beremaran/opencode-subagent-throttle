export type Release = () => void

export class Semaphore {
  private readonly max: number
  private active = 0
  // A queued waiter receives the slot directly when the current holder releases.
  private waiters: Array<() => void> = []

  constructor(max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error("Semaphore max must be a positive integer")
    }

    this.max = max
  }

  async acquire(): Promise<Release> {
    if (this.active < this.max) {
      this.active += 1
      return this.createRelease()
    }

    return new Promise<Release>((resolve) => {
      this.waiters.push(() => resolve(this.createRelease()))
    })
  }

  get running(): number {
    return this.active
  }

  get queued(): number {
    return this.waiters.length
  }

  private createRelease(): Release {
    let released = false

    return () => {
      if (released) {
        return
      }

      released = true
      const next = this.waiters.shift()

      if (next !== undefined) {
        // Keep the slot counted while passing it along the FIFO queue.
        next()
      } else if (this.active > 0) {
        this.active -= 1
      }
    }
  }
}

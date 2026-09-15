import { ThrottleManager } from "./manager.ts"

type NormalizedOptions = {
  maxParallel: number
  mode: "session" | "global"
  maxWaitMs: number
}

const DEFAULT_MAX_PARALLEL = 2
const DEFAULT_MODE = "session" as const
const DEFAULT_MAX_WAIT_MS = 3_600_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const normalizeOptions = (rawOptions: unknown, warn: (message: string) => void): NormalizedOptions => {
  const options = isRecord(rawOptions) ? rawOptions : {}

  const maxParallel =
    typeof options.maxParallel === "number" &&
    Number.isInteger(options.maxParallel) &&
    options.maxParallel > 0
      ? options.maxParallel
      : (() => {
          if (options.maxParallel !== undefined) {
            warn("Invalid maxParallel; falling back to 2.")
          }
          return DEFAULT_MAX_PARALLEL
        })()
  const mode =
    options.mode === "session" || options.mode === "global"
      ? options.mode
      : (() => {
          if (options.mode !== undefined) {
            warn("Invalid mode; falling back to session.")
          }
          return DEFAULT_MODE
        })()
  const maxWaitMs =
    typeof options.maxWaitMs === "number" && options.maxWaitMs > 0
      ? options.maxWaitMs
      : (() => {
          if (options.maxWaitMs !== undefined) {
            warn("Invalid maxWaitMs; falling back to 3600000.")
          }
          return DEFAULT_MAX_WAIT_MS
        })()
  return { maxParallel, mode, maxWaitMs }
}

const childSessionIDFromResult = (value: unknown): string | undefined => {
  const result = isRecord(value) ? value : undefined
  const metadata = isRecord(result?.metadata) ? result.metadata : undefined
  const metadataSessionID = metadata?.sessionId ?? metadata?.sessionID
  if (typeof metadataSessionID === "string" && metadataSessionID.length > 0) {
    return metadataSessionID
  }

  const output = result?.output
  return typeof output === "string" ? /<task id="([^"]+)"/.exec(output)?.[1] : undefined
}

type V2ToolEvent = {
  tool: string
  agent?: string
  sessionID?: string
  sessionId?: string
  id?: string
  callID?: string
  input?: unknown
  status?: "completed" | "error"
  result?: unknown
  error?: unknown
}

type V2Registration = {
  dispose?: () => void | Promise<void>
}

type V2Context = {
  options?: unknown
  tool?: {
    hook?: (
      name: string,
      callback: (event: V2ToolEvent) => void | Promise<void>,
    ) => V2Registration | Promise<V2Registration>
  }
  event?: {
    subscribe?: () => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>
  }
}

type V2Cleanup = () => void | Promise<void>

export type V2Plugin = {
  readonly id: string
  readonly setup: (context: V2Context) => Promise<undefined | V2Cleanup>
}

const v2EventSessionID = (event: V2ToolEvent): string | undefined => {
  const sessionID = event.sessionID ?? event.sessionId
  return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : undefined
}

const v2EventCallID = (event: V2ToolEvent): string | undefined => {
  const callID = event.id ?? event.callID
  return typeof callID === "string" && callID.length > 0 ? callID : undefined
}

const v2EventArguments = (event: V2ToolEvent): Record<string, unknown> =>
  isRecord(event.input) ? event.input : {}

const v2EventData = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined

const startV2IdleWatcher = async (context: V2Context, manager: ThrottleManager): Promise<() => void> => {
  const subscribe = context.event?.subscribe
  if (subscribe === undefined) return () => {}

  let stream: AsyncIterable<unknown>
  try {
    stream = await subscribe()
  } catch {
    return () => {}
  }

  let stopped = false
  void (async () => {
    try {
      for await (const value of stream) {
        if (stopped) return
        const event = v2EventData(value)
        const payload = v2EventData(event?.data) ?? v2EventData(event?.properties)
        const status = v2EventData(payload?.status)
        const idle =
          event?.type === "session.idle" || (event?.type === "session.status" && status?.type === "idle")
        if (!idle) continue
        const sessionID = payload?.sessionID ?? payload?.sessionId
        if (typeof sessionID === "string") manager.onSessionIdle(sessionID)
      }
    } catch {
      // Event streams are an optional enhancement; the watchdog remains the backstop.
    }
  })()

  return () => {
    stopped = true
  }
}

const V2_PLUGIN: V2Plugin = {
  id: "@beremaran/opencode-subagent-throttle",
  setup: async (context) => {
    const warn = (message: string): void => {
      try {
        console.warn(message)
      } catch {
        // Logging must not affect tool execution.
      }
    }
    const { maxParallel, mode, maxWaitMs } = normalizeOptions(context.options, warn)
    const manager = new ThrottleManager({ maxParallel, mode, maxWaitMs, onWarn: warn })
    const hook = context.tool?.hook
    if (hook === undefined) return

    const before = await hook("execute.before", async (event) => {
      if (event.tool !== "task" && event.tool !== "subagent") return
      const sessionID = v2EventSessionID(event)
      const callID = v2EventCallID(event)
      if (sessionID === undefined || callID === undefined) return
      const args = v2EventArguments(event)
      await manager.startTask(
        sessionID,
        callID,
        args.background === true,
        typeof args.description === "string" ? args.description : undefined,
      )
    })
    const after = await hook("execute.after", async (event) => {
      if (event.tool !== "task" && event.tool !== "subagent") return
      const sessionID = v2EventSessionID(event)
      const callID = v2EventCallID(event)
      if (sessionID === undefined || callID === undefined) return
      if (event.status === "error" || event.error !== undefined) {
        manager.onToolError(sessionID, callID)
        return
      }
      manager.endTask(sessionID, callID, childSessionIDFromResult(event.result))
    })
    const stopIdleWatcher = await startV2IdleWatcher(context, manager)

    return async () => {
      stopIdleWatcher()
      manager.dispose()
      await before.dispose?.()
      await after.dispose?.()
    }
  },
}

export default V2_PLUGIN

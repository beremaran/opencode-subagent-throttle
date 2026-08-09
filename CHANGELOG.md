# Changelog

## [Unreleased]

### Added

- Nothing yet.

## 0.1.0 - 2026-08-09

### Added

- Initial release. The plugin throttles concurrent `task` tool calls by
  queueing excess calls as pending in FIFO order; queued tasks are never
  rejected or silently dropped.
- `maxParallel` option: maximum number of subagent tasks that may run at once
  (default `2`).
- `mode` option: `"session"` creates a throttle pool per session (default),
  `"global"` shares one pool across the whole opencode instance.
- `maxWaitMs` option: watchdog backstop that force-releases a slot held longer
  than the limit with a warning log (default `3600000` ms, i.e. 60 minutes).
- `notifyQueue` option: when enabled, injects informational status lines into
  the session transcript when a task is queued and when it starts.
- Foreground tasks release their slot exactly when the subagent completes.
  Background tasks (`background: true`) hold their slot until the child
  session is idle; tool errors and the `maxWaitMs` watchdog release slots as
  backstops.

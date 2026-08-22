# Changelog

## 0.2.0 - 2026-08-22

### Added

- OpenCode 2 Promise plugin support through the package root `{ id, setup }`
  entrypoint, while preserving the OpenCode 1 callable server entrypoint at
  `./server` and `src/index.ts`.
- OpenCode 2 task/subagent throttling with FIFO queueing, failure release,
  background-session idle release, and watchdog protection.
- Trusted-publishing npm workflow using GitHub Actions OIDC and npm
  provenance.

### Changed (Breaking)

- OpenCode 2 is now the package root entrypoint. OpenCode 1 package users
  should continue using the legacy `plugin` config field, which resolves the
  callable `main`/`./server` entrypoint.

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

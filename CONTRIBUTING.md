# Contributing

Thanks for contributing to @beremaran/opencode-subagent-throttle!

## Getting started

1. Fork the repository and clone your fork.
2. `npm install`
3. `npm run check`

The plugin has no build step — it is raw TypeScript loaded natively by opencode
(Bun runtime). `npm run check` runs typecheck (`tsc --noEmit`), lint
(Biome), and the test suite (Node's built-in test runner).

## Manual testing

The repo root ships an `opencode.json` pre-wired to load `./src/index.ts` with
`maxParallel: 2`. Run `opencode` from the repo root, then ask something that
fans out multiple `task` calls, e.g.:

> List the files in this repo and, in parallel, summarize the first lines of
> each source file.

Expected behavior:

1. The first `maxParallel` tasks start immediately.
2. Further `task` calls wait in the FIFO queue and start, in order, as slots
   become available.
3. With `notifyQueue: true` (not enabled by default in the shipped
   `opencode.json`), the transcript shows `⏳ Task queued — position …` lines.

Verify with `opencode run --print-logs` that the plugin's warn/error lines
(service `opencode-subagent-throttle`) are absent when everything works.

## Writing tests

- Tests live in `test/`: `queue.test.ts` (the semaphore), `manager.test.ts`
  (the slot manager), and `plugin.test.ts` (the plugin hooks against a mock
  `client`). They use `node:test` run via `npm test`
  (`node --experimental-strip-types --test "test/*.test.ts"`).
- Prefer assertions that are **filter-based, not positional**. In particular,
  when you assert on the synthetic transcript lines injected by
  `notifyQueue`, match on message content with `assert.match`, not on an
  absolute index like `promptCalls[0]` — a notification added earlier in a
  test's lifecycle would silently break it.
- Add a test for any behavior you change, and run `npm run check` before
  pushing; CI enforces it.

## Pull requests

- Keep changes minimal and scoped.
- Run `npm run check` before pushing; CI enforces it.
- If you change observable behavior or options, update `CHANGELOG.md` under
  `## [Unreleased]` and the README where relevant.
- Use [Conventional Commits](https://www.conventionalcommits.org/) style
  (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, …); releases use
  `chore: release vX.Y.Z` (see [RELEASING.md](RELEASING.md)).
- Update `package.json` `version` only when asked to prepare a release.

## Releases

Releases are tag-triggered from CI — see [RELEASING.md](RELEASING.md) for the
full flow (bump version, add a CHANGELOG entry, tag `vX.Y.Z`, push the tag).

# Security Policy

## Supported versions

Only the latest published version of `@beremaran/opencode-subagent-throttle` is
supported with security updates. Older releases are not patched; if you are on
an earlier release, upgrade to the latest version and confirm the issue is
resolved before reporting it.

## Reporting a vulnerability

Please report security vulnerabilities by emailing
[berke@beremaran.com](mailto:berke@beremaran.com) rather than opening a public
issue.

Include in your report:

- The plugin version (from `package.json`) and the opencode version you are
  running.
- A description of the vulnerability and, if possible, a minimal reproduction.
- Any impact assessment you can provide.

You can expect an acknowledgement within a few business days and a fix or
mitigation plan as soon as one can be produced. Please do not disclose the
issue publicly until it has been addressed.

## Known security considerations

This plugin enforces behavior through configuration, so its security surface is
the configuration it runs with. Only use the plugin with config you control.

- **The plugin holds tool calls open while they wait.** A `task` call with a
  slot held for a very long time appears as running in the UI; the `maxWaitMs`
  watchdog (default 60 minutes) force-releases slots as a backstop, but any
  config that disables or lengthens it changes that guarantee.
- **`notifyQueue` injects lines into the session transcript.** When enabled,
  queued/started lines are posted with `ignored: true` so they do not reach the
  model's context, but a malicious or misconfigured plugin running alongside
  this one shares the same transcript surface.
- **`"global"` mode shares one pool across all sessions.** One session's
  fan-out can starve another session's `task` calls. Prefer the default
  `"session"` mode unless you have a specific reason to share.
- **This throttles concurrency, not rate or permission.** It limits how many
  `task` calls run at once; it does not gate what tasks may do, and it has no
  effect on other tools.

The README's Caveats section describes these same considerations in prose.

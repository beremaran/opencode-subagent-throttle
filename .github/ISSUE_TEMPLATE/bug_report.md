---
name: Bug report
about: Report a problem with the opencode-subagent-throttle plugin
title: ""
labels: bug
assignees: ""
---

**Describe the bug**
A clear and concise description of what is broken and what you expected.

**Environment**
- opencode version: (e.g. `opencode --version`)
- Plugin version/spec: (e.g. `github:beremaran/opencode-subagent-throttle`, tag, or local path commit)
- Node/Bun runtime if relevant:

**Config**
Paste the relevant part of your `opencode.json` (plugin entry and options; redact secrets):

```json
{
  "plugins": [
    {
      "package": "github:beremaran/opencode-subagent-throttle",
      "options": { "maxParallel": 2, "mode": "session" }
    }
  ]
}
```

**Logs**
Paste the relevant startup/run logs, especially any `opencode-subagent-throttle` lines
(e.g. from `opencode run --print-logs`).

**To reproduce**
Steps to reproduce the behavior.

**Expected behavior**
What you expected to happen.

**Additional context**
Anything else that might help (OS, TUI vs CLI vs web, foreground vs background tasks, etc.).

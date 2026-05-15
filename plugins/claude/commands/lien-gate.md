---
description: Toggle the Lien edit-gate hook (advisory/blocking/off) for this session
argument-hint: on | off | block | status
allowed-tools: Bash(lien gate:*)
---

Run `lien gate $ARGUMENTS` and report its output verbatim.

If `$ARGUMENTS` is empty, run `lien gate status`.

- `on` — advisory mode (default): missed gate emits a `systemMessage`.
- `off` — disabled until the next Claude Code session (sentinels are still recorded).
- `block` — blocking mode: missed gate exits 2 and feeds the message back as a tool error. Persists across sessions.
- `status` — print current mode and the flag directory.

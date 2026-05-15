---
description: Toggle the Lien edit-gate hook (blocking / advisory / off) for this session
argument-hint: on | block | advisory | off | status
allowed-tools: Bash(lien gate:*)
---

Run `lien gate $ARGUMENTS` and report its output verbatim.

If `$ARGUMENTS` is empty, run `lien gate status`.

- `on` (default) — **blocking mode**: a missed gate fails the edit with exit 2,
  feeding the nudge back to Claude as a tool error. This is the only mode that
  actually changes Claude's behavior; Claude Code does not surface PreToolUse
  `systemMessage` output to the model on subsequent turns.
- `block` — alias of `on`.
- `advisory` — **UI-only nudge**: the missed-gate message is recorded as a
  `hook_system_message` attachment but Claude does NOT see it. Useful if you
  only want a visible signal in the Claude Code UI without behavior change.
- `off` — disabled until you re-enable it. Sentinels are still recorded.
- `status` — print current mode and the flag directory.

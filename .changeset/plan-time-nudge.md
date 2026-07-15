---
'@liendev/lien': minor
---

Add the plan-time complexity nudge — surfacing near/over-budget functions as an imperative warning *before* an agent edits, not just after (`lien delta`) or as inert data (`get_files_context`'s `complexityHeadroom`).

- `get_files_context` gains an optional `complexityHeadroomWarning` string field, spread ahead of `complexityHeadroom` in the response so it's the first thing an agent reads when a function in the file is at/near its complexity budget. Purely additive — `complexityHeadroom` itself is unchanged.
- `lien annotate` (and therefore the plugin's `annotate-read.sh` read-hook) now computes the same headroom for the file it annotates and, when non-empty, leads the printed annotation with the same shared warning line — reusing `get_files_context`'s exact computation so the two can never disagree. The annotation now also fires (instead of staying silent) when a file has a near-budget function even if it would otherwise look trivial (no dependents, existing test coverage).
- No new hook: a `PreToolUse:Edit|Write` hook was considered and rejected — per `docs/architecture/claude-code-hook-channels.md`, `PreToolUse` has no channel that delivers model-visible content for `Edit`/`Write` without either doing nothing or blocking the edit outright (`exit 2`). The existing `PostToolUse:Read` annotation hook already fires right before the mandatory `get_files_context` → `Edit` sequence, so it carries the nudge instead — inheriting the existing per-file TTL suppression for free.

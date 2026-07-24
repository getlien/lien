---
'@liendev/lien': minor
---

Add the blast-radius nudge — closing the honor-system gap in CLAUDE.md's "run `get_dependents` before changing an exported symbol's signature" rule, the same way `lien delta` already automates the complexity rule.

- New `lien api-delta` command: detects, content-only (`chunkFile`'s existing exported-name and signature metadata, zero index), when a working-tree edit changed or removed the signature of an exported function or class method. `--file <path>` mirrors `lien delta`'s fast path for the edit hook; `--base <ref>` mirrors CI parity. Advisory only — there is no gate, so it always exits 0; the JSON `changes[]` array is what a caller reads.
- Best-effort enrichment against the structural index (`findDependents` + the shared blast-radius-risk primitive) adds dependent counts and a risk level when an index is available; degrades gracefully (signature-only, no counts) when it isn't, or if the lookup fails for a given symbol — never blocks, never throws.
- The Claude Code plugin gains an `api-delta-write.sh` hook on `PostToolUse:Edit|Write|MultiEdit` (a sibling of `delta-write.sh` and `test-reminder.sh`) that surfaces a one-line warning via `additionalContext` after an edit that changed/removed an exported signature. Kill switch: `LIEN_BLAST_HOOK=off`.
- A local, append-only `blast-events.jsonl` ledger (kill switch `LIEN_BLAST_EVENTS=off`) records every edit that changed an exported signature; `lien stats` gains a second "exported-signature nudge" section (7/30-day runs, distinct symbols changed, risk-level breakdown) alongside the existing complexity-delta stats, additive to the existing JSON shape.

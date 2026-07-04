---
'@liendev/parser': minor
'@liendev/lien': minor
---

`lien delta` Phase 2 — surface the complexity-delta verdict at the moment of the edit.

Phase 1 made the verdict available as a gate the agent chooses to run. Phase 2 moves it to edit time via two advisory (non-blocking) mechanisms, plus fixes for five review findings on the Phase-1 code.

- **PostToolUse edit hook** (`plugins/claude/hooks/delta-write.sh`, registered in the Claude Code plugin): after an `Edit`/`Write`/`MultiEdit`, computes the complexity delta for just that file and emits an `additionalContext` warning **only** when the edit introduces a NEW threshold crossing. Silent otherwise. Driven by a new single-file fast path.
- **`lien delta --file <path>`**: analyze one file vs `HEAD` (instead of scanning the whole working tree) — bounds the per-edit hook to the file that changed. Resolves absolute-or-relative paths and canonicalizes symlinked segments; out-of-repo, unsupported, or absent files produce no output.
- **`get_files_context` complexity headroom**: the response now includes a lean `complexityHeadroom` array listing functions at ≥ 80% of a cyclomatic/cognitive budget (worst-first, capped, with an overflow count), computed from complexity metrics already stored in the index (no re-parse). It lets an agent steer around near-budget functions before editing. Omitted entirely when nothing is near budget.
- **Phase-1 review-finding fixes** in the shared primitive and CLI: a still-over-threshold decrease is now `pre-existing` rather than `improved` (`classifyMetric` is exported for testing); `--threshold` requires a positive integer (rejects negatives/floats/zero → exit 2); a config-load failure exits 2 instead of crashing; single-file reads only treat `ENOENT` as "deleted"; and Halstead-effort display floors rather than rounds so it can never overstate past a limit.

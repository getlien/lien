---
'@liendev/parser': minor
'@liendev/lien': minor
---

Add `lien delta` — flag NEW complexity threshold crossings before commit.

Lien already scores per-function complexity and reports threshold violations in PR review, but only *after* code is pushed. `lien delta` moves that signal to edit time: a ~50 ms deterministic check that compares the working tree against `HEAD` and fails only when a change pushes a function's complexity over a threshold it was under before (a new-over-threshold or crossed function). Improving, or merely touching, a pre-existing violation never fails.

- **Shared primitive** `computeComplexityDelta` in `@liendev/parser` computes per-function before/after verdicts (`crossed`, `new-over-threshold`, `worsened`, `pre-existing`, `improved`, `unchanged`, `new-under-threshold`, `removed`) from two content strings, reusing the existing complexity machinery (`chunkFile` + cyclomatic/cognitive/Halstead metrics). Because the PR-review engine depends on parser only, it can adopt the same primitive so write-time and review-time verdicts never structurally disagree.
- **`lien delta` CLI** compares the working tree vs `HEAD` across changed files (staged + unstaged + untracked, with rename and unborn-HEAD handling), prints a concise per-function crossing table, and uses gate-friendly exit codes: `0` clean (or `--soft`), `1` on new crossings, `2` on operational failure. Thresholds come from `.lien.config.json`'s `complexity.thresholds` (the same source PR review reads), overridable with `--threshold`.

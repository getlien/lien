# Lien Architecture Documentation

This directory documents how Lien's internals fit together: components, data flow, and how the CLI commands compute their answers.

> [!IMPORTANT]
> **Phase 5 (2026-09-01, commit `0de8ea52`) deleted the MCP server, the persisted
> index, and the telemetry family.** `packages/cli/src/mcp/`, `packages/core/src/vectordb/`,
> `packages/core/src/indexer/`, `packages/core/src/gc/`, `packages/cli/src/watcher/`, and the
> nudge/recap/stats/verify-tests family are all gone. `lien` no longer runs as a server with a
> database behind it — it parses the working tree on demand. Surviving commands: `complexity`,
> `health`, `review`, `delta`. Docs whose entire subject was one of those deleted subsystems have
> been removed outright rather than left to describe nothing; the rest below have been corrected
> to match. `docs/architecture/decisions/` (the ADRs) are historical records and were left alone
> beyond a superseded-status banner where relevant — read those for the deletion's rationale and
> provenance, not this index.
>
> **The Claude Code plugin was deleted on 2026-08-31 (phase 4), separately from the above.** Every
> remaining reference below to `plugins/claude/hooks/*` describes a delivery mechanism that no
> longer exists. The *checks* those hooks automated survive as commands (`lien delta`, `lien
> health`, `lien review`); the automatic invocation does not. Read hook references as history, not
> as configuration. Replacement: the review skill at `.claude/skills/review/`.
>
> **`packages/review`, `packages/action`, the offline prompt-test harness, and the
> `lien-review-testbed/` fixture app were deleted on 2026-09-01 (phase 7b).** Lien
> Review — the LLM-driven GitHub Action that reviewed pull requests in CI — is no
> longer developed or published from this repository (existing
> `uses: getlien/lien-review@v1` workflows are unaffected; see
> [ADR-012](decisions/0012-self-hostable-review-action.md)). Docs whose entire
> subject was that engine have been removed outright, including the
> "Agent-Review Pass Architecture" entry this index used to carry; the rest
> below have been corrected to match.

## Documentation index

### [System Overview](./system-overview.md)
High-level component architecture.

A bird's-eye view of Lien's architecture showing:
- The CLI commands (`complexity`, `health`, `review`, `delta`) and what each one computes
- Parser services (scanner, chunker, AST traversal, complexity, risk, signals, ecosystem presets)
- Config (`ConfigService`, per-project `.lien.config.json`) and git helpers

Read this first to understand the overall system structure.

Key diagrams: component architecture graph, technology stack.

---

### [Data Flow](./data-flow.md)
How data moves through the system.

Detailed flow diagrams showing:
- Parse-and-analyze flow: File → Chunks (AST) → Complexity/risk/signal metrics → Report
- `lien delta`'s before/after diff flow: `HEAD`/`--base` content vs. working tree → per-function verdicts
- Data transformations at each step

Read this to understand how code is processed and analyzed.

Key diagrams: parse-and-analyze flowchart, delta comparison flowchart, chunking strategy visualization.

---

### [Configuration System](./config-system.md)
Per-project config management.

Documentation of Lien's configuration:
- Per-project configuration (`ConfigService`) for `complexity.thresholds`
- Validation and the retired-key warn-and-strip mechanism

Read this to understand configuration management.

---

### [Test Association](./test-association.md)
Links each source file to the tests that cover it.

Explains how Lien's single import-based pass (`findTestAssociationsFromChunks`, all 11
registered languages) links test files to source files:
- Identifying test files by convention (`isTestFile`)
- Matching an import to its target, including manifest-aware resolution (PHP PSR-4, Go modules)
- Per-language honest limitations (Swift/C# whole-module and enclosing-namespace gaps) and
  recovered signals (Go same-package convention, Swift symbol-usage fallback)
- Where associations surface today: `lien health` and `lien review`

Read this to understand how test associations work. Note the doc's own "History" section: the
two-pass design ADR-004 proposed was never shipped — this is the single-pass system that runs
instead.

---

### [lien delta](./lien-delta.md)
Complexity-delta gate: catch new threshold crossings before commit.

Explains the write-time/commit-time complexity-delta gate:
- The shared `computeComplexityDelta` primitive in `@liendev/parser` (also used by PR review)
- `lien delta` CLI: compares the working tree vs `HEAD` or `--base <ref>`, flags only new crossings
- The CI backstop (`.github/workflows/ci.yml`'s `delta` job)

Read this to understand CLAUDE.md's sixth pre-commit gate. The doc also carries, as history, the
now-deleted PostToolUse hook and the `get_files_context`/`lien stats` telemetry that used to
surface the same signal earlier and measure the gate's own effect — neither exists any more.

---

### [Claude Code Hook Output Channels](./claude-code-hook-channels.md)
Which hook output actually reaches the model.

Reference for `plugins/claude/hooks/*` authors: which Claude Code hook output channels (`additionalContext`, `updatedInput.prompt`, exit-2 stderr) surface to the model on its next turn, and which are silently dropped (bare `systemMessage`, `updatedToolOutput` for `Read`). Verified behaviorally against a specific Claude Code version; re-verify if the hook protocol changes.

Read this before adding or changing a plugin hook.

> The four-state index-honesty policy (S0-S3, `classifyIndexState`) this used to sit alongside
> was retired with the index it classified. The surviving principle — a read-only command must
> never render "no data" as "clean" — is now "No-Data Honesty" in `CLAUDE.md` directly; see
> `packages/cli/src/utils/scan-failure.ts` (`describeScanFailure`) for the detector.

---

For the history behind these designs, see the [Architectural Decision Records index](decisions/README.md).

## Quick reference

### For new contributors

1. Start with [System Overview](./system-overview.md) to get the big picture.
2. Read [Data Flow](./data-flow.md) to understand how data moves.
3. Pick a specific area based on what you're working on.

### For understanding specific features

| Feature | Documentation |
|---------|--------------|
| Complexity analysis (`lien complexity`) | [Data Flow](./data-flow.md), [System Overview](./system-overview.md) |
| Risk ranking (`lien health`) | [System Overview](./system-overview.md) |
| Deterministic review signals (`lien review`) | [System Overview](./system-overview.md) |
| Configuration | [Configuration System](./config-system.md) |
| Test associations | [Test Association](./test-association.md) |
| Pre-commit complexity gate (`lien delta`) | [lien delta](./lien-delta.md) |
| Plugin hook design (what reaches the model) — historical | [Claude Code Hook Output Channels](./claude-code-hook-channels.md) |
| No-Data Honesty (never render "no data" as "clean") | `CLAUDE.md` → "No-Data Honesty" |

### For debugging

| Issue | Check |
|-------|-------|
| Config problems | [Configuration System](./config-system.md) → Validation |
| Missing test associations | [Test Association](./test-association.md) → Known gaps |
| `lien delta` false positive/negative | [lien delta](./lien-delta.md) → Per-metric classification |

## Code organization

`CLAUDE.md`'s "Package Structure" section is the canonical, actively-maintained map of `packages/parser`, `packages/core`, `packages/cli`, and `packages/site`. Read it there rather than here.

For technology stack, performance characteristics, and scaling notes, see [System Overview](./system-overview.md).

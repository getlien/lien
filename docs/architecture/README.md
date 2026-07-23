# Lien Architecture Documentation

This directory documents how Lien's internals fit together: components, data flow, and the request/response sequences for indexing and MCP tool calls.

## Documentation index

### [System Overview](./system-overview.md)
High-level component architecture.

A bird's-eye view of Lien's architecture showing:
- CLI layer and commands (including `lien config` and `lien complexity`)
- MCP server and all six tools
- Core services (indexer, scanner, chunker, complexity analyzer, manifest manager, etc.)
- Data layer (VectorDB factory with the SQLite structural store + FTS5 lexical search)
- Optional services (git tracking, file watching, ecosystem presets)
- External dependencies
- Lien Review (the separate GitHub Action product surface: `packages/review` + `packages/action`)

Read this first to understand the overall system structure.

Key diagrams: component architecture graph, technology stack.

---

### [Data Flow](./data-flow.md)
How data moves through the system.

Detailed flow diagrams showing:
- Indexing data flow: File → Chunks → SQLite store (FTS5 kept in sync by triggers)
- Search data flow: Query → FTS5 MATCH → BM25 rank → Results
- Incremental update flow: change detection → reindex → reconnect
- Data transformations at each step

Read this to understand how code is processed and searched.

Key diagrams: indexing flowchart, search flowchart, incremental update flowchart, chunking strategy visualization.

---

### [Indexing Flow](./indexing-flow.md)
Full and incremental indexing workflows.

Sequence diagrams showing:
- Full indexing: complete workflow from `lien index` to completion
- Incremental indexing: how individual file changes are handled
- Chunking strategy with overlap
- Error handling and recovery

Read this to understand the indexing process in detail.

Key diagrams: full indexing sequence diagram, incremental indexing sequence diagram, chunking visualization, error handling flowchart.

---

### [MCP Server Flow](./mcp-server-flow.md)
MCP server initialization and request handling.

Diagrams of:
- Server initialization sequence
- Tool request handling (`search_code`, `find_similar`, `get_files_context`, `list_functions`, `get_dependents`, `get_complexity`)
- Background update monitoring
- Version checking and reconnection
- Error handling

Read this to understand how Lien integrates with Cursor and other AI assistants.

Key diagrams: server initialization sequence, tool request sequences, background monitoring flowchart, shutdown and cleanup sequence.

---

### [Configuration System](./config-system.md)
Global config and per-project config management.

Documentation of Lien's two-layer configuration:
- Global configuration (`GlobalConfig`) for backend choice
- Per-project configuration (`ConfigService`) for `complexity.thresholds`
- `lien config` CLI (set/get/list)
- Legacy config migration and validation rules

Read this to understand configuration management.

Key diagrams: configuration architecture graph, migration sequence diagram, validation flowchart, schema evolution comparison.

---

### [Test Association](./test-association.md)
Two-pass test detection system.

Explains how Lien links test files to source files:
- Pass 1: convention-based detection (12 languages)
- Pass 2: import analysis (TypeScript, JavaScript, Python)
- Pattern matching algorithms
- Import path resolution
- Framework detection

Read this to understand how test associations work.

Key diagrams: two-pass detection overview, convention-based detection flowchart, import analysis sequence diagram, merge strategy flowchart, framework detection flowchart.

---

### [Worktree-Aware Indexing](./worktree-aware-indexing.md)
Sharing one index between a git worktree and its main checkout.

Explains how a linked worktree avoids building a full independent index:
- Read-only base (main checkout's index) + small writable overlay (worktree-only diffs)
- Detection via `git rev-parse --git-dir` vs `--git-common-dir`
- Fallback to standalone indexing when the base is missing or incompatible

Read this if you're touching `OverlayBackend` or debugging worktree index staleness.

---

### [lien delta](./lien-delta.md)
Complexity-delta gate: catch new threshold crossings before commit.

Explains the write-time/commit-time complexity-delta gate:
- `lien delta` CLI: compares the working tree vs `HEAD`, flags only new crossings
- `plugins/claude/hooks/delta-write.sh`: the same check as a PostToolUse edit-hook warning
- Shared `computeComplexityDelta` primitive in `@liendev/parser` (also used by PR review)

Read this to understand CLAUDE.md's sixth pre-commit gate.

---

### [Claude Code Hook Output Channels](./claude-code-hook-channels.md)
Which hook output actually reaches the model.

Reference for `plugins/claude/hooks/*` authors: which Claude Code hook output channels (`additionalContext`, `updatedInput.prompt`, exit-2 stderr) surface to the model on its next turn, and which are silently dropped (bare `systemMessage`, `updatedToolOutput` for `Read`). Verified behaviorally against a specific Claude Code version; re-verify if the hook protocol changes.

Read this before adding or changing a plugin hook.

---

### [Agent-Review Pass Architecture](./review-pass-architecture.md)
`ReviewPassSpec` and the extra-pass executor (Lien Review).

Explains how Lien Review's agent-review plugin runs additional dedicated LLM passes beyond the main investigation:
- The `ReviewPassSpec` contract and the serial `runExtraPasses` orchestrator
- The three shipped passes (doc-truth, stale-duplicate loop, incomplete-handling loop): gates, budgets, toolsets, verdict vocabularies
- The per-candidate-verdict output contract and `incomplete_verdict` honesty semantics
- Attestation v2 (`provider.passes[]` / `BudgetAttestation` per pass)
- Which passes are production-on vs. dark-launched today

Read this if you're adding a rule to the agent-review plugin or touching `packages/review/src/plugins/agent/review-pass.ts`. See also [ADR-014](decisions/0014-per-rule-candidate-loop-passes.md) for the decision and its evidence.

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
| Indexing a codebase | [Indexing Flow](./indexing-flow.md) |
| Search queries | [Data Flow](./data-flow.md) → Search section |
| MCP integration | [MCP Server Flow](./mcp-server-flow.md) |
| Configuration | [Configuration System](./config-system.md) |
| Test associations | [Test Association](./test-association.md) |
| File watching & git tracking | [MCP Server Flow](./mcp-server-flow.md) → Background monitoring |
| Dependency analysis (`get_dependents`) | [MCP Server Flow](./mcp-server-flow.md) → Available MCP Tools |
| Complexity analysis (`get_complexity`) | [MCP Server Flow](./mcp-server-flow.md) → Available MCP Tools |
| Worktree-shared indexing | [Worktree-Aware Indexing](./worktree-aware-indexing.md) |
| Pre-commit complexity gate (`lien delta`) | [lien delta](./lien-delta.md) |
| Plugin hook design (what reaches the model) | [Claude Code Hook Output Channels](./claude-code-hook-channels.md) |
| Lien Review's extra LLM passes (doc-truth, candidate loops) | [Agent-Review Pass Architecture](./review-pass-architecture.md) |

### For debugging

| Issue | Check |
|-------|-------|
| Indexing errors | [Indexing Flow](./indexing-flow.md) → Error handling |
| MCP connection issues | [MCP Server Flow](./mcp-server-flow.md) → Initialization |
| Config problems | [Configuration System](./config-system.md) → Validation |
| Missing test associations | [Test Association](./test-association.md) → Detection logic |
| Slow searches | [Data Flow](./data-flow.md) → Performance section |

## Code organization

`CLAUDE.md`'s "Package Structure" section is the canonical, actively-maintained map of `packages/parser`, `packages/core`, `packages/cli`, `packages/review`, `packages/action`, and `packages/site`. Read it there rather than here.

For technology stack, performance characteristics, and scaling notes, see [System Overview](./system-overview.md).

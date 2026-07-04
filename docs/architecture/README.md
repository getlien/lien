# Lien Architecture Documentation

Welcome to the Lien architecture documentation. This directory contains comprehensive diagrams and explanations of how Lien works internally.

## 📚 Documentation Index

### 🏗️ [System Overview](./system-overview.md)
**High-level component architecture**

A bird's-eye view of Lien's architecture showing:
- CLI layer and commands (including `lien config` and `lien complexity`)
- MCP server and all six tools
- Core services (indexer, scanner, chunker, complexity analyzer, manifest manager, etc.)
- Data layer (VectorDB factory with the SQLite structural store + FTS5 lexical search)
- Optional services (git tracking, file watching, ecosystem presets)
- External dependencies
- Lien Review — the separate GitHub Action product surface (`packages/review` + `packages/action`)

**Read this first** to understand the overall system structure.

**Key diagrams:**
- Component architecture graph
- Technology stack
- Design principles

---

### 🔄 [Data Flow](./data-flow.md)
**How data moves through the system**

Detailed flow diagrams showing:
- **Indexing data flow**: File → Chunks → SQLite store (FTS5 kept in sync by triggers)
- **Search data flow**: Query → FTS5 MATCH → BM25 rank → Results
- **Incremental update flow**: Change Detection → Reindex → Reconnect
- Data transformations at each step
- Performance optimizations

**Read this** to understand how code is processed and searched.

**Key diagrams:**
- Indexing flowchart
- Search flowchart
- Incremental update flowchart
- Chunking strategy visualization

---

### 📦 [Indexing Flow](./indexing-flow.md)
**Full and incremental indexing workflows**

Comprehensive sequence diagrams showing:
- **Full indexing**: Complete workflow from `lien index` to completion
- **Incremental indexing**: How individual file changes are handled
- Chunking strategy with overlap
- Error handling and recovery
- Performance characteristics and optimizations

**Read this** to understand the indexing process in detail.

**Key diagrams:**
- Full indexing sequence diagram
- Incremental indexing sequence diagram
- Chunking visualization
- Error handling flowchart

---

### 🔌 [MCP Server Flow](./mcp-server-flow.md)
**MCP server initialization and request handling**

Detailed diagrams of:
- Server initialization sequence
- Tool request handling (semantic_search, find_similar, get_files_context, list_functions, get_dependents, get_complexity)
- Background update monitoring
- Version checking and reconnection
- Error handling
- Integration with AI assistants

**Read this** to understand how Lien integrates with Cursor and other AI assistants.

**Key diagrams:**
- Server initialization sequence
- Tool request sequences
- Background monitoring flowchart
- Shutdown and cleanup sequence

---

### ⚙️ [Configuration System](./config-system.md)
**Global config and per-project config management**

Documentation of Lien's two-layer configuration:
- Global configuration (`GlobalConfig`) for backend choice
- Per-project configuration (`ConfigService`) for indexing, chunking, MCP settings
- `lien config` CLI (set/get/list)
- Legacy config migration and validation rules

**Read this** to understand configuration management.

**Key diagrams:**
- Configuration architecture graph
- Migration sequence diagram
- Validation flowchart
- Schema evolution comparison

---

### 🧪 [Test Association](./test-association.md)
**Two-pass test detection system**

Explains how Lien links test files to source files:
- **Pass 1**: Convention-based detection (12 languages)
- **Pass 2**: Import analysis (TypeScript, JavaScript, Python)
- Pattern matching algorithms
- Import path resolution
- Framework detection
- Metadata enrichment

**Read this** to understand how test associations work.

**Key diagrams:**
- Two-pass detection overview
- Convention-based detection flowchart
- Import analysis sequence diagram
- Merge strategy flowchart
- Framework detection flowchart

---

## 🎯 Quick Reference

### For New Contributors

1. Start with [System Overview](./system-overview.md) - Get the big picture
2. Read [Data Flow](./data-flow.md) - Understand how data moves
3. Pick a specific area based on what you're working on

### For Understanding Specific Features

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

### For Debugging

| Issue | Check |
|-------|-------|
| Indexing errors | [Indexing Flow](./indexing-flow.md) → Error handling |
| MCP connection issues | [MCP Server Flow](./mcp-server-flow.md) → Initialization |
| Config problems | [Configuration System](./config-system.md) → Validation |
| Missing test associations | [Test Association](./test-association.md) → Detection logic |
| Slow searches | [Data Flow](./data-flow.md) → Performance section |

## 📊 Architecture Principles

### KISS (Keep It Simple, Stupid)
Lien's codebase prioritizes simplicity over cleverness. Each component has a single, clear responsibility.

### Type Safety First
Strong TypeScript usage with branded types prevents entire classes of bugs at compile time.

### Dependency Injection
Services are injected as parameters, making the codebase easy to test and extend.

### Graceful Degradation
Non-essential features fail gracefully without affecting core functionality.

### Local-First
All processing happens locally. No cloud services required. Your code never leaves your machine.

## 🛠️ Technology Stack

- **Language:** TypeScript (ESM modules)
- **CLI Framework:** Commander.js
- **MCP Protocol:** @modelcontextprotocol/sdk
- **Storage:** SQLite via `better-sqlite3` (structural store)
- **Search:** SQLite FTS5 with BM25 ranking (`porter unicode61` tokenizer)
- **Parsing:** Tree-sitter (via `@liendev/parser`)
- **Testing:** Vitest
- **Build:** tsup

## 🔍 Code Organization

See `CLAUDE.md`'s "Package Structure" section for the canonical, actively-maintained version of this map. Summary:

```
packages/parser/src/     # @liendev/parser — zero deps on core; AST, chunking, complexity, scanning
├── ast/
│   ├── languages/    # Per-language definitions (JS, TS, Python, PHP, Rust, etc.)
│   ├── traversers/   # Language-specific AST traversal
│   ├── extractors/   # Import/export/symbol extraction
│   └── complexity/   # Cyclomatic, cognitive, Halstead analyzers
├── risk/             # Blast-radius risk scoring
├── insights/         # Complexity report types
├── ecosystem-presets.ts  # Project-type detection (see ADR-007)
└── scanner.ts, chunker.ts, dependency-analyzer.ts, test-associations.ts, ...

packages/core/src/       # @liendev/core — depends on parser; SQLite store, config, git
├── config/           # GlobalConfig + per-project ConfigService + schema
├── indexer/          # Indexing orchestration: manifest, incremental updates
├── insights/         # ComplexityAnalyzer (VectorDB-aware wrapper) and formatters (text, JSON, SARIF)
├── vectordb/         # VectorDB factory + VectorDBInterface seam
│   └── sqlite/       # SqliteBackend: structural store + FTS5/BM25 lexical search (ADR-011)
├── git/              # Git tracker and utilities
├── errors/           # Error codes and classes
├── types/            # Shared types (CodeChunk, etc.)
└── utils/            # Result type, versioning, path matching

packages/cli/src/        # @liendev/lien — depends on core and parser
├── cli/              # CLI commands (init, index, serve, status, config, complexity, path, annotate)
├── mcp/              # MCP server, tools, and handlers
│   ├── handlers/     # Tool handlers (semantic-search, find-similar, get-files-context, etc.)
│   ├── schemas/      # Zod schemas for tool input validation
│   └── utils/        # Response budgeting, metadata shaping, path matching
├── watcher/          # File watching (uses ecosystem presets for patterns)
├── types/            # Shared TypeScript types
└── utils/            # Utilities (banner, etc.)

packages/review/src/     # @liendev/review (private) — depends on parser only, not core
packages/action/src/     # @liendev/action (private) — GitHub Action entry wrapping @liendev/review
packages/site/           # @liendev/site (private) — VitePress docs site (lien.dev)
```

## 🚀 Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Server startup | ~1s | Open SQLite store — no model to download |
| Index 1000 files | ~35s | With defaults (concurrency=4) |
| Single file change | ~70ms | Incremental update (delete + insert; triggers sync FTS) |
| `get_files_context` | sub-millisecond | Indexed `WHERE file IN (...)` — the hot path |
| FTS5 keyword search | single-digit ms | `chunks_fts MATCH`, ORDER BY bm25 |

*(`get_files_context` and cold-start figures are structural-store spike measurements, PR #645; treat as directional.)*

## 📈 Scalability

### Current Limits
- **Files:** Tested up to 10,000 files
- **Codebase size:** Up to ~1M lines of code
- **Concurrent operations:** Configurable (default: 4)
- **Memory:** modest — no embedding model resident

### Current Scaling
- **Single-repo, local-first**: `SqliteBackend` is the only backend (LanceDB + embeddings were removed — see [ADR-011](decisions/0011-sqlite-structural-store-fts5-lexical-search.md); Qdrant was retired earlier — see [ADR-0010](decisions/0010-retire-qdrant-backend.md))
- **VectorDB factory**: The `createVectorDB` factory and `VectorDBInterface` seam are retained so an alternative backend can be reintroduced

### Future Scaling
- Cloud sync option (planned)
- Team collaboration features (planned)

## 🤝 Contributing

When adding new features or modifying architecture:

1. **Update relevant documentation** in this directory
2. **Add Mermaid diagrams** for visual clarity
3. **Explain the "why"** not just the "how"
4. **Show examples** of real-world usage
5. **Document error cases** and edge cases

## 📝 Diagram Conventions

Our Mermaid diagrams follow these conventions:

**Colors:**
- 🔵 Blue: CLI/User interface layer
- 🟣 Purple: MCP/Protocol layer
- 🟢 Green: Core services
- 🟠 Orange: Data layer
- 🔴 Pink: Optional features
- ⚪ Gray: External dependencies

**Shapes:**
- Rectangles: Components/Services
- Rounded rectangles: Processes
- Diamonds: Decision points
- Circles: Start/End points

**Line Styles:**
- Solid arrows: Data flow
- Dashed arrows: Optional/fallback paths
- Dotted lines: Weak dependencies

## 🔄 Version History

### v0.50.x (Current)
- ✅ LanceDB + embeddings removed; SQLite structural store + FTS5/BM25 lexical search is the only backend (ADR-011)
- ✅ No embedding model download — instant, offline first index; ~1.8MB native install
- ✅ ADR-008 superseded by ADR-011; ADR-011 added

### v0.49.x
- ✅ Docs resynced to match current package layout and product surface
- ✅ `@liendev/parser` extracted from `@liendev/core` (ADR-009)
- ✅ Qdrant backend retired; LanceDB is the only backend at this version (ADR-010)
- ✅ Lien Review shipped as a self-hostable GitHub Action (`packages/review` + `packages/action`), replacing the retired hosted runner/platform
- ✅ `lien path` and `lien annotate` commands added (hook-facing)
- ✅ ADR-009, ADR-010 added

### v0.35.0
- ✅ Docs updated to match current state of codebase
- ✅ Six MCP tools documented (`get_dependents`, `get_complexity` added)
- ✅ Ecosystem presets replace framework detection (ADR-007)
- ✅ Global configuration system (`lien config`)
- ✅ Complexity analyzer and `lien complexity` CLI
- ✅ Embedding backend simplified to WorkerEmbeddings only (ADR-008)
- ✅ ADR-006, ADR-007, ADR-008 added

### v0.8.1
- ✅ Markdown file support for documentation search
- ✅ CONCEPTUAL query improvements

### v0.8.0
- ✅ Query intent classification system
- ✅ Intent-based boosting strategies

### v0.7.0
- ✅ Relevance scoring improvements

### v0.6.0
- ✅ Multiple feature enhancements

### v0.5.0
- ✅ All diagrams created
- ✅ ConfigService refactoring documented
- ✅ Test association system fully documented
- ✅ MCP server flow explained
- ✅ Data flow comprehensive

### Per-Language Definition Pattern
- Consolidated language-specific data into single definition files
- Central registry replaces scattered registries
- See [ADR-005](decisions/0005-per-language-definition-pattern.md)

### Future Updates
- Web dashboard architecture (when implemented)

## 📧 Questions?

If something in the architecture is unclear:
1. Check if there's a diagram for it
2. Read the relevant documentation section
3. Look at the code with the diagram side-by-side
4. Open an issue for documentation improvements

---

**Last Updated:** July 4, 2026
**Maintained By:** Lien contributors
**Status:** ✅ Complete and up-to-date (v0.50.x)


# Architecture Documentation

Welcome to the Lien architecture documentation. This section contains comprehensive diagrams and explanations of how Lien works internally.

## Documentation Overview

### [System Overview](./system-overview)
**High-level component architecture**

A bird's-eye view of Lien's architecture showing CLI layer, MCP server, core services, data layer, optional services, and external dependencies.

**Read this first** to understand the overall system structure.

---

### [Data Flow](./data-flow)
**How data moves through the system**

Detailed flow diagrams showing indexing data flow, search data flow, incremental update flow, and data transformations at each step.

**Read this** to understand how code is processed and searched.

---

### [Indexing Flow](./indexing-flow)
**Full and incremental indexing workflows**

Comprehensive sequence diagrams showing the complete workflow from `lien index` to completion, including chunking strategy, error handling, and performance characteristics.

**Read this** to understand the indexing process in detail.

---

### [MCP Server Flow](./mcp-server-flow)
**MCP server initialization and request handling**

Detailed diagrams of server initialization sequence, tool request handling (semantic_search, find_similar, get_file_context, list_functions), background update monitoring, and integration with AI assistants.

**Read this** to understand how Lien integrates with Cursor and other AI assistants.

---

### [Configuration System](./config-system)
**Config loading, validation, and migration**

Documentation of ConfigService and configuration management, including config migration from v0.2.0 to v0.3.0, validation rules, and schema evolution.

**Read this** to understand configuration management.

---

### [Test Association](./test-association)
**Two-pass test detection system**

Explains how Lien links test files to source files using convention-based detection (12 languages) and import analysis (TypeScript, JavaScript, Python).

**Read this** to understand how test associations work.

---

## Quick Reference

### For New Contributors

1. Start with [System Overview](./system-overview) - Get the big picture
2. Read [Data Flow](./data-flow) - Understand how data moves
3. Pick a specific area based on what you're working on

### For Understanding Specific Features

| Feature | Documentation |
|---------|--------------|
| Indexing a codebase | [Indexing Flow](./indexing-flow) |
| Search queries | [Data Flow](./data-flow) → Search section |
| MCP integration | [MCP Server Flow](./mcp-server-flow) |
| Configuration | [Configuration System](./config-system) |
| Test associations | [Test Association](./test-association) |

### For Debugging

| Issue | Check |
|-------|-------|
| Indexing errors | [Indexing Flow](./indexing-flow) → Error handling |
| MCP connection issues | [MCP Server Flow](./mcp-server-flow) → Initialization |
| Config problems | [Configuration System](./config-system) → Validation |
| Missing test associations | [Test Association](./test-association) → Detection logic |
| Slow searches | [Data Flow](./data-flow) → Performance section |

## Architecture Principles

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

## Technology Stack

- **Language:** TypeScript (ESM modules)
- **CLI Framework:** Commander.js
- **MCP Protocol:** @modelcontextprotocol/sdk
- **Vector Database:** LanceDB
- **Embeddings:** transformers.js (all-MiniLM-L6-v2, runs locally)
- **Testing:** Vitest
- **Build:** tsup

## Code Organization

```
packages/cli/src/
├── cli/              # CLI commands (init, index, serve, status)
├── mcp/              # MCP server and tools
├── indexer/          # File scanning, chunking, test associations
├── embeddings/       # Local embedding generation with cache
├── vectordb/         # LanceDB integration
├── config/           # Configuration management (ConfigService)
├── frameworks/       # Framework detection (Node.js, Laravel)
├── git/              # Git state tracking
├── watcher/          # File watching
├── types/            # Shared TypeScript types
├── utils/            # Utilities (banner, etc.)
├── errors/           # Custom error classes
└── constants.ts      # Centralized constants
```

## Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Server startup | 5-7s | First time only (downloads model) |
| Subsequent starts | 2-3s | Model cached |
| Index 1000 files | ~60s | With defaults (concurrency=4) |
| Single file change | ~360ms | Incremental update |
| Search query (cached) | ~50ms | Embedding cached |
| Search query (uncached) | ~250ms | Generate embedding + search |

## Scalability

### Current Limits
- **Files:** Tested up to 10,000 files
- **Codebase size:** Up to ~1M lines of code
- **Concurrent operations:** Configurable (default: 4)
- **Memory:** ~500MB with model loaded



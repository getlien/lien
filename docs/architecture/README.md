# Lien Architecture Documentation

Welcome to the Lien architecture documentation. This directory contains comprehensive diagrams and explanations of how Lien works internally.

## 📚 Documentation Index

### 🏗️ [System Overview](./system-overview.md)
**High-level component architecture**

A bird's-eye view of Lien's architecture showing:
- CLI layer and commands
- MCP server and tools
- Core services (indexer, scanner, chunker, etc.)
- Data layer (embeddings, vector database)
- Optional services (git tracking, file watching)
- External dependencies

**Read this first** to understand the overall system structure.

**Key diagrams:**
- Component architecture graph
- Technology stack
- Design principles

---

### 🔄 [Data Flow](./data-flow.md)
**How data moves through the system**

Detailed flow diagrams showing:
- **Indexing data flow**: File → Chunks → Embeddings → Vector DB
- **Search data flow**: Query → Embeddings → Vector Search → Results
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
- Tool request handling (semantic_search, find_similar, get_file_context, list_functions)
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
**Config loading, validation, and migration**

Documentation of ConfigService and configuration management:
- Configuration architecture
- Config migration from v0.2.0 to v0.3.0
- Validation rules and error handling
- ConfigService API
- Schema evolution

**Read this** to understand configuration management and the new ConfigService.

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
- **Vector Database:** LanceDB
- **Embeddings:** transformers.js (all-MiniLM-L6-v2, runs locally)
- **Testing:** Vitest
- **Build:** tsup

## 🔍 Code Organization

```
packages/cli/src/
├── cli/              # CLI commands (init, index, serve, status)
├── mcp/              # MCP server and tools
├── indexer/          # File scanning, chunking, test associations
├── embeddings/       # Local embedding generation with cache
├── vectordb/         # LanceDB integration
├── config/           # Configuration management (NEW: ConfigService)
├── frameworks/       # Framework detection (Node.js, Laravel)
├── git/              # Git state tracking
├── watcher/          # File watching
├── types/            # Shared TypeScript types
├── utils/            # Utilities (banner, etc.)
├── errors/           # Custom error classes
└── constants.ts      # Centralized constants
```

## 🚀 Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Server startup | 5-7s | First time only (downloads model) |
| Subsequent starts | 2-3s | Model cached |
| Index 1000 files | ~60s | With defaults (concurrency=4) |
| Single file change | ~360ms | Incremental update |
| Search query (cached) | ~50ms | Embedding cached |
| Search query (uncached) | ~250ms | Generate embedding + search |

## 📈 Scalability

### Current Limits
- **Files:** Tested up to 10,000 files
- **Codebase size:** Up to ~1M lines of code
- **Concurrent operations:** Configurable (default: 4)
- **Memory:** ~500MB with model loaded

### Future Scaling
- Multi-repo support (planned)
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

### v0.8.1 (Current)
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

### Future Updates
- Tree-sitter parsing architecture (when implemented)
- Multi-repo support design (when implemented)
- Web dashboard architecture (when implemented)

## 📧 Questions?

If something in the architecture is unclear:
1. Check if there's a diagram for it
2. Read the relevant documentation section
3. Look at the code with the diagram side-by-side
4. Open an issue for documentation improvements

---

**Last Updated:** November 19, 2025  
**Maintained By:** Lien contributors  
**Status:** ✅ Complete and up-to-date


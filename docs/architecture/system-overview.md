# System Overview

This document provides a high-level overview of Lien's architecture, showing the main components and their relationships.

## Component Architecture

```mermaid
graph TB
    subgraph "CLI Layer"
        CLI[CLI Commands]
        INIT[lien init]
        INDEX[lien index]
        SERVE[lien serve]
        STATUS[lien status]
    end
    
    subgraph "MCP Server Layer"
        MCP[MCP Server]
        TOOLS[MCP Tools]
        SEMANTIC[semantic_search]
        SIMILAR[find_similar]
        CONTEXT[get_file_context]
        LIST[list_functions]
    end
    
    subgraph "Core Services"
        CONFIG[ConfigService]
        INDEXER[Indexer]
        SCANNER[File Scanner]
        CHUNKER[Code Chunker]
        AST[AST Parser]
        TRAVERSER[Language Traversers]
        SYMBOLS[Symbol Extractor]
        TESTASSOC[Test Association Manager]
    end
    
    subgraph "Data Layer"
        EMBEDDINGS[Embeddings Service]
        VECTORDB[Vector Database]
        QUERY[Query Operations]
        BATCHINS[Batch Insert]
        MAINT[Maintenance Ops]
        CACHE[Embedding Cache]
    end
    
    subgraph "Optional Services"
        GIT[Git State Tracker]
        WATCHER[File Watcher]
        FRAMEWORK[Framework Detector]
    end
    
    subgraph "External Dependencies"
        TRANSFORMERS[transformers.js]
        LANCEDB[LanceDB]
        GITCMD[Git CLI]
    end
    
    %% CLI to Core
    CLI --> CONFIG
    INIT --> CONFIG
    INIT --> FRAMEWORK
    INDEX --> INDEXER
    SERVE --> MCP
    STATUS --> CONFIG
    STATUS --> VECTORDB
    
    %% MCP to Core
    MCP --> TOOLS
    TOOLS --> SEMANTIC
    TOOLS --> SIMILAR
    TOOLS --> CONTEXT
    TOOLS --> LIST
    SEMANTIC --> EMBEDDINGS
    SEMANTIC --> VECTORDB
    SIMILAR --> EMBEDDINGS
    SIMILAR --> VECTORDB
    CONTEXT --> VECTORDB
    LIST --> VECTORDB
    
    %% Core Services Relationships
    INDEXER --> CONFIG
    INDEXER --> SCANNER
    INDEXER --> CHUNKER
    INDEXER --> SYMBOLS
    INDEXER --> TESTASSOC
    INDEXER --> EMBEDDINGS
    INDEXER --> VECTORDB
    SCANNER --> FRAMEWORK
    CHUNKER --> AST
    AST --> TRAVERSER
    
    %% Data Layer
    EMBEDDINGS --> CACHE
    EMBEDDINGS --> TRANSFORMERS
    VECTORDB --> QUERY
    VECTORDB --> BATCHINS
    VECTORDB --> MAINT
    QUERY --> LANCEDB
    BATCHINS --> LANCEDB
    MAINT --> LANCEDB
    
    %% Optional Services
    MCP --> GIT
    MCP --> WATCHER
    GIT --> GITCMD
    WATCHER --> INDEXER
    
    %% Styling
    classDef cliClass fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef mcpClass fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef coreClass fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef dataClass fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef optionalClass fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef externalClass fill:#f5f5f5,stroke:#424242,stroke-width:2px
    
    class CLI,INIT,INDEX,SERVE,STATUS cliClass
    class MCP,TOOLS,SEMANTIC,SIMILAR,CONTEXT,LIST mcpClass
    class CONFIG,INDEXER,SCANNER,CHUNKER,AST,TRAVERSER,SYMBOLS,TESTASSOC coreClass
    class EMBEDDINGS,VECTORDB,QUERY,BATCHINS,MAINT,CACHE dataClass
    class GIT,WATCHER,FRAMEWORK optionalClass
    class TRANSFORMERS,LANCEDB,GITCMD externalClass
```

## Component Descriptions

### CLI Layer
- **CLI Commands**: Entry points for user interaction via command line
- **lien init**: Initializes configuration and detects frameworks
- **lien index**: Indexes the codebase into the vector database
- **lien serve**: Starts the MCP server for AI assistant integration
- **lien status**: Shows current index status and configuration

### MCP Server Layer
- **MCP Server**: Implements Model Context Protocol for AI assistant communication
- **MCP Tools**: Four semantic search tools exposed to AI assistants
  - `semantic_search`: Natural language code search
  - `find_similar`: Find similar code patterns
  - `get_file_context`: Get full file context with test associations
  - `list_functions`: List functions/classes by pattern

### Core Services
- **ConfigService**: Manages configuration loading, saving, validation, and migration
- **Indexer**: Orchestrates the indexing workflow
- **File Scanner**: Scans codebase respecting .gitignore and framework boundaries
- **Code Chunker**: Splits files using AST-based semantic chunking or line-based fallback
- **AST Parser**: Parses code into Abstract Syntax Trees using Tree-sitter
- **Language Registry**: Central registry of per-language definitions (grammar, traverser, extractor, complexity data)
- **Language Traversers**: Language-specific logic for traversing AST nodes (Strategy Pattern)
- **Symbol Extractor**: Extracts functions, classes, and interfaces from code
- **Test Association Manager**: Links test files to source files via convention and import analysis

### Data Layer
- **Embeddings Service**: Generates semantic embeddings from code
- **Embedding Cache**: LRU cache for frequently searched queries
- **Vector Database**: Main VectorDB class orchestrating operations
  - **Query Operations**: Semantic search, filtering, and symbol queries
  - **Batch Insert**: Batch vector insertion with retry logic
  - **Maintenance Ops**: CRUD operations (clear, delete, update)

### Optional Services
- **Git State Tracker**: Monitors repository changes for incremental indexing
- **File Watcher**: Real-time file change detection (opt-in)
- **Framework Detector**: Identifies Node.js, Laravel, and other frameworks

### External Dependencies
- **transformers.js**: Local embedding generation (all-MiniLM-L6-v2 model)
- **LanceDB**: Vector database for semantic search
- **Git CLI**: For repository state tracking

## Data Flow

The system follows a clear data flow pattern:

1. **Configuration** → Read by all services for settings
2. **Files** → Scanner → Chunker → Embeddings → Vector DB
3. **Query** → Embeddings → Vector DB → Search Results
4. **Git Changes** → Git Tracker → Incremental Indexer → Vector DB

## Design Principles

### Single Responsibility
Each component has one clear purpose. For example:
- Scanner only finds files
- Chunker only splits content
- Embeddings only generates vectors

### Dependency Injection
Services accept dependencies as parameters, making testing easy:
```typescript
await indexCodebase({ 
  vectorDB,      // Injected
  embeddings,    // Injected
  config         // Injected
});
```

### Layered Architecture
- **CLI/MCP Layer**: User/AI interface
- **Core Layer**: Business logic
- **Data Layer**: Storage and retrieval
- **External Layer**: Third-party services

### Optional Features
Non-essential features (git tracking, file watching) are optional and can be disabled in configuration without affecting core functionality.

## Technology Stack

- **Language**: TypeScript (ESM)
- **CLI**: Commander.js
- **MCP**: @modelcontextprotocol/sdk
- **Vector DB**: LanceDB (vectordb package)
- **Embeddings**: transformers.js (all-MiniLM-L6-v2)
- **Testing**: Vitest
- **Build**: tsup

## Performance Characteristics

- **Concurrency**: Configurable parallel file processing (default: 4)
- **Batch Processing**: Embeddings processed in batches (default: 50)
- **Caching**: LRU cache for embedding queries
- **Lazy Loading**: Embedding model loads on first use
- **Incremental Updates**: Only modified files are reindexed

## Scaling Considerations

### Current Limits
- Single machine, single process
- Embeddings generated locally (no API calls)
- Vector database stored on local disk

### Future Scaling Options
- Multiple embedding models
- Cloud sync (optional)
- Multi-repo support
- Team collaboration features

## Recent Architectural Improvements (v0.13.0-v0.14.0)

### AST-Based Semantic Chunking
- **Replaced**: Line-based chunking with fixed overlap
- **With**: Tree-sitter AST parsing for semantic boundaries
- **Benefit**: Functions never split, 30-35% better search quality
- **Details**: See [ADR-003](decisions/0003-ast-based-chunking.md)

### Language-Agnostic Traversal (Strategy Pattern)
- **Extracted**: Language-specific AST logic into traverser classes
- **Benefit**: Adding new languages (Python, Go, Rust) now takes 2-3 hours instead of 2 days
- **Details**: See [ADR-002](decisions/0002-strategy-pattern-ast-traversal.md)

### Per-Language Definition Pattern
- **Consolidated**: Scattered language data (12-16 files) into single per-language definition files
- **Result**: Each language is one file in `languages/`. Existing modules consume from a central registry.
- **Benefit**: Adding a new AST language requires 4 files instead of 12-16
- **Details**: See [ADR-005](decisions/0005-per-language-definition-pattern.md)

### VectorDB Module Split
- **Split**: Monolithic 1,119-line `lancedb.ts` into focused modules
- **Result**: `query.ts` (571L), `batch-insert.ts` (161L), `maintenance.ts` (89L), `lancedb.ts` (267L orchestrator)
- **Benefit**: Better testability, single responsibility, no AST parsing errors
- **Details**: See [ADR-001](decisions/0001-split-vectordb-module.md)

### Test Association Detection
- **Added**: Automatic detection of test-source relationships
- **Method**: Hybrid convention-based + import analysis
- **Accuracy**: 95% for 12+ test frameworks across 7+ languages
- **Details**: See [ADR-004](decisions/0004-test-association-detection.md)

## Architectural Decision Records

All major architectural decisions are documented in [docs/architecture/decisions/](decisions/):
- [ADR-001: Split VectorDB Module](decisions/0001-split-vectordb-module.md)
- [ADR-002: Strategy Pattern for AST Traversal](decisions/0002-strategy-pattern-ast-traversal.md)
- [ADR-003: AST-Based Semantic Chunking](decisions/0003-ast-based-chunking.md)
- [ADR-004: Test Association Detection](decisions/0004-test-association-detection.md)
- [ADR-005: Per-Language Definition Pattern](decisions/0005-per-language-definition-pattern.md)


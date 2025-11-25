# Indexing Flow

This document details the indexing workflows for both full and incremental indexing operations.

## Full Indexing Flow

Full indexing is triggered by `lien index` command and indexes the entire codebase from scratch.

```mermaid
sequenceDiagram
    actor User
    participant CLI as CLI Command
    participant Config as ConfigService
    participant Scanner as File Scanner
    participant Framework as Framework Detector
    participant TestAssoc as Test Association Manager
    participant Embeddings as Embedding Service
    participant VectorDB as Vector Database
    participant VersionFile as Version File
    
    User->>CLI: lien index
    CLI->>CLI: Show spinner
    
    Note over CLI,Config: Phase 1: Configuration
    CLI->>Config: load(rootDir)
    Config->>Config: Read .lien.config.json
    Config->>Config: Merge with defaults
    Config->>Config: Validate config
    Config-->>CLI: LienConfig
    
    Note over CLI,Scanner: Phase 2: File Discovery
    CLI->>Scanner: scanCodebaseWithFrameworks()
    Scanner->>Framework: Get framework instances
    Framework-->>Scanner: Framework list
    Scanner->>Scanner: Apply include/exclude patterns
    Scanner->>Scanner: Respect framework boundaries
    Scanner->>Scanner: Filter .gitignore
    Scanner-->>CLI: File list (e.g., 1000 files)
    CLI->>CLI: Update spinner: "Found 1000 files"
    
    Note over CLI,TestAssoc: Phase 3: Test Associations
    CLI->>TestAssoc: buildAssociations(files)
    
    rect rgb(255, 243, 224)
        Note right of TestAssoc: Pass 1: Convention-Based
        TestAssoc->>TestAssoc: Partition by framework
        loop For each file
            TestAssoc->>TestAssoc: Check file patterns
            TestAssoc->>TestAssoc: Check directory patterns
            TestAssoc->>TestAssoc: Match test ↔ source
        end
        TestAssoc->>TestAssoc: Build association map
    end
    
    rect rgb(252, 228, 236)
        Note right of TestAssoc: Pass 2: Import Analysis
        TestAssoc->>TestAssoc: Filter Tier 1 languages
        loop For each test file
            TestAssoc->>TestAssoc: Parse import statements
            TestAssoc->>TestAssoc: Resolve file paths
            TestAssoc->>TestAssoc: Link to source files
        end
        TestAssoc->>TestAssoc: Merge with convention map
    end
    
    TestAssoc-->>CLI: Test association map
    CLI->>CLI: Update spinner: "Analyzed test associations"
    
    Note over CLI,Embeddings: Phase 4: Initialize Services
    CLI->>Embeddings: initialize()
    Embeddings->>Embeddings: Load all-MiniLM-L6-v2 model
    Embeddings->>Embeddings: Cache model in memory
    Embeddings-->>CLI: Ready
    CLI->>CLI: Update spinner: "Embedding model loaded"
    
    CLI->>VectorDB: initialize()
    VectorDB->>VectorDB: Connect to LanceDB
    VectorDB->>VectorDB: Create table if not exists
    VectorDB-->>CLI: Ready
    CLI->>CLI: Update spinner: "Vector database initialized"
    
    Note over CLI,VectorDB: Phase 5: File Processing (Concurrent)
    CLI->>CLI: Start progress tracking
    
    par Process File 1
        CLI->>CLI: Read file content
        CLI->>CLI: Detect language (TS/JS/etc.)
        alt Language supports AST
            CLI->>CLI: Parse with Tree-sitter
            CLI->>CLI: Get LanguageTraverser
            CLI->>CLI: Extract semantic chunks (functions, methods)
            CLI->>CLI: Calculate complexity metrics
        else Unsupported or fallback
            CLI->>CLI: Chunk by lines (75 lines, 10 overlap)
        end
        CLI->>CLI: Extract symbols
        CLI->>CLI: Add test associations
        CLI->>CLI: Accumulate chunks
    and Process File 2
        CLI->>CLI: Read file content
        CLI->>CLI: Detect language
        CLI->>CLI: Chunk file (AST or line-based)
        CLI->>CLI: Extract symbols
        CLI->>CLI: Add test associations
        CLI->>CLI: Accumulate chunks
    and Process File 3
        CLI->>CLI: Read file content
        CLI->>CLI: Detect language
        CLI->>CLI: Chunk file
        CLI->>CLI: Extract symbols
        CLI->>CLI: Add test associations
        CLI->>CLI: Accumulate chunks
    and Process File N
        CLI->>CLI: Read file content
        CLI->>CLI: Detect language
        CLI->>CLI: Chunk file
        CLI->>CLI: Extract symbols
        CLI->>CLI: Add test associations
        CLI->>CLI: Accumulate chunks
    end
    
    Note over CLI,VectorDB: Phase 6: Batch Embedding & Storage
    loop For each batch (50 chunks)
        CLI->>Embeddings: embedBatch(texts[])
        Embeddings->>Embeddings: Tokenize texts
        Embeddings->>Embeddings: Generate embeddings
        Embeddings->>Embeddings: Normalize vectors
        Embeddings-->>CLI: Float32Array[] (384 dims each)
        
        CLI->>VectorDB: insertBatch(vectors, metadata, texts)
        VectorDB->>VectorDB: Prepare records
        VectorDB->>VectorDB: Batch insert to LanceDB
        VectorDB-->>CLI: Success
        
        CLI->>CLI: Update progress
    end
    
    Note over CLI,VersionFile: Phase 7: Finalization
    CLI->>VersionFile: writeVersionFile()
    VersionFile->>VersionFile: Generate timestamp
    VersionFile->>VersionFile: Write version.json
    VersionFile-->>CLI: Success
    
    CLI->>CLI: Calculate statistics
    CLI->>CLI: Show success message
    CLI-->>User: ✓ Indexed 1000 files (2500 chunks) in 45s
```

## Incremental Indexing Flow

Incremental indexing handles individual file changes without reindexing the entire codebase.

```mermaid
sequenceDiagram
    participant Source as Git/FileWatcher
    participant MCP as MCP Server
    participant Config as ConfigService
    participant Incremental as Incremental Indexer
    participant Embeddings as Embedding Service
    participant VectorDB as Vector Database
    participant VersionFile as Version File
    participant Client as MCP Client (AI)
    
    Note over Source,MCP: Change Detection
    Source->>Source: Detect file change
    Source->>MCP: Notify: files changed
    MCP->>MCP: Debounce changes (1s)
    
    Note over MCP,Incremental: Background Reindex
    MCP->>Config: load(rootDir)
    Config-->>MCP: LienConfig
    
    loop For each changed file
        MCP->>Incremental: indexSingleFile(filepath)
        
        alt File exists
            Incremental->>Incremental: Read file content
            Incremental->>Incremental: Check if binary
            
            alt Is valid code file
                Note over Incremental: Same as full indexing
                Incremental->>Incremental: Chunk file
                Incremental->>Incremental: Extract symbols
                Incremental->>Embeddings: embedBatch(chunks)
                Embeddings-->>Incremental: vectors
                
                Note over Incremental,VectorDB: Atomic Update
                Incremental->>VectorDB: updateFile(filepath, vectors, metadata)
                VectorDB->>VectorDB: Begin transaction
                VectorDB->>VectorDB: Delete old chunks (WHERE file = ?)
                VectorDB->>VectorDB: Insert new chunks
                VectorDB->>VectorDB: Commit transaction
                VectorDB-->>Incremental: Success
                
                Incremental->>MCP: Log: ✓ Updated filepath
            else Is binary or empty
                Incremental->>VectorDB: deleteByFile(filepath)
                VectorDB->>VectorDB: DELETE WHERE file = ?
                VectorDB-->>Incremental: Success
                Incremental->>MCP: Log: Removed empty/binary file
            end
        else File deleted
            Incremental->>VectorDB: deleteByFile(filepath)
            VectorDB->>VectorDB: DELETE WHERE file = ?
            VectorDB-->>Incremental: Success
            Incremental->>MCP: Log: Removed deleted file
        end
    end
    
    Note over MCP,VersionFile: Update Version
    MCP->>VersionFile: writeVersionFile()
    VersionFile->>VersionFile: Increment version
    VersionFile->>VersionFile: Write version.json
    VersionFile-->>MCP: Success
    
    Note over MCP,Client: Version Check & Reconnect
    loop Every 2 seconds
        MCP->>VersionFile: Check version
        VersionFile-->>MCP: Current version
        
        alt Version changed
            MCP->>VectorDB: reconnect()
            VectorDB->>VectorDB: Close old connection
            VectorDB->>VectorDB: Open new connection
            VectorDB->>VectorDB: Reload index
            VectorDB-->>MCP: Reconnected
            MCP->>MCP: Log: Reconnected to updated index
        else No change
            MCP->>MCP: Continue polling
        end
    end
    
    Note over Client: Next Query
    Client->>MCP: semantic_search("new code")
    MCP->>VectorDB: search(query)
    VectorDB-->>MCP: Results (includes newly indexed code)
    MCP-->>Client: Return results
```

## Chunking Strategy

Lien uses **AST-based semantic chunking** for supported languages (TypeScript, JavaScript) and falls back to line-based chunking for others.

### AST-Based Semantic Chunking (v0.13.0+)

```mermaid
graph TD
    subgraph "Source File (calculator.ts)"
        IMPORTS["import statements<br/>(lines 1-3)"]
        CLASS["class Calculator {<br/>(lines 5-6)"]
        ADD["  add(a, b) { ... }<br/>(lines 7-10)"]
        SUB["  subtract(a, b) { ... }<br/>(lines 12-15)"]
        MUL["  multiply(a, b) { ... }<br/>(lines 17-25)"]
        CLOSE["}<br/>(line 26)"]
    end
    
    subgraph "AST Analysis"
        PARSE["Parse with Tree-sitter"]
        TRAVERSE["Get LanguageTraverser<br/>(Strategy Pattern)"]
        EXTRACT["Extract top-level nodes<br/>(methods, functions)"]
    end
    
    subgraph "Semantic Chunks"
        CHUNK1["Chunk 1: Import block<br/>Lines 1-3<br/>Type: block"]
        CHUNK2["Chunk 2: add method<br/>Lines 7-10<br/>Type: function<br/>Parent: Calculator<br/>Complexity: 1"]
        CHUNK3["Chunk 3: subtract method<br/>Lines 12-15<br/>Type: function<br/>Parent: Calculator<br/>Complexity: 1"]
        CHUNK4["Chunk 4: multiply method<br/>Lines 17-25<br/>Type: function<br/>Parent: Calculator<br/>Complexity: 3"]
    end
    
    IMPORTS --> PARSE
    CLASS --> PARSE
    ADD --> PARSE
    SUB --> PARSE
    MUL --> PARSE
    CLOSE --> PARSE
    
    PARSE --> TRAVERSE
    TRAVERSE --> EXTRACT
    EXTRACT --> CHUNK1
    EXTRACT --> CHUNK2
    EXTRACT --> CHUNK3
    EXTRACT --> CHUNK4
    
    style CHUNK2 fill:#e1f5ff
    style CHUNK3 fill:#f3e5f5
    style CHUNK4 fill:#e8f5e9
```

### Key Advantages of AST Chunking

**❌ Old (Line-Based):**
```typescript
// Chunk 1 (lines 1-75) - Function split!
class Calculator {
  multiply(a: number, b: number): number {
    let result = 0;
    for (let i = 0; i < b; i++) {
      result += a;
    }
    
// Chunk 2 (lines 66-140) - Missing function start!
    return result;
  }
}
```

**✅ New (AST-Based):**
```typescript
// Chunk: multiply method (complete semantic unit)
multiply(a: number, b: number): number {
  let result = 0;
  for (let i = 0; i < b; i++) {
    result += a;
  }
  return result;
}

// Metadata:
{
  "symbolName": "multiply",
  "symbolType": "method",
  "parentClass": "Calculator",
  "complexity": 3,
  "parameters": ["a: number", "b: number"],
  "signature": "multiply(a: number, b: number): number"
}
```

### Language Traverser (Strategy Pattern)

Each language has a dedicated traverser implementing the `LanguageTraverser` interface:

```mermaid
graph LR
    CHUNKER["Chunker<br/>(language-agnostic)"]
    REGISTRY["Traverser Registry"]
    TS["TypeScriptTraverser"]
    JS["JavaScriptTraverser"]
    PY["PythonTraverser<br/>(future)"]
    
    CHUNKER -->|getTraverser(language)| REGISTRY
    REGISTRY -->|typescript| TS
    REGISTRY -->|javascript| JS
    REGISTRY -->|python| PY
    
    TS -.->|"Node types:<br/>function_declaration<br/>method_definition<br/>class_declaration"| TS
    JS -.->|"Same as TS"| JS
    PY -.->|"Node types:<br/>function_definition<br/>class_definition"| PY
```

**Traverser responsibilities:**
- Define target node types (`function_declaration`, `class_definition`, etc.)
- Identify containers to extract children from (classes)
- Find parent context (class name for methods)
- Detect functions in declarations (arrow functions in const/let)

See [ADR-002: Strategy Pattern for AST Traversal](decisions/0002-strategy-pattern-ast-traversal.md) for details.

### Fallback to Line-Based Chunking

AST chunking automatically falls back to line-based for:
- **Unsupported languages** (Python, Go, Rust - until traversers are added)
- **Very large files** (>1000 lines trigger Tree-sitter buffer limits)
- **Parse errors** (malformed syntax)

**Line-based chunking (fallback):**
- Fixed chunk size (default: 75 lines)
- Fixed overlap (default: 10 lines)
- No semantic awareness
- Still works, just less optimal

## Performance Characteristics

### Full Indexing

Typical performance on a medium-sized project:

```
Project Size: 1,000 files, 100,000 lines of code
Configuration: 
  - concurrency: 4
  - chunkSize: 75
  - embeddingBatchSize: 50

Timeline:
  Configuration:        ~0.5s
  File Discovery:       ~2s
  Test Associations:    ~3s (Pass 1) + ~2s (Pass 2)
  Embedding Model Load: ~5s (first time only)
  Vector DB Init:       ~1s
  File Processing:      ~25s (4 concurrent workers)
  Embedding Generation: ~15s (batched)
  Storage:              ~5s
  Total:                ~58s

Chunks Created: ~2,000
Average: 17 files/second
```

### Incremental Indexing

Typical performance for file changes:

```
Single File Change (100 lines):
  Read & Chunk:      ~50ms
  Generate Embeddings: ~200ms
  Update Database:   ~100ms
  Update Version:    ~10ms
  Total:             ~360ms

10 Files Changed:
  Sequential Processing: ~3.6s
  Version Update:        ~10ms
  Total:                 ~3.61s

Note: Runs in background, doesn't block MCP server
```

## Error Handling Strategies

### File Processing Errors

```mermaid
flowchart TD
    START[Process File]
    READ{Read File}
    BINARY{Is Binary?}
    PARSE{Can Parse?}
    CHUNK[Chunk File]
    EMBED[Generate Embeddings]
    STORE[Store in DB]
    SUCCESS[✓ Success]
    
    READ -->|Success| BINARY
    READ -->|Error| SKIP1[Skip: Cannot read]
    
    BINARY -->|No| PARSE
    BINARY -->|Yes| SKIP2[Skip: Binary file]
    
    PARSE -->|Yes| CHUNK
    PARSE -->|No| WARN[Warn: Parse error, continue]
    WARN --> CHUNK
    
    CHUNK --> EMBED
    EMBED -->|Success| STORE
    EMBED -->|Error| RETRY{Retry?}
    
    RETRY -->|First attempt| EMBED
    RETRY -->|Failed twice| SKIP3[Skip: Embedding failed]
    
    STORE -->|Success| SUCCESS
    STORE -->|Error| FAIL[✗ Fail: DB error]
    
    style SUCCESS fill:#c8e6c9
    style FAIL fill:#ffcdd2
    style SKIP1 fill:#fff9c4
    style SKIP2 fill:#fff9c4
    style SKIP3 fill:#fff9c4
    style WARN fill:#ffe0b2
```

### Recovery Strategies

1. **Non-critical errors** (binary files, parse errors):
   - Log warning
   - Skip file
   - Continue with remaining files

2. **Retryable errors** (embedding generation):
   - Retry once
   - If fails again, skip file
   - Continue with remaining files

3. **Critical errors** (database connection, disk full):
   - Log error
   - Rollback transaction if in progress
   - Throw error to user
   - Abort indexing

## Optimization Techniques

### 1. Concurrency Control

```typescript
// Use p-limit to control parallelism
const limit = pLimit(concurrency); // e.g., 4

const promises = files.map(file =>
  limit(async () => {
    // Process file
  })
);

await Promise.all(promises);
```

**Benefits:**
- Prevents overwhelming the system
- Balances CPU and I/O
- Configurable via `core.concurrency`

### 2. Batch Processing

```typescript
// Instead of one-by-one:
for (const chunk of chunks) {
  const vector = await embed(chunk); // ❌ Slow: N × 200ms
  await store(vector);
}

// Process in batches:
for (let i = 0; i < chunks.length; i += batchSize) {
  const batch = chunks.slice(i, i + batchSize);
  const vectors = await embedBatch(batch); // ✅ Fast: 200ms per batch
  await storeBatch(vectors);
}
```

**Benefits:**
- Reduces overhead
- Better GPU/CPU utilization
- Configurable via `core.embeddingBatchSize`

### 3. Accumulator Pattern

```typescript
// Accumulate chunks from multiple files
const accumulator = [];

for (const file of files) {
  const chunks = await processFile(file);
  accumulator.push(...chunks);
  
  // Process when batch is full
  if (accumulator.length >= batchSize) {
    await processBatch(accumulator.splice(0, batchSize));
  }
}

// Process remaining
if (accumulator.length > 0) {
  await processBatch(accumulator);
}
```

**Benefits:**
- Maximizes batch sizes
- Reduces number of API/DB calls
- More efficient resource usage

## Monitoring & Progress

### User-Visible Progress

```
Starting indexing process...
✓ Configuration loaded
✓ Found 1,000 files
✓ Analyzed test associations (250 tests → 400 sources)
✓ Embedding model loaded
✓ Vector database initialized
⏳ Processing files... [==============    ] 650/1000 (65%)
✓ Indexed 1,000 files
✓ Generated 2,500 chunks
✓ Stored embeddings (384 dimensions)
✓ Completed in 58.2s

Statistics:
  Files processed: 1,000
  Chunks created: 2,500
  Average chunk size: 40 lines
  Processing speed: 17 files/s
```

### Verbose Mode

```bash
lien index --verbose

# Additional output:
[Lien] Reading file: src/app.ts
[Lien] Detected language: typescript
[Lien] Chunked into 3 chunks
[Lien] Extracted 5 functions, 2 classes
[Lien] ✓ Indexed src/app.ts (3 chunks)
[Lien] Batch embedding: 50 chunks
[Lien] Batch insert: 50 vectors
[Lien] ⚠️ Skipping src/image.png: Binary file
[Lien] ⚠️ Skipping src/broken.ts: Parse error
```

## Index Version Management

### Version File Structure

```json
{
  "version": 1731785400000,
  "timestamp": "2025-11-16T20:30:00.000Z",
  "config": {
    "chunkSize": 75,
    "chunkOverlap": 10,
    "concurrency": 4
  },
  "stats": {
    "filesIndexed": 1000,
    "chunksCreated": 2500,
    "embeddingModel": "all-MiniLM-L6-v2"
  }
}
```

### Version Check Flow

```
MCP Server starts → Read version file → Store in memory
Every 2s: Check file → Compare versions → Reconnect if changed

This allows:
- `lien index` can run while MCP server is running
- Server automatically picks up changes
- No need to restart Cursor/AI assistant
```


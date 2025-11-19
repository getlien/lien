# Data Flow

This document illustrates how data flows through Lien during indexing and searching operations.

## Indexing Data Flow

The indexing flow transforms source code files into searchable vector embeddings.

```mermaid
flowchart TB
    START([User runs 'lien index'])
    
    subgraph "Configuration Loading"
        LOAD_CONFIG[Load Configuration]
        DETECT_FW[Detect Frameworks]
        MERGE_CONFIG[Merge with Defaults]
    end
    
    subgraph "File Discovery"
        SCAN_START[Start File Scanning]
        READ_GITIGNORE[Read .gitignore]
        APPLY_PATTERNS[Apply Include/Exclude Patterns]
        FILTER_FRAMEWORK[Filter by Framework Boundaries]
        FILE_LIST[Generate File List]
    end
    
    subgraph "Test Association (Pass 1)"
        CONVENTION_DETECT[Convention-Based Detection]
        PATTERN_MATCH[Match File Patterns]
        DIR_MATCH[Match Directory Patterns]
        ASSOC_MAP1[Build Association Map]
    end
    
    subgraph "Test Association (Pass 2)"
        IMPORT_ANALYSIS[Import Analysis]
        PARSE_IMPORTS[Parse Import Statements]
        RESOLVE_PATHS[Resolve File Paths]
        ASSOC_MAP2[Merge Association Map]
    end
    
    subgraph "File Processing (Concurrent)"
        READ_FILE[Read File Content]
        DETECT_LANG[Detect Language]
        CHUNK_FILE[Chunk into Segments]
        EXTRACT_SYMBOLS[Extract Symbols]
        ADD_METADATA[Add Metadata]
    end
    
    subgraph "Embedding Generation (Batched)"
        BATCH_CHUNKS[Batch Chunks]
        TOKENIZE[Tokenize Text]
        GENERATE_EMB[Generate Embeddings]
        NORMALIZE[Normalize Vectors]
    end
    
    subgraph "Vector Storage"
        PREP_INSERT[Prepare Insert]
        BATCH_INSERT[Batch Insert to LanceDB]
        UPDATE_INDEX[Update Index Version]
        WRITE_VERSION[Write Version File]
    end
    
    END([Indexing Complete])
    
    %% Main Flow
    START --> LOAD_CONFIG
    LOAD_CONFIG --> DETECT_FW
    DETECT_FW --> MERGE_CONFIG
    MERGE_CONFIG --> SCAN_START
    
    SCAN_START --> READ_GITIGNORE
    READ_GITIGNORE --> APPLY_PATTERNS
    APPLY_PATTERNS --> FILTER_FRAMEWORK
    FILTER_FRAMEWORK --> FILE_LIST
    
    FILE_LIST --> CONVENTION_DETECT
    CONVENTION_DETECT --> PATTERN_MATCH
    PATTERN_MATCH --> DIR_MATCH
    DIR_MATCH --> ASSOC_MAP1
    
    ASSOC_MAP1 --> IMPORT_ANALYSIS
    IMPORT_ANALYSIS --> PARSE_IMPORTS
    PARSE_IMPORTS --> RESOLVE_PATHS
    RESOLVE_PATHS --> ASSOC_MAP2
    
    ASSOC_MAP2 --> READ_FILE
    READ_FILE --> DETECT_LANG
    DETECT_LANG --> CHUNK_FILE
    CHUNK_FILE --> EXTRACT_SYMBOLS
    EXTRACT_SYMBOLS --> ADD_METADATA
    
    ADD_METADATA --> BATCH_CHUNKS
    BATCH_CHUNKS --> TOKENIZE
    TOKENIZE --> GENERATE_EMB
    GENERATE_EMB --> NORMALIZE
    
    NORMALIZE --> PREP_INSERT
    PREP_INSERT --> BATCH_INSERT
    BATCH_INSERT --> UPDATE_INDEX
    UPDATE_INDEX --> WRITE_VERSION
    WRITE_VERSION --> END
    
    %% Styling
    classDef configClass fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef scanClass fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef testClass fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef processClass fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef embedClass fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef storageClass fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    
    class LOAD_CONFIG,DETECT_FW,MERGE_CONFIG configClass
    class SCAN_START,READ_GITIGNORE,APPLY_PATTERNS,FILTER_FRAMEWORK,FILE_LIST scanClass
    class CONVENTION_DETECT,PATTERN_MATCH,DIR_MATCH,ASSOC_MAP1,IMPORT_ANALYSIS,PARSE_IMPORTS,RESOLVE_PATHS,ASSOC_MAP2 testClass
    class READ_FILE,DETECT_LANG,CHUNK_FILE,EXTRACT_SYMBOLS,ADD_METADATA processClass
    class BATCH_CHUNKS,TOKENIZE,GENERATE_EMB,NORMALIZE embedClass
    class PREP_INSERT,BATCH_INSERT,UPDATE_INDEX,WRITE_VERSION storageClass
```

## Search Data Flow

The search flow transforms natural language queries into relevant code results.

```mermaid
flowchart TB
    START([AI Assistant Query])
    
    subgraph "MCP Request Handling"
        RECEIVE[Receive MCP Tool Call]
        VALIDATE[Validate Parameters]
        EXTRACT[Extract Query Text]
    end
    
    subgraph "Embedding Generation"
        CHECK_CACHE{Check Cache}
        CACHE_HIT[Cache Hit]
        TOKENIZE[Tokenize Query]
        GENERATE[Generate Embedding]
        STORE_CACHE[Store in Cache]
        GET_VECTOR[Get Query Vector]
    end
    
    subgraph "Vector Search"
        LOAD_INDEX[Load Vector Index]
        CALC_SIMILARITY[Calculate Cosine Similarity]
        RANK_RESULTS[Rank by Similarity]
        APPLY_LIMIT[Apply Result Limit]
    end
    
    subgraph "Post-Processing"
        FETCH_METADATA[Fetch Chunk Metadata]
        LOAD_TEST_ASSOC[Load Test Associations]
        FORMAT_RESULTS[Format Results]
        ADD_INDEX_INFO[Add Index Metadata]
    end
    
    subgraph "Response"
        BUILD_RESPONSE[Build MCP Response]
        RETURN[Return to AI Assistant]
    end
    
    END([Query Complete])
    
    %% Main Flow
    START --> RECEIVE
    RECEIVE --> VALIDATE
    VALIDATE --> EXTRACT
    EXTRACT --> CHECK_CACHE
    
    CHECK_CACHE -->|Hit| CACHE_HIT
    CHECK_CACHE -->|Miss| TOKENIZE
    CACHE_HIT --> GET_VECTOR
    TOKENIZE --> GENERATE
    GENERATE --> STORE_CACHE
    STORE_CACHE --> GET_VECTOR
    
    GET_VECTOR --> LOAD_INDEX
    LOAD_INDEX --> CALC_SIMILARITY
    CALC_SIMILARITY --> RANK_RESULTS
    RANK_RESULTS --> APPLY_LIMIT
    
    APPLY_LIMIT --> FETCH_METADATA
    FETCH_METADATA --> LOAD_TEST_ASSOC
    LOAD_TEST_ASSOC --> FORMAT_RESULTS
    FORMAT_RESULTS --> ADD_INDEX_INFO
    
    ADD_INDEX_INFO --> BUILD_RESPONSE
    BUILD_RESPONSE --> RETURN
    RETURN --> END
    
    %% Styling
    classDef mcpClass fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef embedClass fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef searchClass fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef processClass fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef responseClass fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    
    class RECEIVE,VALIDATE,EXTRACT mcpClass
    class CHECK_CACHE,CACHE_HIT,TOKENIZE,GENERATE,STORE_CACHE,GET_VECTOR embedClass
    class LOAD_INDEX,CALC_SIMILARITY,RANK_RESULTS,APPLY_LIMIT searchClass
    class FETCH_METADATA,LOAD_TEST_ASSOC,FORMAT_RESULTS,ADD_INDEX_INFO processClass
    class BUILD_RESPONSE,RETURN responseClass
```

## Query Intent Classification (v0.8.0)

Lien automatically classifies queries to apply optimized search strategies for each intent type.

```mermaid
flowchart TB
    START([Query Received])
    
    subgraph "Intent Detection"
        ANALYZE[Analyze Query Text]
        CHECK_LOCATION{Location Keywords?}
        CHECK_CONCEPTUAL{Conceptual Keywords?}
        CHECK_IMPL{Implementation Keywords?}
        DEFAULT[Default: IMPLEMENTATION]
    end
    
    subgraph "Intent Types"
        LOCATION["LOCATION<br/>'where is X'<br/>'find X'"]
        CONCEPTUAL["CONCEPTUAL<br/>'how does X work'<br/>'explain X'"]
        IMPLEMENTATION["IMPLEMENTATION<br/>'show X'<br/>'X functionality'"]
    end
    
    subgraph "Boosting Strategy"
        APPLY_BOOST[Apply Intent-Specific Boost]
        LOCATION_BOOST["+90% filename match<br/>+35% path match"]
        CONCEPTUAL_BOOST["+35% documentation<br/>+10% config files"]
        IMPL_BOOST["+20% source files<br/>+5% utilities"]
    end
    
    SEARCH[Execute Search]
    END([Boosted Results])
    
    %% Flow
    START --> ANALYZE
    ANALYZE --> CHECK_LOCATION
    CHECK_LOCATION -->|Yes| LOCATION
    CHECK_LOCATION -->|No| CHECK_CONCEPTUAL
    CHECK_CONCEPTUAL -->|Yes| CONCEPTUAL
    CHECK_CONCEPTUAL -->|No| CHECK_IMPL
    CHECK_IMPL -->|Yes| IMPLEMENTATION
    CHECK_IMPL -->|No| DEFAULT
    DEFAULT --> IMPLEMENTATION
    
    LOCATION --> APPLY_BOOST
    CONCEPTUAL --> APPLY_BOOST
    IMPLEMENTATION --> APPLY_BOOST
    
    APPLY_BOOST -->|LOCATION| LOCATION_BOOST
    APPLY_BOOST -->|CONCEPTUAL| CONCEPTUAL_BOOST
    APPLY_BOOST -->|IMPLEMENTATION| IMPL_BOOST
    
    LOCATION_BOOST --> SEARCH
    CONCEPTUAL_BOOST --> SEARCH
    IMPL_BOOST --> SEARCH
    SEARCH --> END
    
    %% Styling
    classDef detectionClass fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef intentClass fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef boostClass fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef searchClass fill:#fff3e0,stroke:#e65100,stroke-width:2px
    
    class ANALYZE,CHECK_LOCATION,CHECK_CONCEPTUAL,CHECK_IMPL,DEFAULT detectionClass
    class LOCATION,CONCEPTUAL,IMPLEMENTATION intentClass
    class APPLY_BOOST,LOCATION_BOOST,CONCEPTUAL_BOOST,IMPL_BOOST boostClass
    class SEARCH searchClass
```

### Intent Detection Patterns

**LOCATION Intent:**
- Patterns: `where is`, `find`, `locate`, `what file`, `which file`
- Strategy: Strong filename and path matching boost
- Use case: Finding specific files or components

**CONCEPTUAL Intent:**
- Patterns: `how does`, `how is`, `what is`, `explain`, `understand`, `architecture`, `design`
- Strategy: Prioritize documentation and architecture files
- Use case: Understanding system design and workflows

**IMPLEMENTATION Intent:**
- Patterns: `show`, `implementation`, `code for`, `function`, `class`
- Strategy: Balanced boost favoring source code
- Use case: Studying specific implementations

### Performance Impact

- **Classification time:** <1ms per query
- **Accuracy:** 100% on tested queries
- **Result quality improvement:** +23% overall (7.5/10 → 9.2/10)
- **Highly relevant results:** +52% increase (23% → 35%)

## Relevance Scoring (v0.7.0)

All search results include both a numeric score and a human-readable relevance category.

```mermaid
flowchart LR
    START([Vector Search Results])
    
    subgraph "Scoring"
        COSINE[Cosine Distance Score]
        NORMALIZE[Lower = More Similar]
    end
    
    subgraph "Categorization"
        EVALUATE{Evaluate Score}
        HIGHLY["highly_relevant<br/>score < 1.0"]
        RELEVANT["relevant<br/>score 1.0-1.3"]
        LOOSELY["loosely_related<br/>score 1.3-1.5"]
        NOT_REL["not_relevant<br/>score ≥ 1.5"]
    end
    
    subgraph "Output"
        FORMAT[Format Results]
        INCLUDE[Include Both<br/>Score + Category]
    end
    
    END([Results with Relevance])
    
    START --> COSINE
    COSINE --> NORMALIZE
    NORMALIZE --> EVALUATE
    EVALUATE -->|< 1.0| HIGHLY
    EVALUATE -->|1.0-1.3| RELEVANT
    EVALUATE -->|1.3-1.5| LOOSELY
    EVALUATE -->|≥ 1.5| NOT_REL
    
    HIGHLY --> FORMAT
    RELEVANT --> FORMAT
    LOOSELY --> FORMAT
    NOT_REL --> FORMAT
    FORMAT --> INCLUDE
    INCLUDE --> END
    
    %% Styling
    classDef scoreClass fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef catClass fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef outputClass fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    
    class COSINE,NORMALIZE scoreClass
    class EVALUATE,HIGHLY,RELEVANT,LOOSELY,NOT_REL catClass
    class FORMAT,INCLUDE outputClass
```

### Relevance Categories

| Category | Score Range | Meaning | Typical Use |
|----------|-------------|---------|-------------|
| `highly_relevant` | < 1.0 | Very close semantic match | Direct answers |
| `relevant` | 1.0 - 1.3 | Good match, useful context | Supporting context |
| `loosely_related` | 1.3 - 1.5 | Tangentially related | Background info |
| `not_relevant` | ≥ 1.5 | Weak match | Usually filtered out |

### Example Response

```json
{
  "results": [
    {
      "content": "async function authenticateUser(credentials) { ... }",
      "metadata": {
        "file": "src/auth/service.ts",
        "startLine": 42
      },
      "score": 0.94,
      "relevance": "highly_relevant"
    },
    {
      "content": "// Authentication middleware for Express",
      "metadata": {
        "file": "src/middleware/auth.ts",
        "startLine": 12
      },
      "score": 1.15,
      "relevance": "relevant"
    }
  ]
}
```

## Markdown Indexing (v0.8.1)

Lien indexes documentation files alongside code for comprehensive semantic search.

### Supported Formats

- `.md` - Markdown files
- `.mdx` - MDX (Markdown + JSX)
- Auto-included:
  - `README.md`
  - `CHANGELOG.md`
  - `CONTRIBUTING.md`
  - `docs/` directory

### Processing Pipeline

```mermaid
flowchart LR
    START([Markdown File])
    
    DETECT[Detect .md/.mdx]
    LANG[Set Language: 'markdown']
    CHUNK[Chunk by Sections]
    EMBED[Generate Embeddings]
    STORE[Store with Metadata]
    
    BOOST[+35% Boost for<br/>CONCEPTUAL Queries]
    
    END([Searchable Documentation])
    
    START --> DETECT
    DETECT --> LANG
    LANG --> CHUNK
    CHUNK --> EMBED
    EMBED --> STORE
    STORE --> BOOST
    BOOST --> END
    
    %% Styling
    classDef processClass fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef boostClass fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    
    class DETECT,LANG,CHUNK,EMBED,STORE processClass
    class BOOST boostClass
```

### Impact

- **Files indexed:** +17 documentation files
- **Searchable content:** +127 chunks (+58%)
- **CONCEPTUAL query quality:** 9.5/10 (+19% improvement)
- **Documentation relevance:** 95% for "how does X work" queries
- **Indexing time:** +6.2s (acceptable for quality gain)

### Benefits

1. **Multi-perspective results:** Code + docs + architecture in one search
2. **Faster onboarding:** Documentation appears for conceptual queries
3. **Better understanding:** Architectural context alongside implementation
4. **Knowledge navigation:** Transforms Lien from "code finder" to "knowledge navigator"

## Incremental Update Data Flow

When files change, only modified files are reindexed.

```mermaid
flowchart TB
    START([File Change Detected])
    
    subgraph "Change Detection"
        GIT_DETECT{Git Detection?}
        CHECK_COMMIT[Check Git Commit Hash]
        FILE_WATCH{File Watcher?}
        DETECT_CHANGE[Detect File Changes]
    end
    
    subgraph "Change Analysis"
        GET_CHANGED[Get Changed Files]
        FILTER_IGNORED[Filter Ignored Files]
        CHECK_DELETED{File Deleted?}
    end
    
    subgraph "Deletion Path"
        DELETE_CHUNKS[Delete File Chunks]
        UPDATE_VERSION_DEL[Update Index Version]
    end
    
    subgraph "Update Path"
        READ_NEW[Read New Content]
        RECHUNK[Re-chunk File]
        REEMBED[Re-generate Embeddings]
        ATOMIC_UPDATE[Atomic Update<br/>Delete Old + Insert New]
        UPDATE_VERSION_UPD[Update Index Version]
    end
    
    subgraph "Reconnection"
        VERSION_POLL[Poll for Version Changes]
        RECONNECT{Version Changed?}
        RELOAD_INDEX[Reload Vector Index]
        NOTIFY[Notify MCP Clients]
    end
    
    END([Update Complete])
    
    %% Main Flow - Git
    START --> GIT_DETECT
    GIT_DETECT -->|Yes| CHECK_COMMIT
    CHECK_COMMIT --> GET_CHANGED
    
    %% Main Flow - File Watcher
    GIT_DETECT -->|No| FILE_WATCH
    FILE_WATCH -->|Yes| DETECT_CHANGE
    DETECT_CHANGE --> GET_CHANGED
    
    FILE_WATCH -->|No| END
    
    %% Change Processing
    GET_CHANGED --> FILTER_IGNORED
    FILTER_IGNORED --> CHECK_DELETED
    
    %% Deletion
    CHECK_DELETED -->|Yes| DELETE_CHUNKS
    DELETE_CHUNKS --> UPDATE_VERSION_DEL
    UPDATE_VERSION_DEL --> VERSION_POLL
    
    %% Update
    CHECK_DELETED -->|No| READ_NEW
    READ_NEW --> RECHUNK
    RECHUNK --> REEMBED
    REEMBED --> ATOMIC_UPDATE
    ATOMIC_UPDATE --> UPDATE_VERSION_UPD
    UPDATE_VERSION_UPD --> VERSION_POLL
    
    %% Reconnection
    VERSION_POLL --> RECONNECT
    RECONNECT -->|Yes| RELOAD_INDEX
    RECONNECT -->|No| END
    RELOAD_INDEX --> NOTIFY
    NOTIFY --> END
    
    %% Styling
    classDef detectClass fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef analysisClass fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef deleteClass fill:#ffebee,stroke:#c62828,stroke-width:2px
    classDef updateClass fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef reconnectClass fill:#fff3e0,stroke:#e65100,stroke-width:2px
    
    class GIT_DETECT,CHECK_COMMIT,FILE_WATCH,DETECT_CHANGE detectClass
    class GET_CHANGED,FILTER_IGNORED,CHECK_DELETED analysisClass
    class DELETE_CHUNKS,UPDATE_VERSION_DEL deleteClass
    class READ_NEW,RECHUNK,REEMBED,ATOMIC_UPDATE,UPDATE_VERSION_UPD updateClass
    class VERSION_POLL,RECONNECT,RELOAD_INDEX,NOTIFY reconnectClass
```

## Data Transformations

### File → Chunks

```
Source File (example.ts, 200 lines)
    ↓ [Chunker with size=75, overlap=10]
Chunks:
    - Chunk 1: lines 1-75
    - Chunk 2: lines 66-140 (overlaps with Chunk 1)
    - Chunk 3: lines 131-200 (overlaps with Chunk 2)
```

**Why Overlap?**
- Prevents context loss at chunk boundaries
- Ensures functions/classes spanning boundaries are captured
- Default overlap: 10 lines

### Code → Embeddings

```
Code Chunk:
"export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}"
    ↓ [Tokenization]
Tokens: ["export", "function", "calculate", "total", "(", "items", ...]
    ↓ [all-MiniLM-L6-v2 Model]
Embedding: Float32Array[384]
[0.023, -0.145, 0.891, ..., -0.234]
    ↓ [Normalization]
Normalized Vector (magnitude = 1.0)
```

### Query → Results

```
Natural Language Query:
"How do we calculate totals?"
    ↓ [Same Embedding Process]
Query Vector: Float32Array[384]
    ↓ [Cosine Similarity Search]
Similarity Scores:
    - Chunk A: 0.92 (calculateTotal function)
    - Chunk B: 0.85 (sumItems helper)
    - Chunk C: 0.78 (priceCalculator)
    ↓ [Rank & Limit]
Top 3 Results with Metadata
```

## Performance Optimizations

### Batch Processing

Instead of processing one at a time:
```
Sequential: File1 → Embed → Store → File2 → Embed → Store
   ❌ Slow (N × T time)

Batched: [File1, File2, ..., FileN] → Embed Batch → Store Batch
   ✅ Fast (T time + overhead)
```

### Embedding Cache

```
Query 1: "authentication logic"
    → Generate embedding (200ms)
    → Store in cache
    → Return results

Query 2: "authentication logic" (same query)
    → Check cache (1ms)
    → Return cached embedding
    → Return results
    
Speedup: 200x faster for repeated queries
```

### Concurrent File Processing

```
Single-threaded: File1 → File2 → File3 → File4
   ⏱️  4 × 2s = 8s

Concurrent (4 workers): [File1, File2, File3, File4]
   ⏱️  max(2s, 2s, 2s, 2s) = 2s

Speedup: 4x faster (with concurrency=4)
```

## Data Storage

### LanceDB Schema

```
Vector Table:
┌──────────────┬─────────────┬────────────┬─────────────┐
│ vector       │ content     │ file       │ startLine   │
│ (384 dims)   │ (string)    │ (string)   │ (int)       │
├──────────────┼─────────────┼────────────┼─────────────┤
│ [0.1, ...]   │ "function..." │ "app.ts"   │ 10          │
│ [0.2, ...]   │ "class..."    │ "user.ts"  │ 45          │
└──────────────┴─────────────┴────────────┴─────────────┘

Additional Metadata:
- endLine (int)
- language (string)
- isTest (boolean)
- relatedTests (string[])
- relatedSources (string[])
- symbols (object)
```

### Version File

```json
{
  "version": 123456789,
  "timestamp": "2025-11-16T20:00:00.000Z",
  "config": {
    "chunkSize": 75,
    "chunkOverlap": 10
  }
}
```

Purpose: Enables MCP server to detect index changes and reconnect.

## Error Handling

### Graceful Degradation

```
File Processing Error:
    ├─ Binary file detected
    │  └─ Skip file, continue with others
    ├─ Parse error (malformed code)
    │  └─ Log warning, skip file
    ├─ Embedding generation failure
    │  └─ Retry once, then skip
    └─ Database write failure
       └─ Throw error (critical)
```

### Transaction Safety

Atomic updates ensure consistency:
```
Update File:
1. Start transaction
2. Delete old chunks for file
3. Insert new chunks for file
4. Commit transaction

If any step fails → Rollback → File remains in old state
```


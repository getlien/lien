# MCP Server Flow

This document details how the MCP (Model Context Protocol) server initializes, handles requests, and manages real-time updates.

## Server Initialization

```mermaid
sequenceDiagram
    actor User
    participant CLI as CLI (lien serve)
    participant Config as GlobalConfig + ConfigService
    participant Embeddings as Embedding Service
    participant VectorDB as Vector Database
    participant MCP as MCP Server
    participant Git as Git Tracker (optional)
    participant Watcher as File Watcher (optional)
    participant Stdio as Stdio Transport
    participant AI as AI Assistant (Cursor/etc)
    
    User->>CLI: lien serve
    CLI->>CLI: Show banner
    
    Note over CLI,Config: Phase 1: Configuration
    CLI->>Config: loadGlobalConfig() + ConfigService.load(rootDir)
    Config-->>CLI: GlobalConfig + LienConfig
    
    Note over CLI,Embeddings: Phase 2: Initialize Services
    CLI->>Embeddings: initialize()
    Note right of Embeddings: WorkerEmbeddings runs in worker thread<br/>Downloads model if first run (~50MB, cached)
    Embeddings->>Embeddings: Load all-MiniLM-L6-v2
    Embeddings-->>CLI: Ready (takes 3-5s)
    
    CLI->>VectorDB: initialize()
    VectorDB->>VectorDB: Connect to LanceDB
    VectorDB->>VectorDB: Load index
    VectorDB-->>CLI: Ready (takes 1-2s)
    
    Note over CLI,MCP: Phase 3: Create MCP Server
    CLI->>MCP: new Server({name, version, capabilities})
    MCP->>MCP: Register tool list handler
    MCP->>MCP: Register tool call handler
    MCP-->>CLI: Server instance
    
    Note over CLI,VectorDB: Phase 4: Auto-Index Check
    CLI->>VectorDB: hasData()
    VectorDB-->>CLI: false (no index)
    
    alt autoIndexOnFirstRun = true
        CLI->>CLI: Log: "No index found, running initial indexing..."
        CLI->>CLI: Import indexCodebase()
        CLI->>CLI: await indexCodebase({rootDir, verbose: true})
        Note right of CLI: This may take 5-20 minutes<br/>depending on project size
        CLI->>CLI: Log: "✅ Initial indexing complete!"
    else autoIndexOnFirstRun = false
        CLI->>CLI: Log: "⚠️ No index found. Run 'lien index'"
    end
    
    Note over CLI,Git: Phase 5: Optional Features
    
    alt gitDetection.enabled = true
        CLI->>Git: Check if git available
        Git-->>CLI: Yes
        CLI->>Git: Initialize GitStateTracker
        Git->>Git: Read current commit hash
        Git->>Git: Start polling (every 5s)
        Git-->>CLI: Tracking enabled
    end
    
    alt fileWatching.enabled = true
        CLI->>Watcher: Initialize FileWatcher
        Watcher->>Watcher: Watch codebase directories
        Watcher->>Watcher: Apply debounce (1s)
        Watcher-->>CLI: Watching enabled
    end
    
    Note over MCP,Stdio: Phase 6: Start Transport
    MCP->>Stdio: Connect stdio transport
    Stdio->>Stdio: Bind stdin/stdout
    Stdio-->>MCP: Connected
    
    MCP->>MCP: Start version check interval (every 2s)
    MCP->>CLI: Log: "MCP server running on stdio"
    CLI-->>User: Server ready, waiting for requests...
    
    Note over Stdio,AI: Phase 7: AI Assistant Connection
    AI->>Stdio: Connect to MCP server
    Stdio-->>AI: Connection established
    AI->>MCP: List available tools
    MCP-->>AI: [semantic_search, find_similar, get_files_context, list_functions, get_dependents, get_complexity]
```

### Available MCP Tools

The server exposes six tools to AI assistants:

| Tool | Description |
|------|-------------|
| `semantic_search` | Natural language code search by meaning |
| `find_similar` | Find structurally similar code patterns |
| `get_files_context` | Get file context with dependencies and test associations (supports batch) |
| `list_functions` | Fast symbol lookup by naming pattern |
| `get_dependents` | Reverse dependency lookup for impact analysis |
| `get_complexity` | Complexity analysis (cyclomatic, cognitive, Halstead) for files or codebase |

## Tool Request Handling

### semantic_search Tool

```mermaid
sequenceDiagram
    participant AI as AI Assistant
    participant MCP as MCP Server
    participant Cache as Embedding Cache
    participant Embeddings as Embedding Service
    participant VectorDB as Vector Database
    participant Version as Version Tracker
    
    AI->>MCP: Tool Call: semantic_search
    Note right of AI: {<br/>  query: "authentication logic",<br/>  limit: 5<br/>}
    
    rect rgb(225, 245, 255)
        Note over MCP: Request Validation
        MCP->>MCP: Validate query parameter (required)
        MCP->>MCP: Validate limit (default: 5)
    end
    
    rect rgb(255, 243, 224)
        Note over MCP,Embeddings: Embedding Generation
        MCP->>Cache: get(query)
        
        alt Cache hit
            Cache-->>MCP: Cached vector
            Note right of Cache: ~1ms
        else Cache miss
            MCP->>Embeddings: embed(query)
            Embeddings->>Embeddings: Tokenize
            Embeddings->>Embeddings: Generate embedding
            Embeddings-->>MCP: Float32Array[384]
            MCP->>Cache: set(query, vector)
            Note right of Embeddings: ~200ms
        end
    end
    
    rect rgb(232, 245, 233)
        Note over MCP,VectorDB: Vector Search
        MCP->>VectorDB: search(vector, limit)
        VectorDB->>VectorDB: Calculate cosine similarity
        VectorDB->>VectorDB: Rank results
        VectorDB->>VectorDB: Apply limit
        VectorDB-->>MCP: SearchResult[]
        Note right of VectorDB: ~50-100ms
    end
    
    rect rgb(243, 229, 245)
        Note over MCP: Response Formatting
        MCP->>MCP: Get index metadata
        MCP->>MCP: Format results with metadata
        MCP->>MCP: Build JSON response
    end
    
    MCP-->>AI: MCP Response
    Note right of MCP: {<br/>  indexInfo: {...},<br/>  results: [...]<br/>}
    
    AI->>AI: Process results
    AI->>AI: Present to user
```

### get_files_context Tool

```mermaid
sequenceDiagram
    participant AI as AI Assistant
    participant MCP as MCP Server
    participant VectorDB as Vector Database
    participant Embeddings as Embedding Service
    
    AI->>MCP: Tool Call: get_files_context
    Note right of AI: {<br/>  filepath: "src/auth.ts",<br/>  includeRelated: true<br/>}
    
    Note over MCP: Validate Parameters
    MCP->>MCP: Check filepath is provided
    MCP->>MCP: Set includeRelated (default: true)
    
    Note over MCP,VectorDB: Fetch File Chunks
    MCP->>VectorDB: getChunksByFile(filepath)
    VectorDB->>VectorDB: SELECT * WHERE file = ?
    VectorDB-->>MCP: chunks[]
    
    alt chunks.length = 0
        MCP->>MCP: Build "file not indexed" response
        MCP-->>AI: Not found response
    else includeRelated = true
        Note over MCP,Embeddings: Find Related Chunks
        MCP->>MCP: Get first chunk content
        MCP->>Embeddings: embed(firstChunk)
        Embeddings-->>MCP: queryVector
        
        MCP->>VectorDB: search(queryVector, limit: 10)
        Note right of VectorDB: Exclude chunks from same file
        VectorDB-->>MCP: relatedChunks[]
        
        MCP->>MCP: Combine file chunks + related chunks
        MCP->>MCP: Add test associations from metadata
        MCP->>MCP: Format response
        MCP-->>AI: Complete context response
    else includeRelated = false
        MCP->>MCP: Format chunks only
        MCP->>MCP: Add test associations
        MCP-->>AI: File-only response
    end
```

## Background Update Monitoring

The MCP server monitors for index changes and automatically reconnects.

```mermaid
flowchart TB
    START([MCP Server Running])
    
    subgraph "Version Check Loop (Every 2s)"
        INTERVAL[setInterval: 2000ms]
        READ_VERSION[Read version.json]
        COMPARE{Version<br/>Changed?}
        CURRENT[Store current version]
    end
    
    subgraph "Git Detection (If Enabled)"
        GIT_POLL[Poll Git Status: 5s]
        CHECK_COMMIT[Get current commit hash]
        COMMIT_CHANGED{Commit<br/>Changed?}
        GET_CHANGED_FILES[git diff --name-only]
        FILTER_FILES[Filter by include patterns]
    end
    
    subgraph "File Watcher (If Enabled)"
        WATCH_FILES[chokidar.watch()]
        FILE_EVENT[File change event]
        DEBOUNCE[Debounce: 1000ms]
        GET_FILEPATH[Get changed file path]
    end
    
    subgraph "Incremental Reindex"
        REINDEX_START[Start background reindex]
        LOAD_CONFIG[Load config]
        INDEX_FILES[indexMultipleFiles()]
        UPDATE_VERSION[Update version.json]
        REINDEX_DONE[Log: Reindex complete]
    end
    
    subgraph "Vector DB Reconnection"
        RECONNECT_START[Trigger reconnection]
        CLOSE_CONN[Close old connection]
        REOPEN_CONN[Open new connection]
        RELOAD_INDEX[Reload vector index]
        RECONNECT_DONE[Log: Reconnected]
        NOTIFY_CLIENT[Next query uses new index]
    end
    
    START --> INTERVAL
    START --> GIT_POLL
    START --> WATCH_FILES
    
    %% Version check flow
    INTERVAL --> READ_VERSION
    READ_VERSION --> COMPARE
    COMPARE -->|No| CURRENT
    COMPARE -->|Yes| RECONNECT_START
    CURRENT --> INTERVAL
    
    %% Git detection flow
    GIT_POLL --> CHECK_COMMIT
    CHECK_COMMIT --> COMMIT_CHANGED
    COMMIT_CHANGED -->|No| GIT_POLL
    COMMIT_CHANGED -->|Yes| GET_CHANGED_FILES
    GET_CHANGED_FILES --> FILTER_FILES
    FILTER_FILES --> REINDEX_START
    
    %% File watcher flow
    WATCH_FILES --> FILE_EVENT
    FILE_EVENT --> DEBOUNCE
    DEBOUNCE --> GET_FILEPATH
    GET_FILEPATH --> REINDEX_START
    
    %% Reindex flow
    REINDEX_START --> LOAD_CONFIG
    LOAD_CONFIG --> INDEX_FILES
    INDEX_FILES --> UPDATE_VERSION
    UPDATE_VERSION --> REINDEX_DONE
    REINDEX_DONE --> INTERVAL
    
    %% Reconnect flow
    RECONNECT_START --> CLOSE_CONN
    CLOSE_CONN --> REOPEN_CONN
    REOPEN_CONN --> RELOAD_INDEX
    RELOAD_INDEX --> RECONNECT_DONE
    RECONNECT_DONE --> NOTIFY_CLIENT
    NOTIFY_CLIENT --> INTERVAL
    
    %% Styling
    classDef versionClass fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef gitClass fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef watchClass fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef reindexClass fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef reconnectClass fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    
    class INTERVAL,READ_VERSION,COMPARE,CURRENT versionClass
    class GIT_POLL,CHECK_COMMIT,COMMIT_CHANGED,GET_CHANGED_FILES,FILTER_FILES gitClass
    class WATCH_FILES,FILE_EVENT,DEBOUNCE,GET_FILEPATH watchClass
    class REINDEX_START,LOAD_CONFIG,INDEX_FILES,UPDATE_VERSION,REINDEX_DONE reindexClass
    class RECONNECT_START,CLOSE_CONN,REOPEN_CONN,RELOAD_INDEX,RECONNECT_DONE,NOTIFY_CLIENT reconnectClass
```

## Error Handling in MCP Server

```mermaid
flowchart TD
    REQUEST[Receive MCP Tool Call]
    TRY[Try Block]
    VALIDATE{Validate<br/>Parameters}
    EXECUTE[Execute Tool Logic]
    SUCCESS{Success?}
    RETURN_SUCCESS[Return Success Response]
    
    CATCH[Catch Block]
    LOG_ERROR[Log Error to stderr]
    BUILD_ERROR[Build Error Response]
    RETURN_ERROR[Return Error Response]
    
    REQUEST --> TRY
    TRY --> VALIDATE
    
    VALIDATE -->|Invalid| THROW1[Throw Error:<br/>Invalid parameters]
    VALIDATE -->|Valid| EXECUTE
    
    EXECUTE --> SUCCESS
    SUCCESS -->|Yes| RETURN_SUCCESS
    SUCCESS -->|No| THROW2[Throw Error]
    
    THROW1 --> CATCH
    THROW2 --> CATCH
    EXECUTE -.->|Exception| CATCH
    
    CATCH --> LOG_ERROR
    LOG_ERROR --> BUILD_ERROR
    BUILD_ERROR --> RETURN_ERROR
    
    RETURN_SUCCESS --> END([Response Sent])
    RETURN_ERROR --> END
    
    style RETURN_SUCCESS fill:#c8e6c9
    style RETURN_ERROR fill:#ffcdd2
    style CATCH fill:#fff9c4
```

### Error Response Format

```json
{
  "content": [{
    "type": "text",
    "text": "{\"error\":\"Vector database not initialized\",\"tool\":\"semantic_search\"}"
  }],
  "isError": true
}
```

## MCP Protocol Messages

### Tool List Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "semantic_search",
        "description": "Search the codebase semantically...",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": {"type": "string", "description": "..."},
            "limit": {"type": "number", "default": 5}
          },
          "required": ["query"]
        }
      }
      // ... other tools
    ]
  }
}
```

### Tool Call Request

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "semantic_search",
    "arguments": {
      "query": "how do we handle authentication",
      "limit": 5
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"indexInfo\":{...},\"results\":[...]}"
    }]
  }
}
```

## Performance Optimizations

### 1. Embedding Cache

```
First query: "authentication logic"
  → Generate embedding: 200ms
  → Search: 50ms
  → Total: 250ms

Same query again:
  → Get from cache: 1ms
  → Search: 50ms
  → Total: 51ms

Improvement: 5x faster
```

### 2. Lazy Initialization

```
Server Start:
  ✓ Load config: 0.5s
  ✓ Load embedding model: 3-5s
  ✓ Connect vector DB: 1-2s
  Total: 5-7s

Without lazy init (if we initialized on every query):
  ✗ Would take 5-7s per query
```

### 3. Background Reindexing

```
File changed → Trigger background reindex
  ↓
MCP server continues handling queries
  ↓
Reindex completes → Version incremented
  ↓
Next query uses updated index

User Experience: No downtime, seamless updates
```

## Logging & Debugging

### Normal Operation

```
[Lien MCP] Initializing MCP server...
[Lien MCP] Loading embedding model...
[Lien MCP] Loading vector database...
[Lien MCP] Embeddings and vector DB ready
[Lien MCP] MCP server running on stdio
```

## Shutdown & Cleanup

```mermaid
sequenceDiagram
    actor User
    participant Process as Node Process
    participant MCP as MCP Server
    participant Intervals as Timers/Intervals
    participant VectorDB as Vector Database
    participant Git as Git Tracker
    participant Watcher as File Watcher
    
    User->>Process: SIGINT (Ctrl+C)
    Process->>Process: Trigger SIGINT handler
    
    Process->>Intervals: clearInterval(versionCheckInterval)
    Intervals-->>Process: Cleared
    
    Process->>Git: stop() [if enabled]
    Git->>Git: clearInterval(gitPoll)
    Git-->>Process: Stopped
    
    Process->>Watcher: close() [if enabled]
    Watcher->>Watcher: watcher.close()
    Watcher-->>Process: Closed
    
    Process->>VectorDB: close() [implicit]
    VectorDB->>VectorDB: Close connection
    VectorDB-->>Process: Closed
    
    Process->>MCP: shutdown() [implicit]
    MCP->>MCP: Close stdio transport
    MCP-->>Process: Shut down
    
    Process->>Process: process.exit(0)
    Process-->>User: Clean exit
```

## Integration with AI Assistants

### Cursor Integration

```json
// In Cursor settings (.cursor/mcp.json)
{
  "mcpServers": {
    "lien": {
      "command": "lien",
      "args": ["serve"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

### Usage Flow

```
1. User opens Cursor
2. Cursor reads MCP config
3. Cursor spawns: lien serve (in project root)
4. Lien MCP server initializes
5. Cursor connects via stdio
6. User asks: "Where is the authentication logic?"
7. Cursor calls: semantic_search("authentication logic")
8. Lien returns: Relevant code chunks
9. Cursor uses results to answer user
```

### Multi-Project Support

Each workspace gets its own MCP server instance:

```
Workspace A: lien serve (PID 1234) → Uses ~/.lien/workspace-a/
Workspace B: lien serve (PID 5678) → Uses ~/.lien/workspace-b/
Workspace C: lien serve (PID 9012) → Uses ~/.lien/workspace-c/

Each server is isolated and manages its own index
```


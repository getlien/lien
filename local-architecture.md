# Local Architecture: Lien - Codebase Intelligence MCP Server

## Overview

**Lien** is a local-first semantic code search tool that provides context to AI coding assistants (Cursor, etc.) via the Model Context Protocol (MCP). The tool indexes codebases locally, stores vectors in an embedded database, and exposes search capabilities through MCP tools.

**Brand:** Lien (French for "link/connection") - connecting AI to your codebase.

**Domain:** lien.dev

**Core Value Proposition:** Make Cursor/Claude understand YOUR codebase by providing semantic search and context retrieval - all running locally with zero external API calls in the free tier.

## Architecture Philosophy

### Free Tier (MVP Focus)
- 100% local execution (privacy-first)
- Zero external dependencies
- Zero cost per user
- Single repo support
- Local embeddings (transformers.js)
- Embedded vector DB (LanceDB)
- Standard MCP protocol

### Design Principles
1. **Local-first**: Everything runs on user's machine
2. **Privacy**: Code never leaves the machine
3. **Simple**: Easy to install and use (`npx` one-liner)
4. **Fast enough**: Queries < 500ms, indexing < 20min for medium repos
5. **Extensible**: Easy to add paid features later

## System Components

```
┌─────────────────────────────────────────────────┐
│           User's Machine (Everything Local)     │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  CLI Tool (Commander.js)                 │  │
│  │  - init, index, serve, status            │  │
│  │  - User's primary interface              │  │
│  └─────────────┬────────────────────────────┘  │
│                │                                │
│  ┌─────────────▼────────────────────────────┐  │
│  │  MCP Server (TypeScript)                 │  │
│  │  - Implements MCP protocol               │  │
│  │  - Exposes tools to Cursor               │  │
│  │  - Handles semantic search               │  │
│  └─────────────┬────────────────────────────┘  │
│                │                                │
│  ┌─────────────▼────────────────────────────┐  │
│  │  Indexing Engine                         │  │
│  │  - File watching (chokidar)              │  │
│  │  - Code parsing (tree-sitter optional)   │  │
│  │  - Chunking strategy                     │  │
│  │  - Embedding generation                  │  │
│  └─────────────┬────────────────────────────┘  │
│                │                                │
│  ┌─────────────▼────────────────────────────┐  │
│  │  Embedding Service (Local)               │  │
│  │  - transformers.js                       │  │
│  │  - Model: all-MiniLM-L6-v2               │  │
│  │  - Lazy loading (~100MB download)        │  │
│  └─────────────┬────────────────────────────┘  │
│                │                                │
│  ┌─────────────▼────────────────────────────┐  │
│  │  Vector Database (LanceDB)               │  │
│  │  - Embedded, no separate server          │  │
│  │  - Stores in ~/.codebase-ai/indices      │  │
│  │  - Fast queries (~50-200ms)              │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
└────────────────┬────────────────────────────────┘
                 │ MCP Protocol (stdio/socket)
                 ▼
        ┌─────────────────────┐
        │   Cursor IDE        │
        │   - User asks Q     │
        │   - Calls MCP tools │
        │   - Gets context    │
        │   - Sends to Claude │
        └─────────────────────┘
```

## Directory Structure

```
lien/
├── packages/
│   └── cli/                      # Main CLI package
│       ├── src/
│       │   ├── cli/              # CLI commands
│       │   │   ├── init.ts       # Initialize project
│       │   │   ├── index.ts      # Index codebase
│       │   │   ├── serve.ts      # Start MCP server
│       │   │   └── status.ts     # Show status
│       │   ├── mcp/              # MCP server implementation
│       │   │   ├── server.ts     # MCP server setup
│       │   │   └── tools.ts      # MCP tool definitions
│       │   ├── indexer/          # Indexing logic
│       │   │   ├── scanner.ts    # File scanning
│       │   │   ├── chunker.ts    # Code chunking
│       │   │   ├── parser.ts     # Code parsing (optional)
│       │   │   └── watcher.ts    # File watching
│       │   ├── embeddings/       # Embedding generation
│       │   │   ├── local.ts      # Local model (transformers.js)
│       │   │   └── types.ts      # Embedding types
│       │   ├── vectordb/         # Vector database
│       │   │   ├── lancedb.ts    # LanceDB implementation
│       │   │   └── types.ts      # DB types
│       │   ├── config/           # Configuration
│       │   │   └── schema.ts     # Config validation
│       │   └── index.ts          # Main entry point
│       ├── package.json
│       └── tsconfig.json
├── .github/
│   └── workflows/
│       └── release.yml           # Auto-publish to npm
└── README.md
```

## Core Components Detail

### 1. CLI Tool

**Purpose:** User's primary interface

**Commands:**
```bash
# Initialize in a project
lien init

# Index the codebase
lien index

# Start MCP server (for Cursor)
lien serve

# Check status
lien status

# Re-index (full rebuild)
lien reindex
```

**Implementation:**
```typescript
// src/cli/index.ts
import { Command } from 'commander';

const program = new Command();

program
  .name('lien')
  .description('Local semantic code search for AI assistants')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize in current directory')
  .action(initCommand);

program
  .command('index')
  .description('Index the codebase')
  .option('-w, --watch', 'Watch for changes')
  .action(indexCommand);

program
  .command('serve')
  .description('Start MCP server')
  .option('-p, --port <port>', 'Port number', '3000')
  .action(serveCommand);

program.parse();
```

### 2. MCP Server

**Purpose:** Expose search tools to Cursor via MCP protocol

**MCP Tools to Implement:**

```typescript
// src/mcp/tools.ts

export const tools = [
  {
    name: 'semantic_search',
    description: 'Search codebase semantically for relevant code',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "authentication logic")'
        },
        limit: {
          type: 'number',
          description: 'Number of results to return',
          default: 5
        }
      },
      required: ['query']
    }
  },
  {
    name: 'find_similar',
    description: 'Find code similar to a given snippet',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Code snippet to find similar implementations'
        },
        limit: {
          type: 'number',
          default: 5
        }
      },
      required: ['code']
    }
  },
  {
    name: 'get_file_context',
    description: 'Get related files and context for a specific file',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to file'
        }
      },
      required: ['filepath']
    }
  },
  {
    name: 'list_functions',
    description: 'List all functions/classes in the codebase',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Optional pattern to filter'
        }
      }
    }
  }
];
```

**Server Implementation:**
```typescript
// src/mcp/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tools } from './tools.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { LocalEmbeddings } from '../embeddings/local.js';

export async function startMCPServer() {
  const server = new Server(
    {
      name: 'lien',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const vectorDB = await VectorDB.load();
  const embeddings = new LocalEmbeddings();

  // Register tool handlers
  server.setRequestHandler('tools/list', async () => ({
    tools
  }));

  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'semantic_search': {
        const embedding = await embeddings.embed(args.query);
        const results = await vectorDB.search(embedding, args.limit || 5);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2)
            }
          ]
        };
      }

      case 'find_similar': {
        const embedding = await embeddings.embed(args.code);
        const results = await vectorDB.search(embedding, args.limit || 5);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2)
            }
          ]
        };
      }

      // ... other tool handlers
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

### 3. Indexing Engine

**Purpose:** Scan code, chunk it, generate embeddings, store in vector DB

**Chunking Strategy (MVP - Simple):**
```typescript
// src/indexer/chunker.ts

export interface CodeChunk {
  content: string;
  metadata: {
    file: string;
    startLine: number;
    endLine: number;
    type: 'function' | 'class' | 'block';
    language: string;
  };
}

// Simple line-based chunking (MVP)
// Later: Use tree-sitter for AST-based chunking
export function chunkFile(filepath: string, content: string): CodeChunk[] {
  const lines = content.split('\n');
  const chunks: CodeChunk[] = [];
  
  // Chunk by ~50-100 lines (overlap 10 lines)
  const chunkSize = 75;
  const overlap = 10;
  
  for (let i = 0; i < lines.length; i += chunkSize - overlap) {
    const chunkLines = lines.slice(i, i + chunkSize);
    const chunkContent = chunkLines.join('\n');
    
    chunks.push({
      content: chunkContent,
      metadata: {
        file: filepath,
        startLine: i + 1,
        endLine: Math.min(i + chunkSize, lines.length),
        type: 'block',
        language: detectLanguage(filepath)
      }
    });
  }
  
  return chunks;
}
```

**File Scanning:**
```typescript
// src/indexer/scanner.ts
import { glob } from 'glob';
import ignore from 'ignore';
import fs from 'fs/promises';

export interface ScanOptions {
  rootDir: string;
  excludePatterns?: string[];
}

export async function scanCodebase(options: ScanOptions): Promise<string[]> {
  const { rootDir, excludePatterns = [] } = options;
  
  // Load .gitignore
  const gitignorePath = `${rootDir}/.gitignore`;
  let ig = ignore();
  
  try {
    const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
    ig = ignore().add(gitignoreContent);
  } catch (e) {
    // No .gitignore, that's fine
  }
  
  // Add default exclusions
  ig.add([
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    '*.min.js',
    ...excludePatterns
  ]);
  
  // Find all code files
  const allFiles = await glob('**/*.{ts,tsx,js,jsx,py,go,rs,java,cpp,c,h}', {
    cwd: rootDir,
    absolute: true,
    nodir: true
  });
  
  // Filter using ignore patterns
  return allFiles.filter(file => {
    const relativePath = file.replace(rootDir + '/', '');
    return !ig.ignores(relativePath);
  });
}
```

**Indexing Orchestration:**
```typescript
// src/indexer/index.ts
import { scanCodebase } from './scanner.js';
import { chunkFile } from './chunker.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { VectorDB } from '../vectordb/lancedb.js';
import fs from 'fs/promises';
import ora from 'ora';

export async function indexCodebase(rootDir: string) {
  const spinner = ora('Scanning codebase...').start();
  
  // 1. Scan for files
  const files = await scanCodebase({ rootDir });
  spinner.text = `Found ${files.length} files`;
  
  // 2. Initialize embeddings and vector DB
  spinner.text = 'Loading embedding model...';
  const embeddings = new LocalEmbeddings();
  await embeddings.initialize();
  
  spinner.text = 'Initializing vector database...';
  const vectorDB = new VectorDB(rootDir);
  await vectorDB.initialize();
  
  // 3. Process files
  let processedChunks = 0;
  const totalChunks = files.length * 10; // Rough estimate
  
  for (const file of files) {
    spinner.text = `Indexing ${file} (${processedChunks}/${totalChunks} chunks)`;
    
    try {
      const content = await fs.readFile(file, 'utf-8');
      const chunks = chunkFile(file, content);
      
      // Generate embeddings in batches
      const batchSize = 10;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const texts = batch.map(c => c.content);
        const embeddingVectors = await embeddings.embedBatch(texts);
        
        // Store in vector DB
        await vectorDB.insertBatch(
          embeddingVectors,
          batch.map(c => c.metadata)
        );
        
        processedChunks += batch.length;
        spinner.text = `Indexed ${processedChunks} chunks...`;
      }
    } catch (error) {
      console.warn(`Skipping ${file}: ${error.message}`);
    }
  }
  
  spinner.succeed(`Indexed ${processedChunks} chunks from ${files.length} files`);
}
```

### 4. Embedding Service (Local)

**Purpose:** Generate embeddings using local model

```typescript
// src/embeddings/local.ts
import { pipeline, env } from '@xenova/transformers';

// Disable remote models (use cached only after first download)
env.allowRemoteModels = true;
env.allowLocalModels = true;

export class LocalEmbeddings {
  private extractor: any;
  private modelName = 'Xenova/all-MiniLM-L6-v2';
  
  async initialize() {
    if (!this.extractor) {
      // This downloads ~100MB on first run, then caches
      this.extractor = await pipeline(
        'feature-extraction',
        this.modelName
      );
    }
  }
  
  async embed(text: string): Promise<Float32Array> {
    await this.initialize();
    
    const output = await this.extractor(text, {
      pooling: 'mean',
      normalize: true
    });
    
    return output.data;
  }
  
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.initialize();
    
    // Process in parallel batches for speed
    const results = await Promise.all(
      texts.map(text => this.embed(text))
    );
    
    return results;
  }
}
```

### 5. Vector Database (LanceDB)

**Purpose:** Store and search embeddings

```typescript
// src/vectordb/lancedb.ts
import * as lancedb from 'vectordb';
import path from 'path';
import os from 'os';

export interface SearchResult {
  content: string;
  metadata: any;
  score: number;
}

export class VectorDB {
  private db: any;
  private table: any;
  private dbPath: string;
  
  constructor(projectRoot: string) {
    // Store in user's home directory
    const projectName = path.basename(projectRoot);
    this.dbPath = path.join(
      os.homedir(),
      '.lien',
      'indices',
      projectName
    );
  }
  
  async initialize() {
    this.db = await lancedb.connect(this.dbPath);
    
    try {
      this.table = await this.db.openTable('code_chunks');
    } catch {
      // Table doesn't exist, create it
      await this.db.createTable('code_chunks', [
        {
          vector: Array(384).fill(0), // all-MiniLM-L6-v2 = 384 dims
          content: '',
          file: '',
          startLine: 0,
          endLine: 0,
          type: '',
          language: ''
        }
      ]);
      this.table = await this.db.openTable('code_chunks');
    }
  }
  
  async insertBatch(vectors: Float32Array[], metadatas: any[]) {
    const records = vectors.map((vector, i) => ({
      vector: Array.from(vector),
      content: metadatas[i].content || '',
      file: metadatas[i].file,
      startLine: metadatas[i].startLine,
      endLine: metadatas[i].endLine,
      type: metadatas[i].type,
      language: metadatas[i].language
    }));
    
    await this.table.add(records);
  }
  
  async search(
    queryVector: Float32Array,
    limit: number = 5
  ): Promise<SearchResult[]> {
    const results = await this.table
      .search(Array.from(queryVector))
      .limit(limit)
      .execute();
    
    return results.map((r: any) => ({
      content: r.content,
      metadata: {
        file: r.file,
        startLine: r.startLine,
        endLine: r.endLine,
        type: r.type,
        language: r.language
      },
      score: r._distance
    }));
  }
  
  async clear() {
    await this.db.dropTable('code_chunks');
    await this.initialize();
  }
  
  static async load(projectRoot: string): Promise<VectorDB> {
    const db = new VectorDB(projectRoot);
    await db.initialize();
    return db;
  }
}
```

## Configuration

```typescript
// .lien.config.json (in project root)
{
  "version": "0.1.0",
  "indexing": {
    "exclude": [
      "node_modules/**",
      "**/*.test.ts",
      "**/*.spec.ts",
      "dist/**",
      "build/**"
    ],
    "include": [
      "src/**/*.{ts,tsx,js,jsx}",
      "lib/**/*.ts"
    ],
    "chunkSize": 75,
    "chunkOverlap": 10
  },
  "mcp": {
    "port": 3000,
    "transport": "stdio"
  }
}
```

## Key Dependencies

```json
{
  "name": "@liendev/lien",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "lien": "./dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0",
    "@xenova/transformers": "^2.17.0",
    "vectordb": "^0.4.0",
    "commander": "^12.0.0",
    "chokidar": "^3.6.0",
    "glob": "^10.3.0",
    "ignore": "^5.3.0",
    "ora": "^8.0.0",
    "chalk": "^5.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0",
    "tsup": "^8.0.0"
  }
}
```

## Build & Distribution

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true
});
```

```json
// package.json scripts
{
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "prepublishOnly": "npm run build"
  }
}
```

## User Installation & Usage

```bash
# Install globally
npm install -g @liendev/lien

# Or use directly with npx
npx @liendev/lien init

# In a project
cd /path/to/your/project
lien init
lien index  # Takes ~15-20 min for medium project
lien serve  # Start MCP server

# Configure Cursor to use the MCP server
# Add to Cursor's MCP settings:
{
  "mcpServers": {
    "lien": {
      "command": "lien",
      "args": ["serve"]
    }
  }
}
```

## Performance Targets (MVP)

### Indexing
- Small repo (1k files): < 5 minutes
- Medium repo (10k files): < 20 minutes
- Large repo (50k files): 30-60 minutes (acceptable for one-time)

### Queries (MCP calls)
- Simple search: < 200ms
- Semantic search: < 500ms
- Complex queries: < 1s

### Resource Usage
- RAM: ~200-500MB during indexing
- RAM: ~100-200MB during queries
- Disk: ~500MB per 100k chunks
- Model download: ~100MB (one-time)

## Validation Metrics

### Week 1-2 (MVP Complete)
- ✅ Can index a real codebase
- ✅ Can query via CLI
- ✅ Results are relevant
- ✅ Performance is acceptable

### Week 3-4 (MCP Integration)
- ✅ Works with Cursor
- ✅ MCP tools callable from Cursor
- ✅ Context improves AI responses
- ✅ Dogfood on own projects

### Month 1 (Public Launch)
- 🎯 100 GitHub stars
- 🎯 50 active users
- 🎯 10+ positive testimonials
- 🎯 Clear use cases identified

### Month 2 (Validation)
- 🎯 500 GitHub stars
- 🎯 200+ active users
- 🎯 Feedback on what to build next
- 🎯 5+ users say "I'd pay for X"

## What's NOT in MVP

**Explicitly out of scope for first version:**
- ❌ Paid features / billing
- ❌ Cloud sync
- ❌ Web dashboard
- ❌ Team features
- ❌ Multi-repo support
- ❌ GitHub integration
- ❌ API-based embeddings
- ❌ Advanced parsing (tree-sitter)
- ❌ Incremental updates (just re-index)

**Focus:** Prove the core value prop works.

## Success Criteria

**The MVP is successful if:**
1. Users can install with one command
2. Indexing completes in reasonable time
3. Search results are relevant
4. Cursor integration works smoothly
5. Users report AI responses are better with context
6. People star the repo and share it

**Next steps after validation:**
1. Add incremental indexing
2. Improve chunking strategy
3. Add paid tier (faster embeddings)
4. Build web dashboard
5. Add GitHub PR review

## Development Priorities

### Phase 1: Core Functionality (Week 1)
1. Project setup & dependencies
2. Basic CLI (init, index, status)
3. File scanning with gitignore support
4. Simple chunking (line-based)
5. Local embeddings integration
6. LanceDB integration
7. Basic search CLI command

### Phase 2: MCP Integration (Week 2)
1. MCP server implementation
2. semantic_search tool
3. find_similar tool
4. get_file_context tool
5. Test with Cursor
6. Documentation for Cursor setup

### Phase 3: Polish & Launch (Week 3-4)
1. Better error handling
2. Progress indicators (ora)
3. Configuration file support
4. README with examples
5. Demo video
6. Launch on Product Hunt / HN

## Technical Decisions & Rationale

### Why TypeScript?
- MCP SDK is TypeScript-native
- Better for CLI tools than PHP
- npm ecosystem for dev tools
- Type safety for complex data structures

### Why LanceDB?
- Embedded (no separate server)
- Fast enough for local use
- Rust-based (good performance)
- Active development

### Why transformers.js?
- Runs in Node.js (no Python)
- Good enough embeddings
- Caches models locally
- Easy to use

### Why local-first?
- Privacy (code never leaves machine)
- Zero costs for free tier
- Works offline
- Builds trust with developers

### Why simple chunking?
- Fast to implement
- Good enough for MVP
- Can improve later with tree-sitter
- Validates concept quickly

## Next Steps After This Document

1. **Set up project structure**
   ```bash
   mkdir lien
   cd lien
   npm init -y
   # Install dependencies from package.json above
   ```

2. **Start with CLI skeleton**
   - Build basic commander.js CLI
   - Test `init` and `status` commands

3. **Add file scanning**
   - Implement scanner.ts
   - Test on real project

4. **Add embedding generation**
   - Implement local.ts
   - Test on sample text

5. **Add vector DB**
   - Implement lancedb.ts
   - Test insert and search

6. **Wire it all together**
   - Implement indexing orchestration
   - Test full pipeline

7. **Add MCP server**
   - Implement MCP protocol
   - Test with Cursor

8. **Polish and document**
   - README, examples, video

## Questions for Implementation

- Should we use tree-sitter for better chunking immediately, or start simple?
  - **Decision:** Start simple (line-based), add tree-sitter in v0.2
  
- Should MCP server use stdio or socket?
  - **Decision:** stdio (simpler, standard for MCP)
  
- Should we support multiple embedding models in MVP?
  - **Decision:** No, just all-MiniLM-L6-v2

- Should we add a progress bar during indexing?
  - **Decision:** Yes, using ora

- Should we validate .codebase-ai.config.json schema?
  - **Decision:** Yes, using zod (add later if time)

## Resources

- [MCP Documentation](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [LanceDB Docs](https://lancedb.github.io/lancedb/)
- [Transformers.js](https://huggingface.co/docs/transformers.js)
- [Commander.js](https://github.com/tj/commander.js)

---

**Ready to build?** Start with the CLI skeleton and file scanner, then add embeddings and vector DB. Test each component independently before wiring together. Focus on getting the core loop working: scan → chunk → embed → store → search.

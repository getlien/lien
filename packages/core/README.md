# @liendev/core

Core indexing and analysis engine for Lien. This package provides the low-level APIs for semantic code search, complexity analysis, and framework detection.

## Installation

```bash
npm install @liendev/core
```

## Usage

```typescript
import {
  indexCodebase,
  VectorDB,
  ComplexityAnalyzer,
} from '@liendev/core';

// Index a codebase
await indexCodebase({
  rootDir: '/path/to/project',
});

// Load the vector database
const db = await VectorDB.load('/path/to/project');

// Run semantic search
const results = await db.search('authentication logic', { limit: 10 });

// Analyze complexity
const analyzer = new ComplexityAnalyzer(db);
const report = await analyzer.analyze();

console.log(`Found ${report.summary.totalViolations} complexity violations`);
```

## API Reference

### Indexing

#### `indexCodebase(options: IndexingOptions): Promise<IndexingResult>`

Index a codebase for semantic search.

```typescript
interface IndexingOptions {
  rootDir?: string;           // Root directory (default: cwd)
  force?: boolean;            // Force full reindex (default: false)
  verbose?: boolean;          // Verbose output (default: false)
  embeddings?: EmbeddingService;  // Pre-initialized embeddings
  config?: LienConfig;        // Pre-loaded config
  onProgress?: (progress: IndexingProgress) => void;  // Progress callback
}

interface IndexingResult {
  filesIndexed: number;
  chunksCreated: number;
  timeMs: number;
}
```

**Example:**
```typescript
const result = await indexCodebase({
  rootDir: './my-project',
  force: true,
  onProgress: (progress) => {
    console.log(`Indexed ${progress.filesCompleted}/${progress.totalFiles} files`);
  },
});

console.log(`Indexed ${result.filesIndexed} files in ${result.timeMs}ms`);
```

### Vector Database

#### `VectorDB.load(rootDir: string): Promise<VectorDB>`

Load an existing vector database.

```typescript
const db = await VectorDB.load('./my-project');
```

#### `db.search(query: string, options?: SearchOptions): Promise<SearchResult[]>`

Perform semantic search.

```typescript
interface SearchOptions {
  limit?: number;              // Max results (default: 5)
  minScore?: number;          // Min similarity score (default: 0.5)
  fileFilter?: string[];      // Filter by file paths
}

const results = await db.search('error handling', {
  limit: 10,
  minScore: 0.7,
  fileFilter: ['src/utils/**'],
});
```

### Complexity Analysis

#### `new ComplexityAnalyzer(db: VectorDB, config: LienConfig)`

Create a complexity analyzer.

```typescript
const config = await loadConfig('./my-project');
const analyzer = new ComplexityAnalyzer(db, config);
```

#### `analyzer.analyze(files?: string[]): Promise<ComplexityReport>`

Analyze code complexity. Optionally filter to specific files.

```typescript
// Analyze all files
const report = await analyzer.analyze();

// Analyze specific files
const report = await analyzer.analyze(['src/utils.ts', 'src/parser.ts']);

console.log(`${report.summary.totalViolations} violations found`);
console.log(`Average complexity: ${report.summary.avgComplexity}`);
```

#### Complexity Report Structure

```typescript
interface ComplexityReport {
  summary: {
    filesAnalyzed: number;
    totalViolations: number;
    bySeverity: { error: number; warning: number };
    avgComplexity: number;
    maxComplexity: number;
  };
  files: Record<string, FileComplexityData>;
}

interface FileComplexityData {
  violations: ComplexityViolation[];
  dependents: string[];        // Files that import this file
  testAssociations: string[];  // Test files covering this file
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface ComplexityViolation {
  filepath: string;
  startLine: number;
  endLine: number;
  symbolName: string;
  symbolType: 'function' | 'method' | 'class' | 'file';
  language: string;
  complexity: number;
  threshold: number;
  severity: 'warning' | 'error';
  metricType: 'cyclomatic' | 'cognitive' | 'halstead_effort' | 'halstead_bugs';
  halsteadDetails?: HalsteadDetails;
}
```

### Configuration

Lien no longer requires per-project configuration files. It uses:
- Global config at `~/.lien/config.json` (optional, for backend selection)
- Environment variables (`LIEN_BACKEND`, `LIEN_QDRANT_URL`, etc.)
- Auto-detected frameworks
- Sensible defaults for all settings

For more details, see the [Configuration Guide](https://lien.dev/docs/guide/configuration).
    },
  },
});
```

#### `createDefaultConfig(): LienConfig`

Create a default configuration.

```typescript
const config = createDefaultConfig();
```

### Framework Detection

#### `detectAllFrameworks(rootDir: string): Promise<FrameworkInstance[]>`

Detect frameworks in a project.

```typescript
import { detectAllFrameworks } from '@liendev/core';

const frameworks = await detectAllFrameworks('./my-project');

for (const fw of frameworks) {
  console.log(`Found ${fw.name} at ${fw.path}`);
}
```

### Git Utilities

```typescript
import {
  isGitRepo,
  getCurrentBranch,
  getCurrentCommit,
  getChangedFiles,
} from '@liendev/core';

const isGit = await isGitRepo('./my-project');
const branch = await getCurrentBranch('./my-project');
const commit = await getCurrentCommit('./my-project');
const changed = await getChangedFiles('./my-project');
```

## Advanced Usage

### Warm Workers (Cloud/Action Use)

Keep embeddings loaded between requests for better performance:

```typescript
import { LocalEmbeddings, indexCodebase } from '@liendev/core';

// Initialize once
const embeddings = new LocalEmbeddings();
await embeddings.initialize();

// Reuse across multiple indexing operations
for (const project of projects) {
  await indexCodebase({
    rootDir: project.path,
    embeddings,  // Reuse warm embeddings
  });
}
```

### Custom Embedding Service

Implement `EmbeddingService` interface for custom embeddings:

```typescript
interface EmbeddingService {
  initialize(): Promise<void>;
  embed(texts: string[]): Promise<number[][]>;
  getDimension(): number;
}

class CustomEmbeddings implements EmbeddingService {
  async initialize() { /* ... */ }
  async embed(texts: string[]) { /* ... */ }
  getDimension() { return 768; }
}

await indexCodebase({
  embeddings: new CustomEmbeddings(),
});
```

### Progress Tracking

Monitor indexing progress in real-time:

```typescript
await indexCodebase({
  rootDir: './large-project',
  onProgress: (progress) => {
    const pct = (progress.filesCompleted / progress.totalFiles * 100).toFixed(1);
    console.log(`[${pct}%] ${progress.filesCompleted}/${progress.totalFiles} files`);
  },
});
```

## Supported Languages

- TypeScript / JavaScript
- Python
- PHP

More languages coming soon!

## Performance

- **Embeddings**: Local transformer model (~50ms per chunk)
- **Vector DB**: LanceDB (Apache Arrow, SIMD-optimized)
- **Chunking**: AST-based with fallback to line-based
- **Indexing**: ~1000 LOC/sec on typical hardware

## Architecture

```
@liendev/core
├── indexer/         # Code scanning, chunking, AST parsing
├── embeddings/      # Local embeddings (transformers.js)
├── vectordb/        # LanceDB wrapper
├── insights/        # Complexity analysis
├── config/          # Configuration management
├── frameworks/      # Framework detection
└── git/             # Git utilities
```

## Who Uses This?

- **@liendev/cli** - CLI and MCP server
- **@liendev/action** - GitHub Action
- **@liendev/cloud** - Cloud backend (private)
- **Third-party integrations** - Your custom tools!

## License

MIT

## Links

- [Main Lien Repository](https://github.com/getlien/lien)
- [Documentation](https://lien.dev)
- [Issues](https://github.com/getlien/lien/issues)

# @liendev/core

Core indexing and analysis engine for Lien. This package provides the low-level APIs for structural code intelligence — dependency analysis, complexity metrics, and test associations — plus fast lexical (FTS5/BM25) code search over a local SQLite store. No embeddings, no model download.

## Installation

```bash
npm install @liendev/core
```

## Usage

```typescript
import {
  indexCodebase,
  createVectorDB,
  ComplexityAnalyzer,
} from '@liendev/core';

// Index a codebase into the local SQLite structural store
await indexCodebase({
  rootDir: '/path/to/project',
});

// Open the structural store for the project
const db = await createVectorDB('/path/to/project');
await db.initialize();

// Run lexical (FTS5/BM25) keyword search
const results = await db.search('authenticate session token', 10);

// Analyze complexity
const analyzer = new ComplexityAnalyzer(db);
const report = await analyzer.analyze();

console.log(`Found ${report.summary.totalViolations} complexity violations`);
```

## API Reference

### Indexing

#### `indexCodebase(options: IndexingOptions): Promise<IndexingResult>`

Index a codebase for lexical (FTS5) search and structural analysis. Chunks are
parsed from the AST, enriched with complexity metrics and dependency metadata,
and written to a local SQLite database — there is no embedding step.

```typescript
interface IndexingOptions {
  rootDir?: string;           // Root directory (default: cwd)
  force?: boolean;            // Force full reindex (default: false)
  verbose?: boolean;          // Verbose output (default: false)
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

### Storage Backend

Lien stores chunks in a local SQLite database behind the `VectorDBInterface`
seam. `createVectorDB()` constructs the backend (currently always the SQLite
structural store); the seam exists so an alternative backend can be introduced
without touching call sites.

#### `createVectorDB(rootDir: string): Promise<VectorDBInterface>`

```typescript
const db = await createVectorDB('./my-project');
await db.initialize();
```

#### `db.search(query: string, limit?: number): Promise<SearchResult[]>`

Perform lexical (FTS5/BM25) keyword search. The query text is tokenized and
matched against symbol names, identifier-split symbol tokens, and chunk content;
results are ranked by BM25. This is **keyword** search, not meaning-based: a
paraphrase that shares no vocabulary with the code will not match. `limit`
defaults to 5.

```typescript
const results = await db.search('error handling retry backoff', 10);
```

### Complexity Analysis

#### `new ComplexityAnalyzer(db: VectorDBInterface)`

Create a complexity analyzer. Uses default thresholds (no config needed).

```typescript
const analyzer = new ComplexityAnalyzer(db);
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
- Environment variables (`LIEN_BACKEND`, `LIEN_HOME`)
- Auto-detected ecosystems
- Sensible defaults for all settings

For more details, see the [Configuration Guide](https://lien.dev/guide/configuration).

#### `createDefaultConfig(): LienConfig`

Create a default configuration.

```typescript
const config = createDefaultConfig();
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

TypeScript / JavaScript, Python, PHP, Rust, Go, Java, C#, Ruby, Kotlin, Swift,
and more. See the [main README](https://github.com/getlien/lien#supported-languages)
for the full list.

## Performance

- **Storage**: SQLite (`better-sqlite3`, synchronous C binding) — ~1.8MB native install
- **Search**: SQLite FTS5 with BM25 ranking (porter + unicode61 tokenizer)
- **Chunking**: AST-based with fallback to line-based
- **File context lookup**: sub-millisecond (indexed `WHERE file IN (...)`)

## Architecture

```
@liendev/core
├── indexer/         # Indexing orchestration: manifest, incremental updates
├── vectordb/        # Storage backend behind VectorDBInterface + factory
│   └── sqlite/      #   SQLite structural store + FTS5/BM25 lexical search
├── insights/        # Complexity analysis
├── config/          # Configuration management
└── git/             # Git utilities
```

## Who Uses This?

- **@liendev/lien** — CLI and MCP server
- **Third-party integrations** — Your custom tools!

## Links

- [Main Lien Repository](https://github.com/getlien/lien)
- [Documentation](https://lien.dev)
- [Issues](https://github.com/getlien/lien/issues)

# Lien

> **French for "link" or "connection"** - Connecting AI to your codebase

Lien is a local-first semantic code search tool that provides deep codebase context to AI coding assistants like Cursor through the Model Context Protocol (MCP). Everything runs locally—your code never leaves your machine.

## Features

- 🔒 **100% Local & Private** - Code never leaves your machine
- 🚀 **Semantic Search** - Natural language queries to find relevant code
- 🎯 **MCP Integration** - Works seamlessly with Cursor and other MCP-compatible tools
- ⚡ **Fast** - Queries return in <500ms, indexing completes in minutes
- 🆓 **Free Forever** - No API costs, no subscriptions
- 📦 **Zero Config** - Works out of the box with sensible defaults

## Installation

### Global Installation (Recommended)

```bash
npm install -g @liendev/lien
```

### Using npx (No Installation)

```bash
npx @liendev/lien init
```

## Quick Start

### 1. Initialize in Your Project

```bash
cd /path/to/your/project
lien init  # Detects frameworks automatically
```

This creates a `.lien.config.json` file with framework-aware settings. During initialization, you'll be prompted to:
- Select which frameworks to enable
- Customize framework settings (optional)
- Install recommended Cursor rules (optional but recommended)
  - Creates `.cursor/rules` if it doesn't exist
  - Creates `.cursor/rules/lien.mdc` if `.cursor/rules` is already a directory
  - **Preserves existing rules**: If `.cursor/rules` exists as a file, Lien will offer to convert it to a directory structure, saving your original rules as `project.mdc` and adding Lien rules as `lien.mdc`

### 2. Index Your Codebase

```bash
lien index
```

### 3. Start the MCP Server

```bash
lien serve
```

**Note:** On first run, Lien will automatically index your codebase if you skip step 2. This may take 5-20 minutes depending on project size. The embedding model (~100MB) will be downloaded on first use.

### 4. Configure Cursor

Create or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "lien": {
      "command": "lien",
      "args": ["serve"],
      "cwd": "/absolute/path/to/your/project"
    }
  }
}
```

**Replace `/absolute/path/to/your/project`** with your actual project path.

**Note:** If you accepted the Cursor rules installation during `lien init`, your project already has `.cursor/rules` configured!

### 5. Restart Cursor

Restart Cursor to load the new MCP configuration.

### 6. Test It Out!

In Cursor chat, try queries like:

- "Search for authentication logic"
- "Find error handling patterns"
- "Show me database connection code"
- "List all API endpoints"

## Monorepo Support

Lien supports indexing multiple frameworks within a single repository:

```bash
# Example monorepo structure
my-app/
  ├── src/                  # Node.js/TypeScript
  │   ├── utils.ts
  │   └── utils.test.ts
  ├── backend/              # Laravel
  │   ├── app/Models/
  │   └── tests/Unit/
  └── .lien.config.json

# Run lien init from the root
cd my-app
lien init  # Detects both Node.js and Laravel

# Generated config:
{
  "frameworks": [
    {
      "name": "nodejs",
      "path": ".",
      "config": { /* Node.js patterns */ }
    },
    {
      "name": "laravel",
      "path": "backend",
      "config": { /* Laravel patterns */ }
    }
  ]
}
```

Lien will:
- Index files from both frameworks
- Apply framework-specific test patterns
- Associate tests correctly within framework boundaries

### Supported Frameworks

- **Node.js/TypeScript**: Automatic detection via `package.json`, supports Jest, Vitest, Mocha, AVA
- **Laravel/PHP**: Automatic detection via `composer.json`. Indexes PHP backend (`app/`, `routes/`, `config/`), frontend assets (`resources/js/**/*.{js,ts,jsx,tsx,vue}`), and Blade templates

More frameworks coming soon! See [CONTRIBUTING.md](./CONTRIBUTING.md) to add support for your framework.

## Migrating from v0.2.0

If you have an existing `.lien.config.json` from v0.2.0:

```bash
# Automatic migration on first load
lien index  # or any command that loads config

# Manual upgrade via init
lien init --upgrade
```

Your old config will be:
- Backed up to `.lien.config.json.v0.2.0.backup`
- Converted to a single "generic" framework at root
- Fully compatible with v0.3.0 features

All your custom settings (chunk size, concurrency, exclusions, etc.) are preserved during migration.

## CLI Commands

### `lien init`

Initialize Lien in the current directory. Detects frameworks and creates `.lien.config.json`.

```bash
lien init

# Upgrade existing config
lien init --upgrade
```

### `lien index`

Index your codebase for semantic search.

```bash
lien index

# With options
lien index --watch  # Watch for changes (not yet implemented)
```

### `lien serve`

Start the MCP server for Cursor integration.

```bash
lien serve
```

### `lien status`

Show indexing status and statistics.

```bash
lien status
```

### `lien reindex`

Clear the existing index and re-index from scratch.

```bash
lien reindex
```

## Configuration

The `.lien.config.json` file allows you to customize indexing behavior:

```json
{
  "version": "0.1.0",
  "indexing": {
    "exclude": [
      "node_modules/**",
      "**/*.test.ts",
      "dist/**",
      "build/**"
    ],
    "include": [
      "**/*.ts",
      "**/*.tsx",
      "**/*.js",
      "**/*.jsx",
      "**/*.py",
      "**/*.go",
      "**/*.rs"
    ],
    "chunkSize": 75,
    "chunkOverlap": 10
  },
  "mcp": {
    "port": 7133,
    "transport": "stdio"
  }
}
```

### Configuration Options

- **`indexing.exclude`**: Glob patterns to exclude from indexing
- **`indexing.include`**: Glob patterns to include in indexing
- **`indexing.chunkSize`**: Number of lines per chunk (default: 75)
- **`indexing.chunkOverlap`**: Overlapping lines between chunks (default: 10)
- **`indexing.concurrency`**: Files processed in parallel (default: 4)
- **`indexing.embeddingBatchSize`**: Chunks per embedding batch (default: 50)
- **`indexing.indexTests`**: Index test files and detect associations (default: true)
- **`indexing.useImportAnalysis`**: Enable import-based test detection for Tier 1 languages (default: true)
- **`mcp.transport`**: MCP transport type (currently only "stdio" supported)

## Performance Tuning

Lien uses **concurrent indexing** and **parallel embedding** for optimal performance:

- **Concurrent file processing**: Multiple files processed simultaneously  
- **Parallel embedding processing**: Embeddings generated concurrently within batches

You can optimize performance based on your hardware:

```json
{
  "indexing": {
    "concurrency": 4,           // Files processed in parallel (1-8 recommended)
    "embeddingBatchSize": 50    // Chunks per batch (10-100 recommended)
  }
}
```

### Recommendations

**Based on CPU Cores:**
- **4-8 cores**: Use concurrency 4-6
- **8+ cores**: Use concurrency 6-8
- **2-4 cores**: Use concurrency 2-3

**Based on RAM:**
- **16GB+**: Default settings work well
- **8-16GB**: Reduce concurrency to 2-3
- **<8GB**: Use concurrency 1-2, batchSize 25

**Based on Storage:**
- **SSD**: Higher concurrency benefits more (6-8)
- **HDD**: Moderate concurrency (2-4)

**Performance Impact:**
- Default settings (concurrency: 4, batchSize: 50): **3-4x faster** than sequential
- Higher concurrency: Better for projects with many small files
- Larger batch sizes: Better GPU/CPU utilization, more memory usage

**Sequential Mode:**
If you prefer sequential processing, set `concurrency: 1` in your config.

## MCP Tools

Lien exposes the following tools via MCP:

### `semantic_search`

Search your codebase using natural language.

**Parameters:**
- `query` (string, required): Natural language search query
- `limit` (number, optional): Maximum results to return (default: 5)

**Example:**
```
Search for "user authentication flow"
```

### `find_similar`

Find code similar to a given snippet.

**Parameters:**
- `code` (string, required): Code snippet to find similar implementations
- `limit` (number, optional): Maximum results to return (default: 5)

**Example:**
```
Find similar code to this function: async function fetchUser() { ... }
```

### `get_file_context`

Get all chunks and related context for a specific file.

**Parameters:**
- `filepath` (string, required): Path to file (relative to project root)
- `includeRelated` (boolean, optional): Include related chunks from other files (default: true)

**Example:**
```
Show context for src/utils/auth.ts
```

### `list_functions`

List all indexed functions and classes (optionally filtered).

**Parameters:**
- `pattern` (string, optional): Regex pattern to filter results
- `language` (string, optional): Filter by language (e.g., "typescript", "python")

**Example:**
```
List all functions matching "handle.*Request"
```

## How It Works

1. **Indexing**: Lien scans your codebase, chunks code into manageable pieces, and generates embeddings using a local ML model (all-MiniLM-L6-v2)
2. **Storage**: Embeddings are stored in a local vector database (LanceDB) in `~/.lien/indices/`
3. **Search**: When you query through Cursor, Lien converts your query to an embedding and finds the most semantically similar code chunks
4. **Context**: Results are returned to Cursor, which uses them to provide better, context-aware responses

## Performance

- **Small projects** (1k files): ~5 minutes to index
- **Medium projects** (10k files): ~20 minutes to index
- **Large projects** (50k files): ~30-60 minutes to index
- **Query time**: < 500ms
- **Disk usage**: ~500MB per 100k chunks
- **RAM usage**: ~200-500MB during indexing, ~100-200MB during queries

## Troubleshooting

### "Index not found" error

Run `lien index` to create the index first.

### "Model download failed"

The embedding model downloads on first run. Ensure you have:
- Internet connection (first run only)
- ~100MB free disk space
- Node.js 22+ installed

### Cursor doesn't show Lien tools

1. Check `~/.cursor/mcp.json` is valid JSON
2. Ensure the `cwd` path is absolute and correct
3. Restart Cursor completely
4. Check Cursor's developer console for errors

### Slow indexing

- Exclude unnecessary directories in `.lien.config.json`
- Ensure you're not indexing `node_modules`, `dist`, or other build artifacts
- Close other resource-intensive applications

### Results not relevant

- Try re-indexing: `lien reindex`
- Adjust chunk size in config (larger chunks = more context)
- Be more specific in your queries

## Architecture

Lien is built with:

- **TypeScript** for type-safe development
- **transformers.js** for local embeddings (no external API calls)
- **LanceDB** for vector storage
- **MCP SDK** for Cursor integration

- **Commander.js** for CLI

### Supported Languages

Lien indexes and understands code in: TypeScript, JavaScript (including JSX/TSX), Vue, Python, PHP, Go, Rust, Java, C/C++, Ruby, Swift, Kotlin, C#, and Scala.

See [local-architecture.md](./local-architecture.md) for detailed architecture documentation.

## Roadmap

### v0.2 (Coming Soon)
- [ ] Incremental indexing (watch mode)
- [ ] Tree-sitter for better code chunking
- [ ] Multi-repo support
- [ ] Web dashboard

### v0.3 (Future)
- [ ] GitHub PR review integration
- [ ] Team features
- [ ] Cloud sync (optional)
- [ ] Advanced filtering and search

## Contributing

Contributions are welcome! Please read our contributing guidelines (coming soon).

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Testing

Lien includes comprehensive test coverage for core functionality.

### Running Tests

```bash
# Run tests once
cd packages/cli
npm test

# Watch mode (runs tests on file changes)
npm run test:watch

# Interactive UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

### Test Structure

```
packages/cli/
├── src/
│   ├── indexer/
│   │   ├── chunker.ts
│   │   └── chunker.test.ts         # Unit tests next to code
│   └── ...
└── test/
    ├── integration/
    │   └── indexing-flow.test.ts   # Integration tests
    ├── helpers/
    │   ├── mock-embeddings.ts      # Test utilities
    │   └── test-db.ts
    └── fixtures/
        └── sample-code/             # Test data
```

### Coverage Goals

- Unit tests: 60%+ coverage of core logic
- Integration tests: Key flows (scan → chunk → embed → store → search)
- CI: Automated testing on all PRs

### Contributing Tests

When contributing, please:
- Add unit tests for new functions
- Add integration tests for new features
- Ensure all tests pass before submitting PR

## Contributing & Development

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

### Quick Start for Contributors

```bash
# Clone and setup
git clone https://github.com/alfhenderson/lien.git
cd lien
npm install
npm run build

# Make changes
# ... edit files ...

# Test locally
cd packages/cli && npm link
lien --help

# Release (automated)
npm run release -- patch "fix: your bug fix"
npm run release -- minor "feat: your new feature"
```

### Release Process

Lien uses an automated release script that handles:
- ✅ Version bumping (semantic versioning)
- ✅ Building the project
- ✅ Updating CHANGELOG.md
- ✅ Creating git commit and tag

**Example:**
```bash
npm run release -- patch "fix: improve reconnection logic"
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full details on the development workflow.

## Support

- **Issues**: [GitHub Issues](https://github.com/alfhenderson/lien/issues)
- **Discussions**: [GitHub Discussions](https://github.com/alfhenderson/lien/discussions)
- **Twitter**: [@alfhenderson](https://twitter.com/alfhenderson)

## Acknowledgments

- Built with the [Model Context Protocol](https://modelcontextprotocol.io)
- Powered by [Xenova's transformers.js](https://huggingface.co/docs/transformers.js)
- Vector storage by [LanceDB](https://lancedb.github.io/lancedb/)

---

**Made with ❤️ for developers who care about privacy and local-first tools.**


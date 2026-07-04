# Introduction

Lien _(French for "link" or "connection")_ is a local-first **code-intelligence layer** for AI coding assistants like Cursor and Claude Code, delivered through the Model Context Protocol (MCP).

## What is Lien?

Lien indexes your codebase locally and gives AI assistants the structural context they need to work safely: reverse dependencies and blast radius, complexity hotspots, and test associations — plus fast lexical code search for discovery. Unlike cloud-based solutions, everything runs on your machine—your code never leaves your computer.

**Setup takes 30 seconds:** Install globally, run `lien init`, restart your AI assistant. There's no model to download — the first index runs instantly and offline.

## Key Benefits

### Zero Configuration
Lien auto-detects your project structure and "just works." No config files, no framework selection, no pattern configuration.

### Privacy First
Your code is precious intellectual property. Lien processes everything locally with no external API calls, no data collection, and no telemetry.

### Structural Intelligence
The questions an agent needs answered before editing your code — "what depends on this?", "how complex is this?", "what tests cover it?" — are answered from an accurate import graph and per-symbol metrics, not guessed.

### Explainable Lexical Search
For discovery, Lien runs full-text (FTS5/BM25) keyword search over code, docstrings, and identifier-split symbol names. It's keyword-based, not meaning-based — query with terms that appear in the code, and you can always see *why* a result matched.

### AI-Powered Development
Integrate with Cursor, Claude Code, and other MCP-compatible tools to give AI assistants deep context about your codebase, enabling better suggestions and answers.

### Framework Aware
Automatically detects and adapts to your project structure:
- **Node.js/TypeScript**: Package.json detection, Jest/Vitest/Mocha support
- **Laravel/PHP**: Composer detection, blade templates, frontend assets
- **Monorepo**: Multiple frameworks in one repository

Additionally, 15+ languages (including Liquid, Go, Rust, Python, and more) are indexed out of the box via the default scan pattern.

## How Does It Work?

1. **Scan**: Lien walks your codebase and identifies source files based on ecosystem detection
2. **Chunk**: Files are split into semantic chunks (functions, classes, logical blocks) via Tree-sitter AST parsing
3. **Enrich**: Each chunk gets complexity metrics, imports/exports, call sites, and test associations
4. **Store**: Chunks and the import graph are written to a local SQLite database — no embeddings, no model
5. **Answer**: Structural queries (dependents, complexity, context) are served with indexed SQL; discovery is served with FTS5/BM25 keyword search
6. **Retrieve**: Relevant chunks and structural facts are returned with context

## Use Cases

### Understanding New Codebases
Quickly understand how a new codebase works without reading every file:
- "Show me the database schema"
- "How is error handling implemented?"
- "Where are API routes defined?"

### Finding Implementations
Locate specific functionality across a large codebase:
- "Find JWT token validation"
- "Show authentication middleware"
- "Where is user registration handled?"

### Discovering Patterns
Find similar code patterns for refactoring or consistency:
- "Find similar validation functions"
- "Show all database queries"
- "Locate API endpoint handlers"

### Test Coverage
Understand what tests cover specific code:
- "What tests cover this module?"
- "Show related test files"
- "Find test patterns for this feature"

## Architecture

Lien is built with modern, performant tools:

- **TypeScript** for type-safe development
- **Tree-sitter** for AST-based chunking and complexity analysis
- **SQLite** (`better-sqlite3`) for the structural store, with **FTS5/BM25** for lexical search
- **MCP SDK** for AI assistant integration
- **Commander.js** for CLI

## Supported Languages

**Full AST Support** (function detection, complexity analysis):
- TypeScript, JavaScript (JSX/TSX)
- Python
- PHP
- Rust
- Go
- Java
- C#
- Ruby
- Kotlin
- Swift

**Indexed for lexical search** (chunking + FTS5):
- All of the above, plus Vue, Liquid, C/C++, Scala, Markdown

## Next Steps

Ready to get started? Follow our [installation guide](/guide/installation) to set up Lien in minutes.



# Introduction

Lien _(French for "link" or "connection")_ is a local-first semantic code search tool that provides deep codebase context to AI coding assistants like Cursor and Claude Code through the Model Context Protocol (MCP).

## What is Lien?

Lien indexes your codebase locally and enables AI assistants to understand your code through natural language queries. Unlike cloud-based solutions, everything runs on your machine—your code never leaves your computer.

**Setup takes 30 seconds:** Install globally, add one config file, restart your AI assistant. That's it.

## Key Benefits

### Zero Configuration
Lien auto-detects your project structure and "just works." No config files, no framework selection, no pattern configuration.

### Privacy First
Your code is precious intellectual property. Lien processes everything locally with no external API calls, no data collection, and no telemetry.

### Semantic Understanding
Instead of simple text search, Lien understands code semantically. Ask "how does authentication work?" and get relevant results even if the code doesn't contain those exact words.

### AI-Powered Development
Integrate with Cursor, Claude Code, and other MCP-compatible tools to give AI assistants deep context about your codebase, enabling better suggestions and answers.

### Framework Aware
Automatically detects and adapts to your project structure:
- **Node.js/TypeScript**: Package.json detection, Jest/Vitest/Mocha support
- **Laravel/PHP**: Composer detection, blade templates, frontend assets
- **Shopify**: Liquid theme detection, hybrid themes with Vue/React
- **Monorepo**: Multiple frameworks in one repository

## How Does It Work?

1. **Scan**: Lien walks your codebase and identifies source files based on framework detection
2. **Chunk**: Files are split into semantic chunks (functions, classes, logical blocks)
3. **Embed**: Each chunk is converted to a vector embedding using a local ML model
4. **Store**: Embeddings are stored in a local vector database (LanceDB)
5. **Query**: When you search, your query is embedded and matched against stored chunks
6. **Retrieve**: The most relevant code chunks are returned with context

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
- **transformers.js** for local embeddings (no external API)
- **LanceDB** for vector storage
- **MCP SDK** for AI assistant integration
- **Commander.js** for CLI

## Supported Languages

**Full AST Support** (function detection, complexity analysis):
- TypeScript, JavaScript (JSX/TSX)
- Python
- PHP
- Rust

**Semantic Search** (chunking and embeddings):
- All of the above, plus Vue, Liquid, Go, Java, C/C++, Ruby, Swift, Kotlin, C#, Scala, Markdown

## Next Steps

Ready to get started? Follow our [installation guide](/guide/installation) to set up Lien in minutes.



# How It Works

Lien provides local-first semantic code search through a simple four-step process:

## The Journey of Your Code

### 1. 🔍 Indexing
When you run `lien index`, Lien scans your codebase and breaks it down into manageable chunks. Each chunk contains a logical piece of code - a function, a class, or a related block of logic.

### 2. 🧠 Embedding
Each code chunk is converted into a **vector embedding** - a mathematical representation that captures its semantic meaning. This happens entirely on your machine using a local ML model (all-MiniLM-L6-v2). No external API calls, no cloud services.

### 3. 💾 Storage
These embeddings are stored in a local vector database (LanceDB) in `~/.lien/indices/`. Think of it as a semantic index of your entire codebase that enables lightning-fast searches.

### 4. 🎯 Search
When you ask Cursor a question like "how does authentication work?", Lien:
- Converts your query into a vector embedding
- Finds the most semantically similar code chunks
- Returns relevant results to Cursor
- Cursor uses this context to give you better answers

All in under 500ms! ⚡

## Why Semantic Search?

Traditional text search looks for exact matches. Semantic search understands **meaning**:

**Text search:** "JWT authentication" → only finds code with those exact words  
**Semantic search:** "user login security" → finds JWT auth, OAuth, session management, and more!

## Privacy First

Everything runs locally:
- ✅ Your code never leaves your machine
- ✅ No external API calls
- ✅ No telemetry or tracking
- ✅ No internet required (after initial model download)

## Architecture

Lien is built with modern, performant tools:
- **TypeScript** for type-safe development
- **transformers.js** for local embeddings
- **LanceDB** for vector storage
- **Model Context Protocol (MCP)** for Cursor integration

## Want to Learn More?

For detailed technical architecture, flow diagrams, and implementation details, see the [Architecture Documentation on GitHub](https://github.com/getlien/lien/tree/main/docs/architecture).

## Framework-Aware & Monorepo Support

Lien automatically detects your project structure:
- **Node.js/TypeScript** - via package.json
- **Laravel/PHP** - via composer.json
- **Shopify Themes** - via config/settings_schema.json
- **Monorepos** - Multiple frameworks in one repo (e.g., Node.js frontend + Laravel backend)

Each framework gets appropriate test patterns, file exclusions, and indexing strategies!

## Supported Languages

Lien indexes and understands code in:

**Full AST Support** (function detection, complexity analysis):
- TypeScript, JavaScript (JSX/TSX)
- Python
- PHP

**Semantic Search** (chunking and embeddings):
- All of the above, plus Go, Rust, Java, C/C++, Vue, Ruby, Swift, Kotlin, C#, Scala, and more!

## Complexity Analysis

Lien tracks four complementary complexity metrics:

| Metric | What it Measures | Best For |
|--------|-----------------|----------|
| **Cyclomatic** | Decision paths (if, for, switch) | Testability - how many tests needed? |
| **Cognitive** | Mental effort (nesting depth, breaks) | Understandability - how hard to read? |
| **Halstead Effort** | Reading time based on operators/operands | Learning curve - how long to understand? |
| **Halstead Bugs** | Predicted bug count (Volume / 3000) | Reliability - how bug-prone is this? |

All metrics are calculated during indexing using Tree-sitter AST parsing. Cognitive complexity is based on [SonarSource's specification](https://www.sonarsource.com/docs/CognitiveComplexity.pdf), Halstead metrics are based on Maurice Halstead's "Elements of Software Science" (1977).

## Performance

- **Query time:** < 500ms
- **Small projects** (1k files): ~5 minutes to index
- **Medium projects** (10k files): ~20 minutes to index
- **Large projects** (50k files): ~30-60 minutes to index
- **Disk usage:** ~500MB per 100k chunks
- **RAM usage:** ~200-500MB during indexing, ~100-200MB during queries

---

Ready to get started? Check out our [Quick Start Guide](/guide/getting-started)!


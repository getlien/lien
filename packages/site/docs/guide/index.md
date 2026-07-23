# Introduction

Lien _(French for "link" or "connection")_ is a local-first **code-intelligence layer** for AI coding assistants like Cursor and Claude Code, delivered through the Model Context Protocol (MCP).

## What is Lien?

Lien indexes your codebase locally and gives AI assistants the structural context they need to work safely: reverse dependencies and blast radius, complexity hotspots, and test associations, plus fast lexical code search for discovery. Unlike cloud-based solutions, everything runs on your machine. Your code never leaves your computer. See [How It Works](/how-it-works) for the indexing-to-answer pipeline.

**Setup takes 30 seconds:** Install globally, run `lien init`, restart your AI assistant. There's no model to download: the first index runs instantly and offline.

## Key Benefits

### Zero Configuration
Lien auto-detects your project structure and "just works." No config files, no ecosystem selection, no pattern configuration.

### Privacy First
Your code stays local. Lien processes everything on your machine, with no external API calls, no data collection, and no telemetry.

### Structural Intelligence
The questions an agent needs answered before editing your code ("what depends on this?", "how complex is this?", "what tests cover it?") are answered from an accurate import graph and per-symbol metrics, not guessed.

### Explainable Lexical Search
For discovery, Lien runs full-text (FTS5/BM25) keyword search over code, docstrings, and identifier-split symbol names. It's keyword-based, not meaning-based: query with terms that appear in the code, and you can always see *why* a result matched.

### Ecosystem-Aware Indexing
Lien detects your project type via 12 ecosystem presets (Node.js, Python, PHP, Laravel, Django, Ruby, Rails, Rust, JVM, Swift, .NET, Astro) and applies the right file exclusions automatically. See [Configuration](/guide/configuration) for detection details, or [How It Works](/how-it-works#supported-languages) for the full language list.

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

## Next Steps

- Read [How It Works](/how-it-works) for the indexing pipeline and the lexical-vs-semantic tradeoff
- Follow the [installation guide](/guide/installation) to set up Lien in minutes
- See [MCP Tools](/guide/mcp-tools) for the full tool reference

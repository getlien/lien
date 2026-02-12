# Lien

> **/ljɛ̃/** — French for "link"

**Give AI deep understanding of your codebase through semantic search. 100% local, 100% private.**

Lien connects AI coding assistants like Cursor and Claude Code to your codebase through the Model Context Protocol (MCP). Ask questions in natural language, get precise answers from semantic search—all running locally on your machine.

📚 **[Full Documentation](https://lien.dev)** | 🚀 **[Getting Started](https://lien.dev/guide/getting-started)** | 🔍 **[How It Works](https://lien.dev/how-it-works)**

---

## Features

- 🔒 **100% Local & Private** - All code analysis happens on your machine
- 🚀 **Semantic Search** - Natural language queries: "How does authentication work?"
- 🌐 **Cross-Repo Search** - Search across all repositories in your organization (Qdrant backend)
- 🎯 **MCP Integration** - Works seamlessly with Cursor, Claude Code, and other MCP-compatible tools
- ⚡ **Fast** - Sub-500ms queries, minutes to index large codebases
- 🆓 **Free Forever** - No API costs, no subscriptions, no usage limits
- 📦 **Framework-Aware** - Auto-detects Node.js, Laravel, and more; supports 15+ languages
- 🏗️ **Monorepo Support** - Index multiple frameworks in one repository
- 📊 **Complexity Analysis** - Human-friendly metrics: test paths, mental load, time to understand
- 🔍 **Impact Analysis** - Find all dependents before refactoring with risk assessment

## Quick Start

```bash
# 1. Install
npm install -g @liendev/lien

# 2. Add to your project - create .cursor/mcp.json
{
  "mcpServers": {
    "lien": {
      "command": "lien",
      "args": ["serve"]
    }
  }
}

# 3. Restart your AI assistant (Cursor, Claude Code) and start asking questions!
```

That's it—zero configuration needed. Lien auto-detects your project and indexes on first use.

**👉 [Full installation guide](https://lien.dev/guide/installation)**

### Qdrant Backend (Cross-Repo Search)

For cross-repository search across your organization, configure Qdrant:

```bash
# Option 1: Global config file
mkdir -p ~/.lien
cat > ~/.lien/config.json <<EOF
{
  "backend": "qdrant",
  "qdrant": {
    "url": "http://localhost:6333",
    "apiKey": "your-api-key"
  }
}
EOF

# Option 2: Environment variables
export LIEN_BACKEND=qdrant
export LIEN_QDRANT_URL=http://localhost:6333
export LIEN_QDRANT_API_KEY=your-api-key

# Index your repos (orgId auto-detected from git remote)
lien index
```

**Note:** `orgId` is automatically extracted from your git remote URL. Cross-repo search requires all repos to share the same `orgId`.

## MCP Tools

Lien exposes **6 powerful tools** via Model Context Protocol:

| Tool | Description |
|------|-------------|
| `semantic_search` | Natural language code search (supports `crossRepo` with Qdrant) |
| `find_similar` | Find similar code patterns |
| `get_files_context` | Get file context with test associations |
| `list_functions` | List symbols by pattern |
| `get_dependents` | Impact analysis (what depends on this?) |
| `get_complexity` | Tech debt analysis with human-friendly metrics |

### Complexity Metrics

Lien tracks code complexity with intuitive outputs:

- 🔀 **Test paths** - Cyclomatic complexity as "needs ~X tests for full coverage"
- 🧠 **Mental load** - Cognitive complexity with nesting penalty
- ⏱️ **Time to understand** - Halstead effort as readable duration (~2h 30m)
- 🐛 **Estimated bugs** - Halstead prediction (Volume / 3000)

## Documentation

- **[Installation](https://lien.dev/guide/installation)** - npm, npx, or local setup
- **[Getting Started](https://lien.dev/guide/getting-started)** - Step-by-step configuration for Cursor or Claude Code
- **[Configuration](https://lien.dev/guide/configuration)** - Customize indexing, thresholds, performance
- **[CLI Commands](https://lien.dev/guide/cli-commands)** - Full command reference
- **[MCP Tools](https://lien.dev/guide/mcp-tools)** - Complete API reference for all 6 tools
- **[How It Works](https://lien.dev/how-it-works)** - Architecture overview

## Supported Languages

TypeScript • JavaScript • Vue • Python • PHP • Liquid • Go • Rust • Java • C/C++ • Ruby • Swift • Kotlin • C# • Scala • Markdown

**Ecosystem Presets:** 12 ecosystem presets including Node.js, Python, PHP, Laravel, Ruby, Rails, Rust, JVM, Swift, .NET, Django, and Astro (auto-detected)

## Contributing

Contributions welcome! See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for guidelines.

## Support

- 🐛 **[Issues](https://github.com/getlien/lien/issues)** - Report bugs or request features
- 💬 **[Discussions](https://github.com/getlien/lien/discussions)** - Ask questions and share ideas

## License

AGPL-3.0 © [Alf Henderson](https://github.com/alfhen)

**Lien is free forever for local use.** The AGPL license ensures that:
- ✅ You can use Lien locally without restrictions
- ✅ You can modify and distribute Lien freely
- ✅ Improvements get contributed back to the community
- ✅ We can sustain long-term development

For questions about licensing, contact us at alf@lien.dev

---

**Made with ❤️ for developers who value privacy and local-first tools.**

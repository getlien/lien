# Lien

> **/ljɛ̃/** — French for "link"

**Give AI deep understanding of your codebase through semantic search. 100% local, 100% private.**

Lien connects AI coding assistants like Cursor to your codebase through the Model Context Protocol (MCP). Ask questions in natural language, get precise answers from semantic search—all running locally on your machine.

📚 **[Full Documentation](https://lien.dev)** | 🚀 **[Getting Started](https://lien.dev/guide/getting-started)** | 🔍 **[How It Works](https://lien.dev/how-it-works)**

---

## Features

- 🔒 **100% Local & Private** - All code analysis happens on your machine
- 🚀 **Semantic Search** - Natural language queries: "How does authentication work?"
- 🎯 **MCP Integration** - Works seamlessly with Cursor and other MCP-compatible tools
- ⚡ **Fast** - Sub-500ms queries, minutes to index large codebases
- 🆓 **Free Forever** - No API costs, no subscriptions, no usage limits
- 📦 **Framework-Aware** - Auto-detects Node.js, Laravel; supports 15+ languages
- 🏗️ **Monorepo Support** - Index multiple frameworks in one repository

## Quick Start

```bash
# Install
npm install -g @liendev/lien

# Setup in your project
cd /path/to/your/project
lien init
lien index

# Configure Cursor - create .cursor/mcp.json
{
  "mcpServers": {
    "lien": {
      "command": "lien",
      "args": ["serve"]
    }
  }
}

# Restart Cursor and start asking questions!
```

**👉 [Full installation guide](https://lien.dev/guide/installation)**

## Documentation

- **[Installation](https://lien.dev/guide/installation)** - npm, npx, or local setup
- **[Getting Started](https://lien.dev/guide/getting-started)** - Step-by-step configuration for Cursor
- **[Configuration](https://lien.dev/guide/configuration)** - Customize indexing, performance tuning
- **[CLI Commands](https://lien.dev/guide/cli-commands)** - Full command reference
- **[MCP Tools](https://lien.dev/guide/mcp-tools)** - API for semantic search tools
- **[How It Works](https://lien.dev/how-it-works)** - Architecture overview

## Supported Languages

TypeScript • JavaScript • Vue • Python • PHP • Laravel • Go • Rust • Java • C/C++ • Ruby • Swift • Kotlin • C# • Scala • Markdown

**Frameworks:** Node.js, Laravel (more coming soon!)

## Contributing

Contributions welcome! See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for guidelines.

## Support

- 🐛 **[Issues](https://github.com/getlien/lien/issues)** - Report bugs or request features
- 💬 **[Discussions](https://github.com/getlien/lien/discussions)** - Ask questions and share ideas

## License

MIT © [Alf Henderson](https://github.com/alfhen)

---

**Made with ❤️ for developers who value privacy and local-first tools.**

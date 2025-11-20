---
layout: home

hero:
  name: "Lien"
  text: "Local-First Semantic Code Search"
  tagline: "Give AI deep understanding of your codebase through semantic search. 100% local, 100% private."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/getlien/lien

features:
  - icon: 🔒
    title: 100% Local & Private
    details: Code never leaves your machine. All embeddings and search happen locally with no external API calls.
  
  - icon: 🚀
    title: Semantic Search
    details: Natural language queries to find relevant code. Ask "how does authentication work?" and get precise results.
  
  - icon: 🎯
    title: MCP Integration
    details: Works seamlessly with Cursor and other MCP-compatible AI coding assistants via Model Context Protocol.
  
  - icon: ⚡
    title: Fast Performance
    details: Queries return in <500ms. Indexing completes in minutes, not hours. Optimized for large codebases.
  
  - icon: 🆓
    title: Free Forever
    details: No API costs, no subscriptions, no usage limits. Run as many queries as you want on as many projects as you need.
  
  - icon: 📦
    title: Framework-Aware
    details: Auto-detects frameworks (Node.js, Laravel) with zero config. Full monorepo support - index multiple frameworks in one repo seamlessly.
---

## Quick Start

Install Lien globally via npm:

```bash
npm install -g @liendev/lien
```

Initialize in your project:

```bash
cd /path/to/your/project
lien init
lien index
```

Configure Cursor by creating `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "lien": {
      "command": "lien",
      "args": ["serve"]
    }
  }
}
```

Restart Cursor and start asking questions about your codebase!

## How It Works

1. **Index**: Lien scans your codebase, chunks code into manageable pieces, and generates embeddings using a local ML model
2. **Store**: Embeddings are stored in a local vector database in `~/.lien/indices/`
3. **Search**: When you query through Cursor, Lien finds the most semantically similar code chunks
4. **Context**: Results are returned to Cursor, providing better, context-aware responses

## Use Cases

- **Understand New Codebases**: "Show me how authentication works"
- **Find Implementations**: "Where are API endpoints defined?"
- **Locate Patterns**: "Find similar error handling code"
- **Discover Related Code**: "What tests cover this module?"

## Privacy First

Lien is built with privacy as a core principle:

- All code analysis happens on your machine
- No data is sent to external servers
- No telemetry or usage tracking
- Open source and auditable

---

<div style="text-align: center; margin-top: 2rem; color: var(--vp-c-text-2);">
  <p><em>Lien</em> /ljɛ̃/ — French for "link"</p>
  <p style="margin-top: 0.5rem; font-size: 0.9em;">Linking semantic code understanding with AI tools, one query at a time.</p>
</div>

<div style="text-align: center; margin-top: 2rem;">
  <strong>Made with ❤️ for developers who care about privacy and local-first tools.</strong>
</div>



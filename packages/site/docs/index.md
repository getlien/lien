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
    details: Works seamlessly with Cursor, Claude Code, and other MCP-compatible AI coding assistants via Model Context Protocol.
  
  - icon: ⚡
    title: Fast Performance
    details: Queries return in <500ms. Indexing completes in minutes, not hours. Optimized for large codebases.
  
  - icon: 📊
    title: Complexity Analysis
    details: Identify tech debt hotspots with cyclomatic complexity analysis. Prioritize refactoring and track code health over time.
  
  - icon: 📦
    title: Framework-Aware
    details: Auto-detects frameworks (Node.js, Laravel, Shopify, PHP) with zero config. Full monorepo support for multi-framework repos.
---

## Quick Start

**1. Install Lien:**

```bash
npm install -g @liendev/lien
```

**2. Configure your AI assistant:**

- **For Cursor**: Create `.cursor/mcp.json` in your project root
- **For Claude Code**: Create `claude_desktop_config.json` in your config folder

<details>
<summary>Cursor Setup (.cursor/mcp.json)</summary>

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
</details>

<details>
<summary>Claude Code Setup (claude_desktop_config.json)</summary>

**Location:**
- macOS: `~/Library/Application Support/Claude/`
- Windows: `%APPDATA%\Claude\`
- Linux: `~/.config/Claude/`

```json
{
  "mcpServers": {
    "lien": {
      "command": "lien",
      "args": ["serve", "--root", "/path/to/your/project"]
    }
  }
}
```

Replace `/path/to/your/project` with your actual project path.
</details>

**3. Restart your AI assistant** and start asking questions about your codebase!

That's it—no configuration files needed. Lien auto-detects your project structure and indexes on first use.

> **Note:** Cursor's per-project `.cursor/mcp.json` approach is recommended for automatic project switching. Claude Code requires global configuration with explicit `--root` paths. See [Getting Started](/guide/getting-started) for details.

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
- **Tech Debt Analysis**: "What are the most complex functions?"
- **Impact Analysis**: "What depends on this file?"

## Privacy First

Lien is built with privacy as a core principle:

- All code analysis happens on your machine
- No data is sent to external servers
- No telemetry or usage tracking
- Open source and auditable

## Free & Open Source

Lien is licensed under AGPL-3.0 and **free forever for local use**. The license ensures:

- ✅ Use Lien locally without restrictions
- ✅ Modify and distribute freely
- ✅ Improvements benefit the community
- ✅ Sustainable long-term development

Questions about licensing? Contact alf@lien.dev

---

<div style="text-align: center; margin-top: 2rem; color: var(--vp-c-text-2);">
  <p><em>Lien</em> /ljɛ̃/ — French for "link"</p>
  <p style="margin-top: 0.5rem; font-size: 0.9em;">Linking semantic code understanding with AI tools, one query at a time.</p>
</div>

<div style="text-align: center; margin-top: 2rem;">
  <strong>Made with ❤️ for developers who care about privacy and local-first tools.</strong>
</div>



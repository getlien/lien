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
    details: Auto-detects 12+ ecosystems (Node.js, Python, PHP, Rust, Ruby, and more) with zero config. Full monorepo support for multi-framework repos.
---

## Quick Start

### Claude Code (recommended) — one-time plugin install

```text
/plugin marketplace add getlien/lien
/plugin install lien
```

That's it. Lien's MCP tools and the Explore agent are available in every Claude Code session, in every repo — no per-project setup. First use in a new git repo triggers a one-time index automatically.

### Other editors (Cursor, Windsurf, OpenCode, Kilo Code, Antigravity)

**1. Install Lien:**

```bash
npm install -g @liendev/lien
```

**2. Configure your editor:**

```bash
lien init
```

This writes the correct MCP config for your editor.

**3. Restart your editor** and start asking questions about your codebase!

Lien auto-detects your project structure and indexes on first use.

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



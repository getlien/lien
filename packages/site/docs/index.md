---
layout: home

hero:
  name: "Lien"
  text: "Local-First Code Intelligence for AI"
  tagline: "Structural analysis + fast lexical search that give AI agents deep understanding of your codebase. 100% local, 100% private."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/getlien/lien

features:
  - icon: 🔍
    title: Impact Analysis
    details: Reverse dependencies and blast radius before you refactor. "What breaks if I change this?" answered with a risk level.
  
  - icon: 📊
    title: Complexity Analysis
    details: Identify tech debt hotspots with cyclomatic, cognitive, and Halstead metrics. Prioritize refactoring and track code health over time.
  
  - icon: 🧪
    title: Test Associations
    details: Know which tests cover a file before you touch it — via naming convention and import analysis across 12+ frameworks.
  
  - icon: 🚀
    title: Lexical Code Search
    details: Fast full-text (FTS5/BM25) keyword search over code, docstrings, and identifier-split symbol names. No embeddings, no model download.
  
  - icon: 🔒
    title: 100% Local & Private
    details: Code never leaves your machine. All analysis happens locally with no external API calls — and nothing to download on first run.
  
  - icon: 🎯
    title: MCP Integration
    details: Works seamlessly with Cursor, Claude Code, and other MCP-compatible AI coding assistants via Model Context Protocol.
---

## Quick Start

### Claude Code (recommended) — one-time plugin install

```text
/plugin marketplace add getlien/lien
/plugin install lien
```

That's it. Lien's MCP tools and the Explore agent are available in every Claude Code session, in every repo — no per-project setup. First use in a new git repo triggers a one-time index automatically. See the [Claude Code plugin guide](/guide/claude-code-plugin) for what its hooks do beyond the MCP config.

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

1. **Index**: Lien scans your codebase and chunks it into semantic units (functions, classes, blocks) using Tree-sitter AST parsing — no model to download
2. **Store**: Chunks, their complexity metrics, and the import graph are written to a local SQLite database in `~/.lien/indices/`
3. **Answer**: When your AI assistant asks a structural question ("what depends on this?", "how complex is this?"), Lien answers it with indexed SQL
4. **Search**: For discovery, Lien runs FTS5/BM25 lexical search over symbol names, identifier-split tokens, and content
5. **Context**: Results flow back to your assistant, giving it accurate, explainable context

## Use Cases

- **Impact Analysis**: "What depends on this file?" / "Is this safe to delete?"
- **Tech Debt Analysis**: "What are the most complex functions?"
- **Test Coverage**: "What tests cover this module?"
- **Find Implementations**: "Where is the retry backoff handled?" (use terms that appear in the code)
- **Locate Patterns**: "Find similar error-handling code"
- **Refactoring Scope**: "How many files need updating if I change this signature?"

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
  <p style="margin-top: 0.5rem; font-size: 0.9em;">Linking code intelligence with AI tools, one query at a time.</p>
</div>

<div style="text-align: center; margin-top: 2rem;">
  <strong>Made with ❤️ for developers who care about privacy and local-first tools.</strong>
</div>



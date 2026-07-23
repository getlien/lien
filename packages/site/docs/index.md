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
    details: Know which tests cover a file before you touch it, via naming convention and import analysis across 12+ frameworks.
  
  - icon: 🚀
    title: Lexical Code Search
    details: Fast full-text (FTS5/BM25) keyword search over code, docstrings, and identifier-split symbol names. No embeddings, no model download.
  
  - icon: 🔒
    title: 100% Local & Private
    details: Code never leaves your machine. All analysis happens locally with no external API calls, and nothing to download on first run.
  
  - icon: 🎯
    title: MCP Integration
    details: Works with Cursor, Claude Code, and other MCP-compatible AI coding assistants via the Model Context Protocol.
---

## Quick Start

### Claude Code (recommended): one-time plugin install

```text
/plugin marketplace add getlien/lien
/plugin install lien
```

That's it. Lien's MCP tools and the Explore agent are available in every Claude Code session, in every repo, with no per-project setup. First use in a new git repo triggers a one-time index automatically. See the [Claude Code plugin guide](/guide/claude-code-plugin) for what its hooks do beyond the MCP config.

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

Lien parses your code with Tree-sitter into a local SQLite database, then answers structural questions ("what depends on this?", "how complex is this?") with indexed SQL, and handles discovery with FTS5/BM25 lexical search. See [How It Works](/how-it-works) for the full pipeline.

## Use Cases

Impact analysis before a refactor, tech-debt hotspots, test coverage lookups, and keyword-based code discovery. See [Use Cases](/guide/#use-cases) in the guide for examples.

## Privacy First

Your code stays on your machine, with no external API calls, no telemetry, and nothing to download before first use. See [How It Works](/how-it-works#privacy-first) for details.

## Free & Open Source

Lien is licensed under AGPL-3.0 and free forever for local use. Questions about licensing? Contact alf@lien.dev

---

<div style="text-align: center; margin-top: 2rem; color: var(--vp-c-text-2);">
  <p><em>Lien</em> /ljɛ̃/: French for "link"</p>
</div>



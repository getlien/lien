# Lien

> **/ljɛ̃/** — French for "link"

**A code-intelligence layer for AI agents: structural analysis + fast lexical search. 100% local, 100% private.**

Lien connects AI coding assistants like Cursor and Claude Code to your codebase through the Model Context Protocol (MCP). Its core value is **structural**: reverse dependencies and blast radius, complexity hotspots, and test associations — the questions an agent needs answered before it edits your code. Alongside that, it offers **fast lexical code search** (FTS5/BM25 over code, docstrings, and identifier-split symbol names). Everything runs locally, with **no embedding model to download** — installs in seconds and indexes offline.

📚 **[Full Documentation](https://lien.dev)** | 🚀 **[Getting Started](https://lien.dev/guide/getting-started)** | 🔍 **[How It Works](https://lien.dev/how-it-works)**

---

## Features

- 🔍 **Impact Analysis** - Find all dependents and blast radius before refactoring, with risk assessment
- 📊 **Complexity Analysis** - Human-friendly metrics: test paths, mental load, time to understand
- 🧪 **Test Associations** - Know which tests cover a file before you touch it
- 🚀 **Lexical Search** - Fast full-text (FTS5/BM25) keyword search over code, docstrings, and identifier-split symbol names
- 🔒 **100% Local & Private** - All analysis happens on your machine
- 📦 **No Model Download** - No embeddings, no ~100MB model — tiny install, instant offline indexing
- 🎯 **MCP Integration** - Works seamlessly with Cursor, Claude Code, and other MCP-compatible tools
- ⚡ **Fast** - Sub-millisecond file context; minutes to index large codebases
- 🆓 **Free Forever** - No API costs, no subscriptions, no usage limits (applies to the local MCP/search tooling — [Lien Review](#lien-review)'s agent pass uses your own LLM key and has its own token cost)
- 🏗️ **Framework-Aware & Monorepo** - Auto-detects 12+ ecosystems; supports 15+ languages

## Quick Start

### Claude Code (recommended) — one-time plugin install

```text
/plugin marketplace add getlien/lien
/plugin install lien
```

That's it. Lien's MCP tools and hooks are now available in every Claude Code session, in every repo — including a hook that enhances Claude Code's built-in Explore agent with Lien-tool guidance. First use in a new git repo triggers a one-time index automatically — no `lien init` per project.

### Other editors (Cursor, Windsurf, OpenCode, Kilo Code, Antigravity)

```bash
# 1. Install
npm install -g @liendev/lien

# 2. Wire it up for your editor
lien init

# 3. Restart your editor and start asking questions
```

`lien init` writes the right MCP config for your editor and (for Claude Code's legacy per-project flow, via `lien init --legacy`) copies an Explore agent into `.claude/agents/`. Lien auto-detects your project and indexes on first use.

**👉 [Full installation guide](https://lien.dev/guide/installation)**

## MCP Tools

Lien exposes **6 powerful tools** via Model Context Protocol:

| Tool | Description |
|------|-------------|
| `search_code` | Full-text (BM25) keyword code search |
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

## Lien Review

Lien Review is a self-hostable **GitHub Action** that reviews pull requests: complexity analysis, agent-driven bug review, and a PR summary — posted back as inline comments and workflow annotations. No server, no database, no recurring bill.

```yaml
# .github/workflows/lien-review.yml
name: Lien Review

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: getlien/lien-review@v1
        with:
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

That single `uses:` line is the whole integration — Lien self-clones the PR by SHA using the workflow's own token, so no `actions/checkout` step is needed.

| Feature | Description |
|---------|-------------|
| Complexity analysis | Flags new/worsened cyclomatic, cognitive, and Halstead complexity violations |
| Agent bug review | LLM-driven review for correctness bugs (OpenRouter or Anthropic) |
| PR summary | A concise summary of the change, posted as a step summary |
| Advisory by default | `fail-on: never` — the check never blocks a PR unless you opt in |

**👉 [Lien Review guide](https://lien.dev/guide/lien-review)** · [Action reference](./packages/action/README.md)

## Git Worktrees

A linked git worktree (`git worktree add`) automatically shares the main
checkout's index instead of building a full independent copy — a read-only
base plus a small per-worktree overlay for whatever's actually changed. No
setup required; set `LIEN_WORKTREE_STANDALONE=1` to opt out and get a fully
independent index for that worktree.

**👉 [How it works](https://lien.dev/how-it-works#git-worktree-support)**

## Documentation

- **[Installation](https://lien.dev/guide/installation)** - npm, npx, or local setup
- **[Getting Started](https://lien.dev/guide/getting-started)** - Step-by-step configuration for Cursor or Claude Code
- **[Configuration](https://lien.dev/guide/configuration)** - Customize indexing, thresholds, performance
- **[CLI Commands](https://lien.dev/guide/cli-commands)** - Full command reference
- **[MCP Tools](https://lien.dev/guide/mcp-tools)** - Complete API reference for all 6 tools
- **[Lien Review](https://lien.dev/guide/lien-review)** - GitHub Action PR review setup
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

# Lien

> **/ljɛ̃/**, French for "link"

**A local code-health CLI: what's risky to change, and what your change just made worse. 100% local, 100% private.**

Lien parses your working tree with Tree-sitter and answers four questions about a change — what is risky to touch, what crossed a complexity threshold, what deterministic signals fire on the diff, and where the hotspots are. There is no server, no database, and nothing to index: every command reads the files on disk when you run it. Point it at a repo and it works.

**[Full Documentation](https://lien.dev)** | **[Getting Started](https://lien.dev/guide/getting-started)** | **[How It Works](https://lien.dev/how-it-works)**

---

## Features

- **Risk ranking** - `lien health` ranks functions by complexity × fan-in ÷ test coverage
- **Pre-commit gate** - `lien delta` fails only on NEW complexity threshold crossings, never pre-existing ones
- **Deterministic diff signals** - `lien review` flags stale duplicated literals, removed exports, doc drift and more
- **Complexity analysis** - Human-friendly metrics: test paths, mental load, time to understand
- **Nothing to set up** - No index, no server, no config, no daemon. Install and run
- **100% Local & Private** - All analysis happens on your machine; no network calls
- **Fast** - Whole-repo parse in seconds; `lien delta` in ~50 ms
- **Free Forever** - No API costs, no subscriptions ([Lien Review](#lien-review)'s agent pass uses your own LLM key)
- **Ecosystem-Aware & Monorepo** - Auto-detects 12 ecosystem presets; supports 15+ languages

## Quick Start

```bash
# 1. Install
npm install -g @liendev/lien

# 2. Run it in any repo
lien health
```

That's the whole setup. No editor configuration, no indexing step, no wizard.

```bash
lien health              # what's risky to change here?
lien delta               # did my working tree cross a complexity threshold?
lien review --base main  # deterministic signals over my diff
lien complexity          # where are the hotspots?
```

**[Full installation guide](https://lien.dev/guide/installation)**

## The four commands

| Command | Answers |
|---------|---------|
| `lien health` | Which functions are risky to change? (complexity × fan-in ÷ test coverage) |
| `lien delta` | Did this change push a function over a threshold it was under before? |
| `lien review` | What deterministic signals fire on this diff? |
| `lien complexity` | Where is the tech debt? |

`lien delta` is the one built to sit in a pre-commit hook or CI: it exits non-zero
**only** for a function that crossed a threshold it was under at the base commit.
Touching or improving a pre-existing violation never fails it.

> **Previous versions shipped an MCP server, a persisted SQLite index and FTS5
> lexical search.** All three have been removed, along with `lien serve`,
> `lien index`, and the `search_code` / `get_files_context` / `get_dependents` /
> `list_functions` / `find_similar` / `get_complexity` tools. An editor
> configured against `lien serve` will fail to start it. The structural
> questions Lien still answers, it answers by parsing on demand.

### Complexity Metrics

Lien tracks code complexity with human-friendly outputs:

- **Test paths** - Cyclomatic complexity as "needs ~X tests for full coverage"
- **Mental load** - Cognitive complexity with nesting penalty
- **Time to understand** - Halstead effort as readable duration (~2h 30m)
- **Estimated bugs** - Halstead prediction (Effort^(2/3) / 3000)

## Lien Review

Lien Review is a self-hostable **GitHub Action** that reviews pull requests: complexity analysis, agent-driven bug review, and a PR summary, posted back as inline comments and workflow annotations. It runs without a server, a database, or a recurring bill.

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

That single `uses:` line is the whole integration: Lien self-clones the PR by SHA using the workflow's own token, so no `actions/checkout` step is needed.

| Feature | Description |
|---------|-------------|
| Complexity analysis | Flags new/worsened cyclomatic, cognitive, and Halstead complexity violations |
| Agent bug review | LLM-driven review for correctness bugs (OpenRouter or Anthropic) |
| PR summary | A concise summary of the change, posted as a step summary |
| Advisory by default | `fail-on: never`; the check never blocks a PR unless you opt in |

**[Lien Review guide](https://lien.dev/guide/lien-review)** · [Action reference](./packages/action/README.md)

## Documentation

- **[Installation](https://lien.dev/guide/installation)** - npm, npx, or local setup
- **[Getting Started](https://lien.dev/guide/getting-started)** - Your first run
- **[Configuration](https://lien.dev/guide/configuration)** - Complexity thresholds
- **[CLI Commands](https://lien.dev/guide/cli-commands)** - Full command reference
- **[Lien Review](https://lien.dev/guide/lien-review)** - GitHub Action PR review setup
- **[How It Works](https://lien.dev/how-it-works)** - Architecture overview

## Supported Languages

TypeScript • JavaScript • Vue • Python • PHP • Liquid • Go • Rust • Java • C/C++ • Ruby • Swift • Kotlin • C# • Scala • Markdown • YAML

**Ecosystem Presets:** 12 ecosystem presets including Node.js, Python, PHP, Laravel, Ruby, Rails, Rust, JVM, Swift, .NET, Django, and Astro (auto-detected)

## Contributing

Contributions welcome! See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for guidelines.

## Support

- **[Issues](https://github.com/getlien/lien/issues)** - Report bugs or request features
- **[Discussions](https://github.com/getlien/lien/discussions)** - Ask questions and share ideas

## License

AGPL-3.0 © [Alf Henderson](https://github.com/alfhen)

Lien is free forever for local use. The AGPL-3.0 license requires that anyone who distributes a modified version release its source under the same terms. For licensing questions, contact alf@lien.dev.

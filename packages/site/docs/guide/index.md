# Introduction

Lien _(French for "link" or "connection")_ is a local-first **code-intelligence CLI** for AI coding agents like Cursor and Claude Code.

## What is Lien?

Lien parses your working tree with Tree-sitter, on the spot, every time you run it, and gives you (or your AI assistant) the structural context needed to work safely: complexity hotspots, a risk-ranked list of what's dangerous to change, and deterministic signals over your diff. Unlike cloud-based solutions, everything runs on your machine, and there's nothing persisted between runs. See [How It Works](/how-it-works) for the parse-to-answer pipeline.

**Setup takes about 30 seconds:** install globally, then run a command in your project. There's no config file, no editor wiring, and no model to download — each command parses fresh and prints a report.

## Key Benefits

### Zero Configuration
Lien auto-detects your project structure and "just works." No config files, no ecosystem selection, no pattern configuration.

### Privacy First
Your code stays local. Lien processes everything on your machine, with no external API calls, no data collection, and no telemetry.

### Structural Intelligence
The questions worth answering before editing code ("how complex is this?", "what's risky to touch?", "does this diff introduce a stale literal or a removed export?") are answered from a real Tree-sitter parse and per-symbol metrics, not guessed.

### No Index, No Server
There's nothing to keep in sync. Every command parses the current working tree and reports on exactly what's there right now.

### Ecosystem-Aware Scanning
Lien detects your project type via 12 ecosystem presets (Node.js, Python, PHP, Laravel, Django, Ruby, Rails, Rust, JVM, Swift, .NET, Astro) and applies the right file exclusions automatically. See [How It Works](/how-it-works#supported-languages) for the full language list.

## Use Cases

### Understanding Tech Debt
Find the functions most worth your attention without reading every file:

```bash
lien health
```

Ranks functions by complexity × fan-in ÷ test coverage — the ones that are both complicated and risky to break.

### Checking Complexity
Flag functions over a complexity threshold, in CI or locally:

```bash
lien complexity --fail-on error
```

### Reviewing a Diff Before You Open a PR
Run deterministic signals over your working-tree changes:

```bash
lien review
```

Surfaces candidates like stale duplicate literals, removed exports, and doc drift — for you to judge, not a build-breaking check.

### Gating a Commit
Block a commit only when it makes something new complex enough to cross a threshold it wasn't over before:

```bash
lien delta
```

## Next Steps

- Read [How It Works](/how-it-works) for the parse-on-demand pipeline
- Follow the [installation guide](/guide/installation) to install Lien in seconds
- See [CLI Commands](/guide/cli-commands) for the full command reference

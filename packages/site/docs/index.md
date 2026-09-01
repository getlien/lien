---
layout: home

hero:
  name: "Lien"
  text: "Local-First Code Intelligence for AI"
  tagline: "Complexity, risky-to-change ranking, and deterministic PR-review signals for AI coding agents. Parses your working tree on demand — no index, no server, 100% local."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/getlien/lien

features:
  - icon: 📊
    title: Complexity Analysis
    details: Identify tech-debt hotspots with cyclomatic, cognitive, and Halstead metrics. Prioritize refactoring with `lien complexity`.

  - icon: 🩺
    title: Risk-Ranked Health
    details: "`lien health` ranks the functions that are riskiest to change: complexity × fan-in ÷ test coverage."

  - icon: 🔍
    title: Deterministic Review Signals
    details: "`lien review` runs signals over your working-tree changes: stale duplicate literals, removed exports, doc drift, and more."

  - icon: 🚦
    title: Pre-Commit Complexity Gate
    details: "`lien delta` flags NEW complexity threshold crossings in your working tree before you commit — never fails on pre-existing debt."

  - icon: 🔒
    title: 100% Local & Private
    details: Code never leaves your machine — Lien parses the working tree on demand with no index, no server, and no telemetry. (Fetching the published package itself, via npm or npx, is the one network step.)
---

## Quick Start

**1. Install Lien:**

```bash
npm install -g @liendev/lien
```

**2. Run it in your project:**

```bash
lien health
```

That's it — no setup wizard, no config file, no server to start. Lien parses your working tree on the spot and prints a report.

## How It Works

Lien parses your code with Tree-sitter on demand, every run, and answers structural questions ("how complex is this?", "what's risky to touch?", "did this change introduce a stale literal?") straight from that parse. There is no persisted index and nothing runs in the background. See [How It Works](/how-it-works) for the full pipeline.

## Use Cases

Tech-debt hotspots, ranking what's risky to change before a refactor, deterministic signals over a diff before you open a PR, and a pre-commit gate against new complexity. See [Use Cases](/guide/#use-cases) in the guide for examples.

## Privacy First

Your code stays on your machine every time you run Lien: no external API calls, no telemetry. The one network step is fetching the published npm package itself (via `npm install`, or `npx` if you skip the global install) on first setup. See [How It Works](/how-it-works#privacy-first) for details.

## Free & Open Source

Lien is licensed under AGPL-3.0 and free forever for local use. Questions about licensing? Contact alf@lien.dev

---

<div style="text-align: center; margin-top: 2rem; color: var(--vp-c-text-2);">
  <p><em>Lien</em> /ljɛ̃/: French for "link"</p>
</div>

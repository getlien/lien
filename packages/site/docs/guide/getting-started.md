# Quick Start

This guide gets you running Lien's four commands in under a minute.

## Step 1: Install

```bash
npm install -g @liendev/lien
```

See [Installation](/guide/installation) for prerequisites and the `npx` alternative if you'd rather not install globally.

## Step 2: Run It

There's no setup wizard and nothing to configure. `cd` into a project and run any of the four commands — each one parses your working tree on the spot:

```bash
# Rank the functions riskiest to change
lien health

# Analyze complexity across the codebase
lien complexity

# Run deterministic signals over your uncommitted changes
lien review

# Flag NEW complexity threshold crossings before you commit
lien delta
```

::: info No index, no wait
There's no first-run indexing step and no model to download. Every command parses fresh, so the numbers you see always match what's on disk right now.
:::

## Step 3: Try It on a Real Change

Make an edit, then run:

```bash
lien review
```

If your working tree has no changes against `HEAD`, `review` says so explicitly rather than printing an empty "all clear" report — pass `--base <ref>` to compare against something else (e.g. `origin/main`).

Before committing, run:

```bash
lien delta
```

It only fails when your changes push a function's complexity **over a threshold it was under at HEAD** — pre-existing complexity debt never fails the check.

## Monorepo Support

Lien automatically detects and scans multiple ecosystems:

```bash
# Example monorepo structure
my-app/
  ├── src/                  # Node.js/TypeScript (auto-detected)
  └── backend/              # Laravel (auto-detected)
```

Lien scans your project structure and applies the right exclusions for each detected ecosystem, no configuration needed.

## Troubleshooting

### `lien delta` or `lien review` says "not a git repository"

`delta` and `review` both diff your working tree against a git ref, so they need to run inside a git repository. `complexity` and `health` don't — they just scan the files on disk.

### Slow scans on very large codebases

- Lien automatically excludes `node_modules`, `dist`, and other build artifacts via ecosystem presets
- A scan is CPU-bound Tree-sitter parsing with no network step, so it's roughly linear in file count — see [Performance](/how-it-works#performance) for measured numbers

## Next Steps

- Learn about [per-project configuration](/guide/configuration) (complexity thresholds only)
- Read about [CLI Commands](/guide/cli-commands) for the full flag reference

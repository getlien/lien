# CLI Commands

Lien is a local CLI with four commands. Every one of them parses your working tree on the spot — there's no index to build first and no server to start.

```bash
lien complexity   # Analyze code complexity
lien health       # Rank the functions that are risky to change
lien review       # Run deterministic signals over your changes
lien delta        # Flag NEW complexity threshold crossings before commit
```

## lien complexity

Analyze code complexity across your codebase. Identifies functions exceeding fixed complexity thresholds for tech-debt analysis and refactoring prioritization.

```bash
lien complexity [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--files <paths...>` | Specific files to analyze |
| `--format <type>` | Output format: `text` (default), `json`, `sarif` |
| `--fail-on <severity>` | Exit 1 if violations found: `error`, `warning` |

### Behavior

This is a gate-shaped command: with no index to be stale against, the only failure mode left is a parse that genuinely finds nothing to analyze. If the scan fails outright (a native-binding load error, or zero files parsed), `lien complexity` hard-errors rather than printing a false "0 violations, clean!"

Thresholds are fixed (not read from `.lien.config.json`) — see [Configuration](/guide/configuration#complexity-analysis) for the four metrics and their default values. To customize thresholds, use `lien delta`, which does read `.lien.config.json`.

### Output Formats

**Text (default)** — real output against this repo:

```
🔍 Complexity Analysis

Summary:
  Files analyzed: 396
  Violations: 15 (3 errors, 12 warnings)
  Average complexity: 3.2
  Max complexity: 14

❌ Errors:

  packages/parser/src/signals/rename-sweep-signals.ts:255 - scanDiff()
    🧠 Mental load: 30 (threshold: 30)
    ⬆️  0% over threshold
    📦  Imported by 30 files
    - Dependent avg complexity: 2.4, max: 7
    ⚠️  Complexity risk: HIGH
```

**JSON** — machine-readable output for CI pipelines:

```bash
lien complexity --files src/api/handler.ts --format json
```

```json
{
  "summary": {
    "filesAnalyzed": 1,
    "totalViolations": 0,
    "bySeverity": { "error": 0, "warning": 0 },
    "avgComplexity": 3.5,
    "maxComplexity": 6
  },
  "files": {}
}
```

**SARIF** — for GitHub Code Scanning and IDE integrations:

```bash
lien complexity --format sarif > results.sarif
```

### Examples

```bash
# Basic analysis
lien complexity

# Fail CI on error-severity violations
lien complexity --fail-on error

# Analyze only changed files
git diff --name-only HEAD~1 | xargs lien complexity --files

# JSON baseline for external tracking
lien complexity --format json > baseline.json
```

## lien health

Rank the functions that are risky to change: complexity × fan-in ÷ test coverage. Advisory — this command never fails on findings, only on genuine operational errors (a bad flag, a scan that couldn't run at all).

```bash
lien health [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--format <type>` | Output format: `text` (default), `json` |
| `--top <n>` | How many functions to show (default: `5`) |
| `--path <prefix>` | Only show functions under this path prefix |
| `--include-tests` | Rank test files too (excluded by default) |

### Output

Real output against this repo (`lien health --top 3`):

```
lien health

  396 files · 5908 chunks · 0.9s · no index

  ⚠ 3 functions are risky to change

  1  packages/parser/src/signals/rename-sweep-signals.ts:255  scanDiff
     mental load 30 · imported by 3 · 1 test
     Complex, but contained — little depends on it.
     → simplify when you are next in here

  2  packages/parser/src/signals/untrusted-input-signals.ts:112  extractUntrustedInputSites
     mental load 29 · imported by 2 · 1 test
     Complex, but contained — little depends on it.
     → simplify when you are next in here

  3  packages/parser/src/signals/rename-sweep-signals.ts:576  renderRenameSweepSignals
     mental load 19 · imported by 3 · 1 test
     Complex, but contained — little depends on it.
     → simplify when you are next in here

  12 other threshold violations — `lien complexity` to see them

  Coverage
    fan-in resolved   typescript, javascript, rust, python, csharp, java
    no fan-in found   markdown (60), swift (6), go (6), yaml (6), php (5), kotlin (5)
                      ranked on complexity alone — not judged safe
```

Fan-in ("imported by N") is resolved per-language; languages without a fan-in resolver are still ranked, on complexity alone, and called out explicitly under **Coverage** rather than silently mixed in as if they'd been judged equally safe.

### Examples

```bash
# Top 5 riskiest functions (default)
lien health

# Top 20, JSON for scripting
lien health --top 20 --format json

# Only functions under a specific path
lien health --path packages/cli/src
```

## lien review

Run the deterministic signals over your working-tree changes: stale duplicate literals, unswept variants, removed exports, doc drift, and more. Advisory — never fails, and has no `--fail-on`. These are candidates for you to judge, not findings that block anything.

```bash
lien review [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--base <ref>` | Compare the working tree against this ref instead of `HEAD` |
| `--format <type>` | Output format: `text` (default), `json` |
| `--no-repo-scan` | Skip the whole-repo scan the cross-file signals need (faster, blinder) |
| `--include-tests` | Review changed test files too (excluded by default) |
| `--all-signals` | Run all 14 signals, not just the measured-useful default set (noisy) |

### Behavior

`review` needs a git repository — it diffs your working tree against `--base` (or `HEAD`) — and fails loudly with a non-zero exit if it can't (an unresolvable ref, or not a git repo at all), rather than printing an empty "all clear."

By default it runs a smaller set of signals than the full 14: measurement against this repo found the other 13 (`stale-literal`, `removed-export`, `variant-sweep`, `unread-field`, `catch-discrimination`, `sibling-surface`, `rename-sweep`, `untrusted-input`, `test-coverage`, `docs-drift`, `doc-claims`, `guidance-surface`, `simplicity`) produced 0 useful candidates read directly — they were originally built as inputs for an LLM to adjudicate rather than for direct human reading. `--all-signals` runs them anyway.

### Output

With no changes against `HEAD`:

```
No changes against HEAD.

Nothing was analyzed — this is not a clean review, it is an empty one.
Make a change, or pass --base <ref> to compare against something else.
```

With changes but no candidates found:

```
lien review — 1 changed file(s) vs HEAD

No candidates from any signal.

Not examined:
  13 further signal(s) did not run: stale-literal, removed-export, variant-sweep, ...
    They were built as inputs for an LLM to adjudicate, and measured 0 useful candidates in 106 on this repo when read directly. --all-signals runs them anyway.

0 candidate(s) across 0 signal(s) · 53 ms
These are candidates for you to judge, not findings. This command never fails a build.
```

### Examples

```bash
# Review your uncommitted changes against HEAD
lien review

# Review a whole branch against main, in CI
lien review --base origin/main

# Fast pass, skip the whole-repo cross-file scan
lien review --no-repo-scan
```

## lien delta

Flag new complexity threshold crossings in the working tree (vs `HEAD`) before they're committed. This is `CLAUDE.md`'s sixth pre-commit gate: a fast, deterministic check that fails only on regressions introduced by the current working tree, never on pre-existing complexity debt.

```bash
lien delta [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--format <type>` | Output format: `text` (default), `json` |
| `--threshold <n>` | Override cyclomatic and cognitive thresholds (default: from `.lien.config.json`, see [Configuration](/guide/configuration)) |
| `--soft` | Advisory mode: always exit 0, report still prints |
| `--file <path>` | Analyze only this file vs HEAD (fast path for a single-file check) |
| `--base <ref>` | Compare the working tree against this ref instead of HEAD (e.g. `origin/main` in CI) |

### Behavior

Exits 1 only when a changed function crosses over a threshold it was under at the comparison point, or is new and already over threshold. Improving a function, or merely touching a pre-existing violation, never fails. `--soft` always exits 0, so it advises without blocking. Requires a git repository — exits 2 with an explicit error otherwise, the same as an unreadable `.lien.config.json` or an unresolvable `--base` ref.

### Output

A clean run:

```
lien delta — no complexity-affecting changes vs HEAD (35 ms)
```

### Examples

```bash
# Check the working tree against HEAD
lien delta

# CI: check the whole PR against its base branch
lien delta --base origin/main

# Single-file fast path, e.g. from an editor hook
lien delta --file src/api/handler.ts
```

See [docs/architecture/lien-delta.md](https://github.com/getlien/lien/blob/main/docs/architecture/lien-delta.md) for the full design.

## lien --version

```bash
lien --version
# Output: 0.x.x
```

## lien --help

```bash
lien --help
```

```
Quick start: run 'lien health' in your project directory

Usage: lien [options] [command]

Options:
  -V, --version         output the version number
  -h, --help            display help for command

Commands:
  complexity [options]  Analyze code complexity
  health [options]      Rank the functions that are risky to change: complexity
                        × fan-in ÷ test coverage (advisory — never fails on
                        findings)
  review [options]      Run the deterministic signals over your changes: stale
                        duplicate literals, unswept variants, removed exports,
                        doc drift and more (advisory — never fails, no
                        --fail-on)
  delta [options]       Flag NEW complexity threshold crossings in the working
                        tree (vs HEAD) before commit
```

## Common Workflows

### First look at a codebase

```bash
cd /path/to/project
lien health
```

### Before opening a PR

```bash
lien review
```

### Before committing

```bash
lien delta
```

### CI gate on a PR branch

```bash
lien delta --base origin/main
lien complexity --fail-on error
```

### Upgrading Lien

```bash
npm update -g @liendev/lien
```

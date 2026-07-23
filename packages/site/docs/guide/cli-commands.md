# CLI Commands

Lien provides a simple command-line interface for managing your codebase index.

## lien init

Initialize Lien in the current directory. This is optional: Lien works with zero configuration.

```bash
lien init [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-e, --editor <editor>` | Editor to configure MCP for (`cursor`, `claude-code`, `windsurf`, `opencode`, `kilo-code`, `antigravity`) |
| `-p, --path <path>` | Path to initialize (defaults to current directory) |
| `--legacy` | Use legacy per-project setup for Claude Code instead of recommending the plugin |

### Behavior

1. Prompts you to select your editor (or use `--editor` flag)
2. Writes the correct MCP config file for your editor
3. Auto-detects ecosystem presets (Node.js, Laravel, Python, Rust, etc.)

### Examples

```bash
# Interactive editor selection
lien init

# Specify editor directly
lien init --editor cursor
lien init --editor claude-code
lien init --editor windsurf

# Initialize a specific directory
lien init --path /path/to/project --editor cursor
```

::: tip Zero Config
Unlike previous versions, `lien init` no longer creates `.lien.config.json`. Lien auto-detects your project structure and uses sensible defaults. For advanced configuration, see [Configuration](/guide/configuration).
:::

## lien index

Index your codebase for lexical search and structural analysis. **Automatically uses incremental indexing** to only process changed files.

```bash
lien index [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-f, --force` | Clear existing index and rebuild from scratch |
| `-v, --verbose` | Show detailed logging during indexing |

### Behavior

**Without `--force` (default - incremental mode):**

1. **Checks for changes** (if manifest exists from previous index)
   - mtime-based detection (simple and reliable)
2. **Only indexes changed files** (about 17x faster than a full rescan)
3. Chunks code into semantic units (Tree-sitter AST)
4. Computes complexity metrics and dependency metadata
5. Stores in the SQLite index at `~/.lien/indices/[project-hash]/`
6. Updates index manifest for future incremental runs

**With `--force` (clean rebuild):**

1. **Deletes existing index and manifest** (clean slate)
2. Scans entire codebase
3. Indexes all files from scratch
4. Use when: config changed, stale results, or corrupted index

### Performance

**Initial index** (full):
- **Small** (1k files): ~3 seconds
- **Medium** (10k files): ~25-30 seconds
- **Large** (50k files): ~2-3 minutes

These are linear extrapolations from measured reindex times; see [How It Works](/how-it-works#performance) for the underlying benchmarks. There's no embedding step, so indexing is CPU-bound Tree-sitter parsing plus a SQLite write.

**Incremental reindex** (typical):
- **Single file edit**: < 2 seconds
- **Small changes (5-10 files)**: < 5 seconds
- **Feature branch (50 files)**: ~15-20 seconds
- **Large refactor (500 files)**: ~1-2 minutes

### First Run

On first run, Lien indexes your codebase. There's no model to download and no network required: indexing starts immediately.

### Output

```
🔍 Scanning codebase...
✓ Found 1,234 files across 2 frameworks

⚡ Processing files...
████████████████████ 100% | 1,234/1,234 files

💾 Writing index...
████████████████████ 100% | 5,678/5,678 chunks

✅ Indexing complete!
   • 1,234 files indexed
   • 5,678 chunks created
   • 234 test associations detected
   • Stored in ~/.lien/indices/abc123
```

## lien serve

Start the MCP server for AI assistant integration. **Automatically watches for file changes** and reindexes in the background.

```bash
lien serve [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-p, --port <port>` | Port number (reserved for future use; the MCP server runs over stdio) |
| `--no-watch` | Disable file watching for this session |
| `-r, --root <path>` | Root directory to serve (defaults to current directory) |

### Behavior

1. Auto-detects project structure via ecosystem presets
2. Checks if index exists (auto-indexes if missing)
3. Starts MCP server on stdio transport
4. Listens for tool requests from Cursor
5. **Watches for file changes** and automatically reindexes (< 2 seconds per file!)
6. Detects git commits and reindexes changed files in background

### Auto-Indexing

If no index exists, `lien serve` will automatically run indexing on first start. This usually takes seconds to a couple of minutes depending on project size (see the Performance table above).

### File Watching

File watching is **enabled by default** for instant updates:
- Detects when you save a file in your editor
- Automatically reindexes in < 2 seconds, with no manual `lien index` run required

To disable for a session:
```bash
lien serve --no-watch
```

There's no config file setting for this: `--no-watch` (or omitting it) is the only control, decided fresh each time you run `lien serve`. If you're launching via an editor's MCP config (see below), add `--no-watch` to the `args` array there to make it permanent for that integration.

::: tip
Usually run via Cursor's MCP configuration, not manually.
:::

### MCP Configuration

The easiest way to configure MCP is with `lien init`:

```bash
lien init --editor cursor       # → .cursor/mcp.json
lien init --editor claude-code  # → .mcp.json
lien init --editor windsurf     # → ~/.codeium/windsurf/mcp_config.json
lien init --editor opencode     # → opencode.json
lien init --editor kilo-code    # → .kilocode/mcp.json
lien init --editor antigravity  # → prints config snippet
```

Or manually add to your editor's MCP config:

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

::: tip Per-Project Configuration
Editors with per-project config (Cursor, Claude Code, OpenCode, Kilo Code) automatically detect the project root. No need to specify `--root`!
:::

::: warning Global MCP Config (Windsurf)
Windsurf uses a global config file, so `lien init` automatically includes `--root` with the absolute project path. If configuring manually, you must add it:

```json
{
  "mcpServers": {
    "lien": {
      "command": "lien",
      "args": ["serve", "--root", "/absolute/path/to/project"]
    }
  }
}
```
:::

## lien status

Show indexing status and statistics.

```bash
lien status [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-v, --verbose` | Also show indexing settings (concurrency, chunk size/overlap defaults) |
| `--format <type>` | Output format: `text` (default) or `json` |

### Output

```
Status

Configuration: ✓ Using defaults (no per-project config needed)
Index location: ~/.lien/indices/abc123
Index status: ✓ Exists
Index files: 1,234
Last modified: 7/2/2026, 9:41:03 AM
Last reindex: 7/2/2026, 9:40:12 AM

Features:
Git detection: ✓ Enabled
  Poll interval: 2s
  Current branch: main
  Current commit: a1b2c3d4
File watching: ✓ Enabled (default)
  Batch window: 500ms (collects rapid changes, force-flush after 5s)
  Disable with: lien serve --no-watch
```

With `--verbose`, an additional "Indexing Settings (defaults)" block prints the concurrency and chunk size/overlap defaults. With `--format json`, the same data is emitted as a single JSON object (`version`, `indexPath`, `indexStatus`, `indexFiles`, `git`, `features`, `settings`) for scripting.

## lien config

Manage global configuration settings.

```bash
lien config <command> [key] [value]
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `set <key> <value>` | Set a configuration value |
| `get <key>` | Read a configuration value |
| `list` | Show all configuration values |

### Allowed Keys

| Key | Values | Description |
|-----|--------|-------------|
| `backend` | `sqlite` | Storage backend (SQLite structural store + FTS5 search) |

### Examples

```bash
# Check current backend
lien config get backend

# Show all settings
lien config list
```

Config is stored in `~/.lien/config.json`. The `LIEN_BACKEND` environment variable takes precedence over the config file.

## lien complexity

Analyze code complexity across your codebase. Identifies functions exceeding complexity thresholds for tech debt analysis and refactoring prioritization.

```bash
lien complexity [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--files <paths...>` | Specific files to analyze |
| `--format <type>` | Output format: `text` (default), `json`, `sarif` |
| `--fail-on <severity>` | Exit with code 1 if violations found: `error`, `warning` |

### Output Formats

**Text (default)** - Human-readable output for terminal:

```
📊 Complexity Analysis

Found 3 violations in 2 files

⚠️  src/utils/parser.ts:45 - parseComplexData (complexity: 18)
   Severity: error | Threshold: 10

⚠️  src/api/handler.ts:23 - handleRequest (complexity: 14)
   Severity: error | Threshold: 10

⚠️  src/api/handler.ts:89 - processResponse (complexity: 11)
   Severity: warning | Threshold: 10

Summary:
  Files analyzed: 156
  Violations: 3 (2 error, 1 warning)
  Max complexity: 18
  Avg complexity: 4.2
```

**JSON** - Machine-readable output for CI pipelines:

```bash
lien complexity --format json
```

```json
{
  "summary": {
    "filesAnalyzed": 156,
    "avgComplexity": 4.2,
    "maxComplexity": 18,
    "violationCount": 3,
    "bySeverity": { "error": 2, "warning": 1 }
  },
  "files": {
    "src/utils/parser.ts": {
      "violations": [
        {
          "symbolName": "parseComplexData",
          "startLine": 45,
          "complexity": 18,
          "severity": "error"
        }
      ]
    }
  }
}
```

**SARIF** - For GitHub Code Scanning and IDE integrations:

```bash
lien complexity --format sarif > results.sarif
```

### Use Cases

**CI Pipeline - Fail on new violations:**

```bash
lien complexity --fail-on error
```

**Analyze specific files (e.g., PR changed files):**

```bash
lien complexity --files src/api/handler.ts src/utils/parser.ts
```

**Generate baseline for delta tracking:**

```bash
lien complexity --format json > baseline.json
```

### Complexity Metrics

Lien tracks four metrics: cyclomatic complexity (test paths), cognitive complexity (mental load,
based on [SonarSource's specification](https://www.sonarsource.com/docs/CognitiveComplexity.pdf)),
Halstead effort (`Effort = Difficulty × Volume`, time to understand), and Halstead bugs
(`Bugs = Effort^(2/3) / 3000`, estimated bug count). See
[Configuration](/guide/configuration#complexity-analysis) for what each one measures and how to
set thresholds.

| Complexity | Severity | Interpretation |
|------------|----------|----------------|
| 1-14 | OK | Simple, easy to understand |
| 15-29 | Warning | Consider refactoring |
| 30+ | Error | Should refactor |

### Examples

```bash
# Basic analysis
lien complexity

# Strict mode for code review
lien complexity --fail-on warning

# JSON output for CI
lien complexity --format json --fail-on error

# Analyze only changed files
git diff --name-only HEAD~1 | xargs lien complexity --files
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
| `--threshold <n>` | Override cyclomatic and cognitive thresholds (default: from config) |
| `--soft` | Advisory mode: always exit 0, report still prints |
| `--file <path>` | Analyze only this file vs HEAD (the fast path edit hooks use) |
| `--base <ref>` | Compare the working tree against this ref instead of HEAD (e.g. `origin/main` in CI) |

### Behavior

Exits 1 only when a changed function crosses over a threshold it was under at the comparison point, or is new and already over threshold. Improving a function, or merely touching a pre-existing violation, never fails. `--soft` always exits 0, so it advises without blocking.

### Examples

```bash
# Check the working tree against HEAD
lien delta

# CI: check the whole PR against its base branch
lien delta --base origin/main
```

See [docs/architecture/lien-delta.md](https://github.com/getlien/lien/blob/main/docs/architecture/lien-delta.md) for the full design.

## lien stats

Local, historical metrics for the `lien delta` nudge loop: how many runs happened, how many had new crossings, how many distinct functions were flagged, and how many were later seen clean, over 7- and 30-day windows. Reads only the local JSONL event log `lien delta` appends to; no network call.

```bash
lien stats [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--format <type>` | Output format: `text` (default), `json` |

### Example

```bash
lien stats
```

"Resolved after flag" means a flagged function was later seen clean; it's a presence and absence signal, not proof the warning caused the fix. Disable event recording with `LIEN_DELTA_EVENTS=off`.

## lien gc

Garbage-collect stale or orphaned index directories under `~/.lien/indices`. By default, removes indices whose source project no longer exists on disk and sweeps legacy `code_chunks.lance` directories left over from the pre-lexical-search embeddings backend. Never touches the current project's index or one a live process holds open.

```bash
lien gc [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--dry-run` | List candidates with size and reason; delete nothing |
| `--stale [days]` | Also remove indices not accessed in N days (default 60) |
| `--format <type>` | Output format: `text` (default), `json` |
| `-v, --verbose` | Show detailed error output |

### Examples

```bash
# Preview what would be removed
lien gc --dry-run

# Also reclaim indices untouched for 90+ days
lien gc --stale 90
```

## lien path

Print Lien storage paths and supported extensions. This is a plumbing command intended for **hook scripts** (e.g. a Claude Code `PostToolUse` hook) rather than everyday interactive use.

```bash
lien path [options]
```

### Options

Exactly one of the following is required: they are mutually exclusive.

| Option | Description |
|--------|-------------|
| `--store` | Print the storage root for the current repo (e.g. `~/.lien/indices/abc123`) |
| `--extensions` | Print the indexed-file extensions, one per line |
| `--root` | Print the resolved project root (walks up the directory tree looking for `.git`) |

### Examples

```bash
lien path --root
# /Users/you/projects/my-app

lien path --store
# /Users/you/.lien/indices/a1b2c3d4

lien path --extensions
# .ts
# .tsx
# .js
# ...
```

## lien annotate

Print a short impact summary for a single file: dependent count and blast-radius risk, test coverage, and complexity warnings. This is a plumbing command intended for **hook scripts** (for example, a `PostToolUse` hook that annotates a just-edited file) rather than everyday interactive use. It never throws: on any error (missing index, unresolvable path) it exits 0 with empty output, so it never breaks a hook pipeline. Output is also empty when the impact is trivial (0-1 dependents, no complexity warnings, existing test coverage).

```bash
lien annotate <file>
```

### Example

```bash
lien annotate packages/cli/src/cli/status.ts
# Lien impact for packages/cli/src/cli/status.ts:
#   • 3 files import this — packages/cli/src/cli/index.ts, ...; risk: low.
#   • Test coverage: packages/cli/src/cli/status.test.ts.
```

## lien --version

Show installed version.

```bash
lien --version
# Output: 0.x.x
```

## lien --help

Show help and available commands.

```bash
lien --help
```

```
Quick start: run 'lien serve' in your project directory

Usage: lien [options] [command]

Local lexical code search and dependency analysis for AI assistants via MCP

Options:
  -V, --version              output the version number
  -h, --help                 display help for command

Commands:
  init [options]             Initialize Lien in the current directory
  index [options]            Index the codebase for lexical (FTS5) search and
                             dependency analysis
  serve [options]            Start the MCP server (works with Cursor, Claude
                             Code, Windsurf, and any MCP client)
  status [options]           Show indexing status and statistics
  complexity [options]       Analyze code complexity
  delta [options]            Flag NEW complexity threshold crossings in the
                             working tree (vs HEAD) before commit
  stats [options]            Local nudge-loop metrics: lien delta runs,
                             crossings, and functions resolved after being
                             flagged
  config                     Manage global configuration (~/.lien/config.json —
                             currently just the storage backend). Per-project
                             config (./.lien.config.json) only supports
                             complexity.thresholds and is not managed by this
                             command — edit the file directly.
  path [options]             Print Lien storage paths and supported extensions
                             (for hook scripts)
  annotate [options] <file>  Print a short impact summary for a single file
                             (for hook annotation)
  gc [options]               Garbage-collect stale/orphaned index directories
                             under ~/.lien/indices
```

## Environment Variables

Lien respects the following environment variables:

### `LIEN_HOME`

Override default index location:

```bash
export LIEN_HOME=/custom/path
lien index  # Stores in /custom/path/indices/
```

Default: `~/.lien`

### `NODE_ENV`

Set to `development` for verbose logging:

```bash
NODE_ENV=development lien index
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error |
| 3 | Index error |
| 4 | Network error |

## Common Workflows

### Initial Setup

```bash
cd /path/to/project
lien init
lien index
```

### Force Rebuild

```bash
# After major changes or stale results
lien index --force
```

### Checking Status

```bash
lien status
```

### Upgrading Lien

```bash
npm update -g @liendev/lien
# Restart Cursor to load new version
```



# CLI Commands

Lien provides a simple command-line interface for managing your codebase index.

## lien init

Initialize Lien in the current directory.

```bash
lien init [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--upgrade` | Upgrade existing config to latest version |

### Behavior

1. Detects frameworks in your project (Node.js, Laravel, Shopify, etc.)
2. Creates `.lien.config.json` with framework-specific settings
3. Offers to install Cursor rules to `.cursor/rules/lien.mdc`
4. Prompts for customization (optional)

### Examples

```bash
# Initialize new project
lien init

# Upgrade existing config
lien init --upgrade
```

### Interactive Prompts

During initialization:

1. **Framework Detection**: Shows detected frameworks and asks which to enable
2. **Customization**: Option to customize settings (most users can skip)
3. **Cursor Rules**: Offers to install recommended rules for Cursor integration

::: tip
If `.cursor/rules` exists as a file, Lien will offer to convert it to a directory structure, preserving your existing rules.
:::

## lien index

Index your codebase for semantic search. **Automatically uses incremental indexing** to only process changed files.

```bash
lien index [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--force` | Clear existing index and rebuild from scratch |
| `--verbose` | Show detailed logging during indexing |

### Behavior

**Without `--force` (default - incremental mode):**

1. **Checks for changes** (if manifest exists from previous index)
   - mtime-based detection (simple and reliable)
2. **Only indexes changed files** (17x faster!)
3. Chunks code into semantic units
4. Generates embeddings using local ML model
5. Stores in `~/.lien/indices/[project-hash]/`
6. Updates index manifest for future incremental runs

**With `--force` (clean rebuild):**

1. **Deletes existing index and manifest** (clean slate)
2. Scans entire codebase
3. Indexes all files from scratch
4. Use when: config changed, stale results, or corrupted index

### Performance

**Initial index** (full):
- **Small** (1k files): ~5 minutes
- **Medium** (10k files): ~15-20 minutes
- **Large** (50k files): ~30-60 minutes

**Incremental reindex** (typical):
- **Single file edit**: < 2 seconds ⚡
- **Small changes (5-10 files)**: < 5 seconds ⚡
- **Feature branch (50 files)**: ~15-20 seconds
- **Large refactor (500 files)**: ~1-2 minutes

### First Run

On first run, Lien downloads the embedding model (~100MB). This requires an internet connection and happens only once.

### Output

```
🔍 Scanning codebase...
✓ Found 1,234 files across 2 frameworks

⚡ Processing files...
████████████████████ 100% | 1,234/1,234 files

🧠 Generating embeddings...
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
| `--no-watch` | Disable file watching for this session |
| `--root <path>` | Root directory to serve (defaults to current directory) |

### Behavior

1. Loads configuration from `.lien.config.json`
2. Checks if index exists (auto-indexes if missing)
3. Starts MCP server on stdio transport
4. Listens for tool requests from Cursor
5. **Watches for file changes** and automatically reindexes (< 2 seconds per file!)
6. Detects git commits and reindexes changed files in background

### Auto-Indexing

If no index exists, `lien serve` will automatically run indexing on first start. This may take 5-20 minutes depending on project size.

### File Watching

File watching is **enabled by default** for instant updates:
- Detects when you save a file in your editor
- Automatically reindexes in < 2 seconds
- No manual `lien index` needed!

To disable for a session:
```bash
lien serve --no-watch
```

To disable permanently, set in `.lien.config.json`:
```json
{
  "fileWatching": {
    "enabled": false
  }
}
```

::: tip
Usually run via Cursor's MCP configuration, not manually.
:::

### MCP Configuration

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "lien": {
      "command": "lien",
      "args": ["serve"],
      "cwd": "/absolute/path/to/your/project"
    }
  }
}
```

## lien status

Show indexing status and statistics.

```bash
lien status
```

### Output

```
📊 Lien Status

Project: /path/to/your/project
Config: .lien.config.json (v0.3.0)

Index Status:
  Location: ~/.lien/indices/abc123
  Last indexed: 2 hours ago
  Files indexed: 1,234
  Chunks created: 5,678
  Test associations: 234
  Disk usage: 142 MB

Frameworks:
  • nodejs (.)
    - 1,100 files
    - 5,200 chunks
  • laravel (backend)
    - 134 files
    - 478 chunks
```

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
| `--threshold <n>` | Complexity threshold (overrides config, default: 10) |
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
lien complexity --format json --threshold 10 > baseline.json
```

**Custom threshold for strict review:**

```bash
lien complexity --threshold 5
```

### Complexity Scoring

Lien uses **cyclomatic complexity** - the number of independent paths through code:

| Complexity | Severity | Interpretation |
|------------|----------|----------------|
| 1-10 | OK | Simple, easy to test |
| 11-15 | Warning | Moderate complexity, consider refactoring |
| 16+ | Error | High complexity, hard to maintain |

Decision points that increase complexity:
- `if`, `else if`, `else`
- `for`, `while`, `do...while`
- `switch` `case`
- `catch`
- `&&`, `||`, `??`
- `? :` (ternary)

### Examples

```bash
# Basic analysis
lien complexity

# Strict mode for code review
lien complexity --threshold 5 --fail-on warning

# JSON output for CI
lien complexity --format json --fail-on error

# Analyze only changed files
git diff --name-only HEAD~1 | xargs lien complexity --files
```

## lien --version

Show installed version.

```bash
lien --version
# Output: 0.8.1
```

## lien --help

Show help and available commands.

```bash
lien --help
```

```
Usage: lien [options] [command]

Local semantic code search for AI assistants

Options:
  -V, --version      output the version number
  -h, --help         display help for command

Commands:
  init [options]     Initialize Lien in current directory
  index [options]    Index your codebase
  serve [options]    Start MCP server
  status             Show indexing status
  complexity         Analyze code complexity
  help [command]     display help for command
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
| 4 | Network error (model download) |

## Common Workflows

### Initial Setup

```bash
cd /path/to/project
lien init
lien index
```

### After Config Changes

```bash
# Edit .lien.config.json
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

## Tips

1. **Run init once**: Each project needs `lien init` only once
2. **Force rebuild when needed**: Use `lien index --force` after config changes
3. **Check status first**: Use `lien status` to verify index state
4. **Watch the output**: Indexing progress shows potential issues
5. **Use absolute paths**: In MCP config, always use absolute paths



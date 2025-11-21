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

Index your codebase for semantic search.

```bash
lien index
```

### Behavior

1. Scans files based on framework configuration
2. Chunks code into semantic units
3. Generates embeddings using local ML model
4. Stores in `~/.lien/indices/[project-hash]/`
5. Detects test associations

### Performance

Indexing time depends on project size:
- **Small** (1k files): ~5 minutes
- **Medium** (10k files): ~20 minutes
- **Large** (50k files): ~30-60 minutes

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

Start the MCP server for AI assistant integration.

```bash
lien serve
```

### Behavior

1. Loads configuration from `.lien.config.json`
2. Checks if index exists (auto-indexes if missing)
3. Starts MCP server on stdio transport
4. Listens for tool requests from Cursor

### Auto-Indexing

If no index exists, `lien serve` will automatically run indexing on first start. This may take 5-20 minutes depending on project size.

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

## lien reindex

Clear existing index and rebuild from scratch.

```bash
lien reindex
```

### When to Use

- After major codebase changes
- When search results seem stale
- After changing configuration
- To fix corrupted index

### Behavior

1. Deletes existing index in `~/.lien/indices/[project-hash]/`
2. Runs full indexing from scratch
3. Same process as `lien index`

::: warning
This operation cannot be undone. The old index will be permanently deleted.
:::

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
  index              Index your codebase
  serve              Start MCP server
  reindex            Clear and rebuild index
  status             Show indexing status
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
lien reindex
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
2. **Reindex after major changes**: Large refactors or config updates
3. **Check status first**: Use `lien status` to verify index state
4. **Watch the output**: Indexing progress shows potential issues
5. **Use absolute paths**: In MCP config, always use absolute paths



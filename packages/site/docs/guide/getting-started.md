# Quick Start

This guide will walk you through setting up Lien in your project and integrating it with Cursor.

## Step 1: Initialize in Your Project

Navigate to your project directory and run:

```bash
cd /path/to/your/project
lien init
```

This will:
- Detect frameworks in your project (Node.js, Laravel, etc.)
- Create a `.lien.config.json` file with framework-aware settings
- Offer to install Cursor rules (recommended)

### Framework Detection

Lien automatically detects:
- **Node.js/TypeScript**: via `package.json`
- **Laravel/PHP**: via `composer.json`
- **Shopify Themes**: via `config/settings_schema.json`

During initialization, you'll be prompted to:
- Select which frameworks to enable
- Customize framework settings (optional)
- Install recommended Cursor rules

::: tip Cursor Rules
If you accept Cursor rules installation, Lien creates `.cursor/rules/lien.mdc` with best practices for using Lien tools. This helps Cursor understand when and how to use semantic search.
:::

## Step 2: Index Your Codebase

Index your codebase to enable semantic search:

```bash
lien index
```

This will:
- Scan your codebase for source files
- Chunk code into semantic units
- Generate embeddings using a local ML model
- Store embeddings in `~/.lien/indices/`

::: info First-Time Setup
On first run, Lien will download the embedding model (~100MB). This happens once and requires an internet connection.
:::

### Expected Indexing Times

- **Small projects** (1k files): ~5 minutes
- **Medium projects** (10k files): ~20 minutes
- **Large projects** (50k files): ~30-60 minutes

::: tip Auto-Indexing
You can skip this step - Cursor will automatically index your codebase on first connection. However, indexing ahead of time is recommended for a smoother first experience.
:::

## Step 3: Configure Cursor

Create `.cursor/mcp.json` in your project root:

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
The `.cursor/mcp.json` file is per-project, so each project automatically gets its own Lien instance. When you switch projects in Cursor, the right Lien server starts automatically - no manual config updates needed!
:::

::: warning Add to .gitignore (Optional)
You may want to add `.cursor/mcp.json` to `.gitignore` if you don't want to commit it, or commit it so your team can use Lien too!
:::

## Step 4: Restart Cursor

Restart Cursor completely to load the new MCP configuration.

::: tip
After restarting, Cursor will automatically start the Lien MCP server in the background. You should see Lien tools available in Cursor's MCP tool list.
:::

## Step 5: Test It Out!

In Cursor chat, try queries like:

```
Search for authentication logic
```

```
Find error handling patterns
```

```
Show me database connection code
```

```
List all API endpoints
```

## Monorepo Support

Lien supports multiple frameworks in a single repository:

```bash
# Example monorepo structure
my-app/
  ├── src/                  # Node.js/TypeScript
  ├── backend/              # Laravel
  └── .lien.config.json

# Run from root
cd my-app
lien init  # Detects both frameworks
```

Generated config:

```json
{
  "frameworks": [
    {
      "name": "nodejs",
      "path": ".",
      "config": { /* Node.js patterns */ }
    },
    {
      "name": "laravel",
      "path": "backend",
      "config": { /* Laravel patterns */ }
    }
  ]
}
```

## Migrating from v0.2.0

If you have an existing `.lien.config.json` from v0.2.0:

```bash
# Automatic migration
lien index  # or any command

# Manual upgrade
lien init --upgrade
```

Your config will be:
- Backed up to `.lien.config.json.v0.2.0.backup`
- Converted to a single "generic" framework
- Fully compatible with v0.3.0+

## Troubleshooting

### "Index not found" error

Run `lien index` to create the index.

### "Model download failed"

Ensure you have:
- Internet connection (first run only)
- ~100MB free disk space
- Node.js 22+ installed

### Cursor doesn't show Lien tools

1. Check `.cursor/mcp.json` in your project root exists and is valid JSON
2. Restart Cursor completely
3. Check Cursor's developer console for errors

::: tip Manual Server Start
You don't need to manually run `lien serve` with Cursor - it starts automatically. However, you can run `lien serve` manually for:
- Debugging MCP server issues
- Using with other MCP clients that don't auto-start
- Testing the server independently
:::

### Slow indexing

- Exclude unnecessary directories in `.lien.config.json`
- Don't index `node_modules`, `dist`, or build artifacts
- Close other resource-intensive applications

### Results not relevant

- Try rebuilding the index: `lien index --force`
- Adjust chunk size in config (larger chunks = more context)
- Be more specific in your queries

## Next Steps

- Learn about [configuration options](/guide/configuration)
- Explore [MCP tools](/guide/mcp-tools)
- Read about [CLI commands](/guide/cli-commands)



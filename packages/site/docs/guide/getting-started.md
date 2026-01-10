# Quick Start

This guide walks you through setting up Lien with Cursor in under 2 minutes.

## Step 1: Configure Cursor

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

That's it! Lien works with **zero configuration**.

::: tip Per-Project Configuration
The `.cursor/mcp.json` file is per-project, so each project automatically gets its own Lien instance. When you switch projects in Cursor, the right Lien server starts automatically.
:::

::: warning Global MCP Config
If you're using a **global** `~/.cursor/mcp.json` instead, you must specify the project path:

```json
{
  "mcpServers": {
    "my-project": {
      "command": "lien",
      "args": ["serve", "--root", "/path/to/your/project"]
    }
  }
}
```

We recommend per-project `.cursor/mcp.json` for simplicity.
:::

## Step 2: Restart Cursor

Restart Cursor completely to load the MCP configuration.

After restarting, Cursor will automatically:
- Start the Lien MCP server
- Index your codebase (first time only)
- Make Lien tools available

::: info First-Time Indexing
On first run, Lien downloads an embedding model (~100MB) and indexes your codebase. This may take 5-20 minutes depending on project size.
:::

## Step 3: Test It Out!

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

Lien automatically detects and indexes multiple frameworks:

```bash
# Example monorepo structure
my-app/
  ├── src/                  # Node.js/TypeScript (auto-detected)
  ├── backend/              # Laravel (auto-detected)
  └── .cursor/mcp.json      # Just add this!
```

Lien scans your project structure and applies appropriate patterns for each detected framework—no configuration needed.

## Optional: Install Cursor Rules

For the best experience, install Lien's Cursor rules:

```bash
lien init
```

This creates `.cursor/rules/lien.mdc` with instructions that help Cursor use Lien tools effectively. It teaches Cursor to use semantic search instead of grep and to check test associations before editing files.

## Troubleshooting

### Cursor doesn't show Lien tools

1. Check `.cursor/mcp.json` in your project root exists and is valid JSON
2. Restart Cursor completely
3. Check Cursor's developer console for errors

::: tip Manual Server Start
You don't need to manually run `lien serve` with Cursor—it starts automatically. You can run it manually for debugging or with other MCP clients.
:::

### "Model download failed"

Ensure you have:
- Internet connection (first run only)
- ~100MB free disk space
- Node.js 22+ installed

### Slow indexing

- Lien automatically excludes `node_modules`, `dist`, and build artifacts
- Close other resource-intensive applications during first index
- Large codebases (50k+ files) may take 30-60 minutes initially

### Results not relevant

- Try rebuilding the index: `lien index --force`
- Be more specific in your queries
- Use natural language: "how does authentication work?" vs "auth"

## Next Steps

- Learn about [configuration options](/guide/configuration)
- Explore [MCP tools](/guide/mcp-tools)
- Read about [CLI commands](/guide/cli-commands)



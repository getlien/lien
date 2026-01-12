# Quick Start

This guide walks you through setting up Lien with Cursor or Claude Code in under 2 minutes.

## Step 1: Configure Your AI Assistant

Choose your AI assistant below:

### Option A: Cursor (Recommended)

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

### Option B: Claude Code

Claude Code uses a global configuration file. Create or edit `claude_desktop_config.json`:

**Location:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**Configuration:**

```json
{
  "mcpServers": {
    "lien-myproject": {
      "command": "lien",
      "args": ["serve", "--root", "/absolute/path/to/your/project"]
    }
  }
}
```

::: warning Absolute Paths Required
Claude Code requires **absolute paths** in the `--root` argument. Replace `/absolute/path/to/your/project` with your actual project path (e.g., `/Users/yourname/code/myproject` or `C:\Users\yourname\code\myproject`).
:::

::: tip Multiple Projects
For multiple projects, add separate entries:

```json
{
  "mcpServers": {
    "lien-project1": {
      "command": "lien",
      "args": ["serve", "--root", "/path/to/project1"]
    },
    "lien-project2": {
      "command": "lien",
      "args": ["serve", "--root", "/path/to/project2"]
    }
  }
}
```

Claude will show all projects' tools, so you can switch contexts by asking about different projects.
:::

## Step 2: Restart Your AI Assistant

**For Cursor**: Restart Cursor completely (Quit and reopen, not just reload window).

**For Claude Code**: Restart Claude Desktop completely.

After restarting, your AI assistant will automatically:
- Start the Lien MCP server
- Index your codebase (first time only)
- Make Lien tools available

::: info First-Time Indexing
On first run, Lien downloads an embedding model (~100MB) and indexes your codebase. This may take 5-20 minutes depending on project size.
:::

## Step 3: Test It Out!

In your AI assistant's chat, try queries like:

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

## Troubleshooting

### AI assistant doesn't show Lien tools

**For Cursor:**
1. Check `.cursor/mcp.json` in your project root exists and is valid JSON
2. Restart Cursor completely (Quit, not just reload)
3. Check Cursor's developer console for errors

**For Claude Code:**
1. Verify `claude_desktop_config.json` is in the correct location
2. Ensure paths are absolute (e.g., `/Users/name/project`, not `~/project`)
3. Restart Claude Desktop completely
4. Check Claude's logs: View → Developer → Show Logs

::: tip Manual Server Start
You don't need to manually run `lien serve`—it starts automatically. You can run it manually for debugging:

```bash
# Test server manually
lien serve --root /path/to/your/project
```
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



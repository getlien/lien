# Quick Start

This guide walks you through setting up Lien with Cursor or Claude Code in under 2 minutes.

## Step 1: Configure Your Editor

Run `lien init` and select your editor:

```bash
lien init
```

Or specify it directly:

```bash
lien init --editor cursor
lien init --editor claude-code
lien init --editor windsurf
lien init --editor opencode
lien init --editor kilo-code
lien init --editor antigravity
```

This writes the correct MCP config for your editor. That's it—Lien works with **zero configuration**.

::: details What does `lien init` create?

| Editor | Config File | Scope |
|--------|-------------|-------|
| Cursor | `.cursor/mcp.json` | Per-project |
| Claude Code | `.mcp.json` | Per-project |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | Global (with `--root`) |
| OpenCode | `opencode.json` | Per-project |
| Kilo Code | `.kilocode/mcp.json` | Per-project |
| Antigravity | Prints snippet to copy | Manual |

Per-project configs automatically detect the project root. Windsurf uses a global config, so `lien init` includes the absolute project path via `--root`.
:::

## Step 2: Restart Your Editor

Restart your editor completely (quit and reopen, not just reload window).

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
  └── .cursor/mcp.json      # Created by `lien init`
```

Lien scans your project structure and applies appropriate patterns for each detected framework—no configuration needed.

## Troubleshooting

### AI assistant doesn't show Lien tools

1. Run `lien init` to verify the config file was created for your editor
2. Restart your editor completely (quit, not just reload)
3. Check your editor's developer console or logs for errors
4. For Windsurf: ensure the `--root` path in `~/.codeium/windsurf/mcp_config.json` is correct

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



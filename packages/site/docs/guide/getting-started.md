# Quick Start

This guide walks you through setting up Lien with your editor in under 2 minutes.

## Step 1: Configure Your Editor

Lien has no setup wizard: add its MCP server to your editor's config by hand.
See [Configuring Your Editor (MCP)](/guide/installation#configuring-your-editor-mcp)
in the installation guide for the exact config file and JSON snippet for your
editor — Cursor, Claude Code, Windsurf, OpenCode, Kilo Code, or Antigravity.

Once the MCP tools are wired up, see [Cross-Editor Agent Setup](/guide/cross-editor-setup) for a
copy-paste `AGENTS.md` block that tells your agent to actually use them
before editing. Most non-Claude-Code editors read that file natively.

## Step 2: Restart Your Editor

Restart your editor completely (quit and reopen, not just reload window).

After restarting, your AI assistant will automatically:
- Start the Lien MCP server
- Index your codebase (first time only)
- Make Lien tools available

::: info First-Time Indexing
On first run, Lien indexes your codebase. There's no model to download: indexing starts immediately and runs offline. This may take a few minutes depending on project size.
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

Lien automatically detects and indexes multiple ecosystems:

```bash
# Example monorepo structure
my-app/
  ├── src/                  # Node.js/TypeScript (auto-detected)
  ├── backend/              # Laravel (auto-detected)
  └── .cursor/mcp.json      # Your editor's MCP config
```

Lien scans your project structure and applies appropriate patterns for each detected ecosystem, no configuration needed.

## Troubleshooting

### AI assistant doesn't show Lien tools

1. Double-check your editor's MCP config file matches the snippet in the [installation guide](/guide/installation#configuring-your-editor-mcp)
2. Restart your editor completely (quit, not just reload)
3. Check your editor's developer console or logs for errors
4. For Windsurf: ensure the `--root` path in `~/.codeium/windsurf/mcp_config.json` is correct

::: tip Manual Server Start
You don't need to manually run `lien serve`; it starts automatically. You can run it manually for debugging:

```bash
# Test server manually
lien serve --root /path/to/your/project
```
:::

### Slow indexing

- Lien automatically excludes `node_modules`, `dist`, and build artifacts
- Close other resource-intensive applications during first index
- Very large codebases (50k+ files) may take a few minutes on the first index

### Results not relevant

- Try rebuilding the index: `lien index --force`
- Search is keyword-based (not meaning-based): query with terms that appear in the code, e.g. "authenticate token session" rather than "how does login work?"
- For an exact symbol name, ask for `list_functions` instead of search

## Next Steps

- Learn about [configuration options](/guide/configuration)
- Explore [MCP tools](/guide/mcp-tools)
- Read about [CLI commands](/guide/cli-commands)
- Not on Claude Code? See [Cross-Editor Agent Setup](/guide/cross-editor-setup)



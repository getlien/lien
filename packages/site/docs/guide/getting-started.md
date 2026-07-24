# Quick Start

This guide walks you through setting up Lien with your editor in under 2 minutes.

## Step 1: Configure Your Editor

### Claude Code (recommended path)

Install the plugin once and you're done, with no per-project setup:

```text
/plugin marketplace add getlien/lien
/plugin install lien
```

Lien's MCP tools and the Explore agent become available in every Claude Code session, in every repo.

::: tip
If you previously used `lien init --editor claude-code` per project, you can leave those `.mcp.json` files in place or remove them; the plugin's MCP server replaces them. `lien init --editor claude-code --legacy` is still available if you need the old per-project flow for any reason.
:::

### Other editors (Cursor, Windsurf, OpenCode, Kilo Code, Antigravity)

These editors don't have a plugin marketplace yet. Run `lien init` per project and select your editor:

```bash
lien init
```

Or specify it directly:

```bash
lien init --editor cursor
lien init --editor windsurf
lien init --editor opencode
lien init --editor kilo-code
lien init --editor antigravity
```

This writes the correct MCP config for your editor. Once the MCP tools are
wired up, see [Cross-Editor Agent Setup](/guide/cross-editor-setup) for a
copy-paste `AGENTS.md` block that tells your agent to actually use them
before editing. Most non-Claude-Code editors read that file natively.

::: details What does `lien init` create?

| Editor | Config File | Scope |
|--------|-------------|-------|
| Cursor | `.cursor/mcp.json` | Per-project |
| Claude Code (`--legacy` only) | `.mcp.json` | Per-project |
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
  └── .cursor/mcp.json      # Created by `lien init`
```

Lien scans your project structure and applies appropriate patterns for each detected ecosystem, no configuration needed.

## Troubleshooting

### AI assistant doesn't show Lien tools

1. Run `lien init` to verify the config file was created for your editor
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



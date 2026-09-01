# Installation

## Prerequisites

- **Node.js 22.21.0 or higher** (check with `node --version`)
- No compiler or build toolchain required on supported platforms: Lien's parser ships as prebuilt native binaries for macOS (arm64/x64), Linux (x64/arm64, glibc or musl, including Alpine), and Windows (x64), so there's no `node-gyp`, no Python/make/g++, no Xcode Command Line Tools step. Any other platform needs a one-time local build of the parser crate with the Rust toolchain
- 8GB+ RAM recommended for large codebases

## Global Installation

Install Lien globally:

```bash
npm install -g @liendev/lien
```

Verify installation:

```bash
lien --version
```

Then wire it up per-project — see [Configuring Your Editor (MCP)](#configuring-your-editor-mcp) below.

## Configuring Your Editor (MCP)

Lien has no setup wizard: you add its MCP server to your editor's config by hand, once per project. Each editor reads that config from a different file:

| Editor | Config File | Scope |
|--------|-------------|-------|
| Cursor | `.cursor/mcp.json` | Per-project |
| Claude Code | `.mcp.json` | Per-project |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | Global (needs `--root`) |
| OpenCode | `opencode.json` | Per-project |
| Kilo Code | `.kilocode/mcp.json` | Per-project |
| Antigravity | Paste into MCP settings | Manual |

**Cursor, Claude Code, and Kilo Code** all take the same `mcpServers` block. Create (or edit) the file listed above for your editor with:

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

**Windsurf** shares one global config across every project, so it needs the absolute project path via `--root`:

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

**OpenCode** uses an `mcp` key instead of `mcpServers`, with its own command shape:

```json
{
  "mcp": {
    "lien": {
      "type": "local",
      "command": ["lien", "serve"]
    }
  }
}
```

**Antigravity** has no project config file to edit: open its MCP settings and paste the same `mcpServers` block shown for Cursor above.

Per-project configs (Cursor, Claude Code, OpenCode, Kilo Code) auto-detect the project root, so you don't need `--root` for those. See the [Quick Start guide](/guide/getting-started) for the full per-editor walkthrough.

## Using npx (no global install)

You can run Lien without installing it globally:

```bash
npx @liendev/lien index
npx @liendev/lien serve
```

::: tip
For frequent use, global installation gives better cold-start performance.
:::

## Upgrading

**Plugin users (Claude Code):** restart Claude Code. The plugin's `npx -y @liendev/lien@latest` invocation re-resolves to the latest npm version on every cold start, so a restart is all you need.

**Global install users:** bump the package and restart your editor.

```bash
npm update -g @liendev/lien
```

::: warning
Code changes (new features and bug fixes) require restarting your editor. The auto-reconnect feature only handles data changes (reindexing).
:::

## Uninstalling

**If you installed the old Claude Code plugin** (removed in a later release, but
still present in your Claude Code install until you remove it):

```text
/plugin uninstall lien
/plugin marketplace remove getlien/lien
```

**Global install:**

```bash
# Remove global package
npm uninstall -g @liendev/lien

# Remove cached indices (optional)
rm -rf ~/.lien
```

## Verifying Installation

Check that Lien is properly installed:

```bash
# Check version
lien --version

# Show help
lien --help

# Check available commands
lien
```

## Next Steps

Now that Lien is installed, proceed to the [Quick Start guide](/guide/getting-started) to initialize your first project.



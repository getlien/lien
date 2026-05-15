# Installation

## Prerequisites

- **Node.js 22.21.0 or higher** (check with `node --version`)
- At least 200MB free disk space (for ML model)
- 8GB+ RAM recommended for large codebases

## Claude Code Plugin (Recommended)

For Claude Code users, the simplest path is the one-time plugin install — no `npm install`, no per-project `lien init`. Lien's MCP tools and the Explore agent become available in every Claude Code session, in every repo.

```text
/plugin marketplace add getlien/lien
/plugin install lien
```

The plugin spawns Lien on demand via `npx -y @liendev/lien`, so it always pulls the latest release. To upgrade, restart Claude Code — the next spawn fetches the newest version automatically.

::: tip Working on Lien itself?
Contributors should NOT install the plugin in their dev environment — that points the MCP server at the npm-published binary, bypassing your local changes. See [CONTRIBUTING.md](https://github.com/getlien/lien/blob/main/CONTRIBUTING.md) for the dogfooding setup that points at your local build instead.
:::

## Global Installation (for Cursor, Windsurf, OpenCode, Kilo Code, Antigravity)

These editors don't have a plugin marketplace yet, so install Lien globally and wire it up per-project with `lien init`:

```bash
npm install -g @liendev/lien
```

Verify installation:

```bash
lien --version
```

Then in each project:

```bash
lien init
```

`lien init` writes the correct MCP config for your editor — `.cursor/mcp.json` for Cursor, `opencode.json` for OpenCode, and so on. See the [Quick Start guide](/guide/getting-started) for the full per-editor flow.

## Using npx (no global install)

You can run Lien without installing it globally:

```bash
npx @liendev/lien init
npx @liendev/lien index
npx @liendev/lien serve
```

::: tip
For frequent use, global installation gives better cold-start performance.
:::

## Upgrading

**Plugin users (Claude Code):** restart Claude Code. The plugin's `npx -y @liendev/lien` invocation re-resolves to the latest npm version on every cold start, so a restart is all you need.

**Global install users:** bump the package and restart your editor.

```bash
npm update -g @liendev/lien
```

::: warning
Code changes (new features and bug fixes) require restarting your editor. The auto-reconnect feature only handles data changes (reindexing).
:::

## Uninstalling

**Plugin users:**

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



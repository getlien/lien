# Installation

## Prerequisites

- **Node.js 22.21.0 or higher** (check with `node --version`)
- No compiler or build toolchain required on supported platforms: Lien's parser ships as prebuilt native binaries for macOS (arm64/x64), Linux (x64/arm64, glibc or musl, including Alpine), and Windows (x64), so there's no `node-gyp`, no Python/make/g++, no Xcode Command Line Tools step. Any other platform needs a one-time local build of the parser crate with the Rust toolchain
- 8GB+ RAM recommended for large codebases

## Claude Code Plugin (Recommended)

For Claude Code users, the simplest path is the one-time plugin install: no `npm install`, no per-project `lien init`. Lien's MCP tools and the Explore agent become available in every Claude Code session, in every repo.

```text
/plugin marketplace add getlien/lien
/plugin install lien
```

The plugin spawns Lien on demand via `npx -y @liendev/lien@latest`, which resolves against the npm registry on every launch, so it always runs the latest published release, even if you have a local `npm link` or workspace copy of `@liendev/lien` on your machine. To upgrade, restart Claude Code: the next spawn fetches the newest version automatically.

::: tip Working on Lien itself?
Contributors should NOT install the plugin in their dev environment: that points the MCP server at the npm-published binary, bypassing your local changes. See [CONTRIBUTING.md](https://github.com/getlien/lien/blob/main/CONTRIBUTING.md) for the dogfooding setup that points at your local build instead.
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

`lien init` writes the correct MCP config for your editor: `.cursor/mcp.json` for Cursor, `opencode.json` for OpenCode, and so on. See the [Quick Start guide](/guide/getting-started) for the full per-editor flow.

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

**Plugin users (Claude Code):** restart Claude Code. The plugin's `npx -y @liendev/lien@latest` invocation re-resolves to the latest npm version on every cold start, so a restart is all you need.

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



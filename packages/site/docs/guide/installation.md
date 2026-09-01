# Installation

## Prerequisites

- **Node.js 22.21.0 or higher** (check with `node --version`)
- No compiler or build toolchain required on supported platforms: Lien's parser ships as prebuilt native binaries for macOS (arm64/x64), Linux (x64/arm64, glibc or musl, including Alpine), and Windows (x64), so there's no `node-gyp`, no Python/make/g++, no Xcode Command Line Tools step. Any other platform needs a one-time local build of the parser crate with the Rust toolchain

## Global Installation

Install Lien globally:

```bash
npm install -g @liendev/lien
```

Verify installation:

```bash
lien --version
```

Then run it in your project — see the [Quick Start guide](/guide/getting-started).

## Using npx (no global install)

You can run Lien without installing it globally:

```bash
npx @liendev/lien health
```

::: tip
For frequent use, global installation gives better cold-start performance.
:::

## Upgrading

```bash
npm update -g @liendev/lien
```

There's nothing else to restart or reconnect: Lien has no background process and no persisted state, so the next command you run just uses the new version.

**If you installed the old Claude Code plugin** (removed; Lien is now a CLI you invoke directly, with no MCP server or hook integration), remove it:

```text
/plugin uninstall lien
/plugin marketplace remove getlien/lien
```

## Uninstalling

```bash
npm uninstall -g @liendev/lien
```

There's no cache or index directory to clean up — Lien doesn't write anything outside the project it's run against.

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

Now that Lien is installed, proceed to the [Quick Start guide](/guide/getting-started).

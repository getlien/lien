# Lien Claude Code Plugin

Distribution files for the `/plugin install lien` flow (see the [root README](../../README.md) for the user-facing quick start).

## Why `.mcp.json` pins `@liendev/lien@latest`

`.mcp.json` launches the MCP server via `npx -y @liendev/lien@latest serve`. The version specifier is load-bearing: `npx` without one (`npx -y @liendev/lien`) does **not** force a registry check — it happily reuses any locally-resolvable copy (a global `npm link`, or this repo's own workspace symlink) ahead of npm. That let a months-old local dev build silently shadow the published release for weeks on one machine, with no error or warning. Appending `@latest` forces `npx` to resolve against the registry, so a stale link can no longer shadow the published version.

If you're developing Lien itself, see [CONTRIBUTING.md](../../CONTRIBUTING.md#dogfooding-lien-while-working-on-lien) for how to point the MCP server at your local build instead of installing this plugin.

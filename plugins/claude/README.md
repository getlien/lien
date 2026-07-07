# Lien Claude Code Plugin

Distribution files for the `/plugin install lien` flow (see the [root README](../../README.md) for the user-facing quick start).

## Why `.mcp.json` pins `@liendev/lien@latest`

`.mcp.json` launches the MCP server via `npx -y @liendev/lien@latest serve`. The version specifier is load-bearing: `npx` without one (`npx -y @liendev/lien`) does **not** force a registry check — it happily reuses any locally-resolvable copy (a global `npm link`, or this repo's own workspace symlink) ahead of npm. That let a months-old local dev build silently shadow the published release for weeks on one machine, with no error or warning. Appending `@latest` forces `npx` to resolve against the registry, so a stale link can no longer shadow the published version.

If you're developing Lien itself, see [CONTRIBUTING.md](../../CONTRIBUTING.md#dogfooding-lien-while-working-on-lien) for how to point the MCP server at your local build instead of installing this plugin.

## Hooks

`hooks/hooks.json` wires five scripts into the Claude Code hook lifecycle. All
are best-effort — a missing `lien`/`jq`, an unindexed repo, or any internal
error just exits 0 silently, never blocking the underlying tool call. See
[claude-code-hook-channels.md](../../docs/architecture/claude-code-hook-channels.md)
for which hook output channels actually reach the model.

| Hook | Event | What it does | Kill switch |
| --- | --- | --- | --- |
| `annotate-read.sh` | PostToolUse: `Read` | Surfaces dependents/coverage/complexity for the file just read, as an `additionalContext` annotation. Suppressed per file per session within a TTL. | `LIEN_ANNOTATE_TTL_MIN=<minutes>` (default 5) |
| `delta-write.sh` | PostToolUse: `Edit\|Write\|MultiEdit` | Runs `lien delta --file <path> --format json`; warns only when the edit pushed a function to a new complexity-threshold crossing. Silent on everything else (improvements, pre-existing violations, advisory movement). | `LIEN_DELTA_HOOK=off` |
| `augment-explore-task.sh` | PreToolUse: `Agent\|Task` | When the subagent being launched is `Explore` (or `lien:Explore`/`project:Explore`), appends a Lien-tool-usage mandate to its prompt. Skips if the repo has no `structural.db` index yet, or the prompt already names a Lien MCP tool. | `LIEN_EXPLORE_INJECT=off` |
| `annotate-clean.sh` | SessionStart | GCs `annotated-sessions/` dirs untouched for >24h; pre-warms the npx fallback in the background so the first real hook call of the session doesn't pay a cold `npx` install. | none |
| `annotate-end.sh` | SessionEnd | Removes the current session's `annotated-sessions/` dir on graceful exit. Belt-and-braces — SessionStart's 24h GC is the load-bearing cleanup (covers crashes/force-quits). | none |

`lien-resolve.sh` is shared infra sourced by every hook above, not itself an
entry in `hooks.json`: it resolves a global `lien` binary, falling back to
`npx -y @liendev/lien@latest` when none is installed (the default case for a
plugin-only install).

### The Explore agent

This plugin does **not** ship an Explore agent — there's no `agents/`
directory here. `augment-explore-task.sh` targets Claude Code's **built-in**
`Explore` subagent, or one installed the legacy way via `lien init --legacy`
(which still writes `.claude/agents/Explore.md`; see the root README). If no
such subagent is ever launched in a session, the hook simply never fires —
that's expected, not a bug.

## Troubleshooting

**Merged a change under `plugins/claude/` but a session still behaves the old
way?** Installed Claude Code plugins are commit-pinned snapshots
(`~/.claude/plugins/cache/lien/lien/<commit>/`) — merging into this repo does
not update a session that already installed the plugin. Update it explicitly:
`/plugin update lien`, or if that errors, `/plugin uninstall lien@lien` then
`/plugin install lien@lien` to re-snapshot from the current repo state.

# Lien Claude Code Plugin

Distribution files for the `/plugin install lien` flow (see the [root README](../../README.md) for the user-facing quick start).

## Why `.mcp.json` pins `@liendev/lien@latest`

`.mcp.json` launches the MCP server via `npx -y @liendev/lien@latest serve`. The version specifier is load-bearing: `npx` without one (`npx -y @liendev/lien`) does **not** force a registry check — it happily reuses any locally-resolvable copy (a global `npm link`, or this repo's own workspace symlink) ahead of npm. That let a months-old local dev build silently shadow the published release for weeks on one machine, with no error or warning. Appending `@latest` forces `npx` to resolve against the registry, so a stale link can no longer shadow the published version.

If you're developing Lien itself, see [CONTRIBUTING.md](../../CONTRIBUTING.md#dogfooding-lien-while-working-on-lien) for how to point the MCP server at your local build instead of installing this plugin.

## Hooks

`hooks/hooks.json` wires six scripts into the Claude Code hook lifecycle. All
are best-effort — a missing `lien`/`jq`, an unindexed repo, or any internal
error just exits 0 silently, never blocking the underlying tool call. See
[claude-code-hook-channels.md](../../docs/architecture/claude-code-hook-channels.md)
for which hook output channels actually reach the model.

| Hook | Event | What it does | Kill switch |
| --- | --- | --- | --- |
| `annotate-read.sh` | PostToolUse: `Read` | Surfaces dependents/coverage/complexity for the file just read, as an `additionalContext` annotation. When a function in the file is at/near its complexity budget, the annotation *leads* with an imperative nudge line ("avoid adding complexity here; prefer extraction") — the plan-time nudge, surfaced before the agent edits rather than after via `delta-write.sh`. Suppressed per file per session within a TTL. | `LIEN_ANNOTATE_TTL_MIN=<minutes>` (default 5) |
| `delta-write.sh` | PostToolUse: `Edit\|Write\|MultiEdit` | Runs `lien delta --file <path> --format json`; warns only when the edit pushed a function to a new complexity-threshold crossing. Silent on everything else (improvements, pre-existing violations, advisory movement). | `LIEN_DELTA_HOOK=off` |
| `test-reminder.sh` | PostToolUse: `Edit\|Write\|MultiEdit` | Runs `lien annotate <path> --tests-only` (a cheap test-association-only lookup); when the edited file has associated tests, emits one compact `additionalContext` line naming them and asking the model to run them before completing. Silent when the file has no known tests. Shares `annotate-read.sh`'s per-file-per-session TTL suppression (same `annotated-sessions/` dir, namespaced hash) so an edit burst only reminds once per window. | `LIEN_TEST_REMINDER=off` |
| `augment-explore-task.sh` | PreToolUse: `Agent\|Task` | When the subagent being launched is `Explore` (or `lien:Explore`/`project:Explore`), appends a Lien-tool-usage mandate to its prompt. Skips if the repo has no `structural.db` index yet, or the prompt already names a Lien MCP tool. | `LIEN_EXPLORE_INJECT=off` |
| `annotate-clean.sh` | SessionStart | GCs `annotated-sessions/` dirs untouched for >24h; pre-warms the npx fallback in the background so the first real hook call of the session doesn't pay a cold `npx` install. | none |
| `annotate-end.sh` | SessionEnd | Removes the current session's `annotated-sessions/` dir on graceful exit. Belt-and-braces — SessionStart's 24h GC is the load-bearing cleanup (covers crashes/force-quits). | none |

`lien-resolve.sh` is shared infra sourced by every hook above, not itself an
entry in `hooks.json`: it resolves a global `lien` binary, falling back to
`npx -y @liendev/lien@latest` when none is installed (the default case for a
plugin-only install).

Every `delta-write.sh` run (and every other `lien delta` invocation — manual
or CI) is recorded locally as one JSONL line in `delta-events.jsonl` next to
the project's index; nothing leaves the machine. Run `lien stats` for 7/30-day
counts. Kill switch: `LIEN_DELTA_EVENTS=off`. See
[docs/architecture/lien-delta.md](../../docs/architecture/lien-delta.md#measuring-the-nudge-loop--delta-eventsjsonl--lien-stats).

### Why the nudge rides `annotate-read.sh`, not a new `PreToolUse:Edit` hook

The obvious design for a "before you edit" complexity nudge is a `PreToolUse`
hook on `Edit|Write|MultiEdit`. It doesn't work: per
[docs/architecture/claude-code-hook-channels.md](../../docs/architecture/claude-code-hook-channels.md),
`PreToolUse`'s only channel that reaches the model is `updatedInput.prompt`,
and that's specific to the subagent-launch tool (`augment-explore-task.sh`) —
`Edit`/`Write`'s `tool_input` has no `prompt` field to rewrite. The other
`PreToolUse` channel, `exit 2` + stderr, *blocks* the tool call — turning an
advisory nudge into a hard stop and breaking every hook's fail-open contract.
So the nudge instead enriches `annotate-read.sh`'s existing `PostToolUse:Read`
annotation, which already fires before the mandatory `get_files_context` /
`Edit` step in the normal workflow, reaches the model via the verified
`additionalContext` channel, and inherits the same TTL suppression for free.

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

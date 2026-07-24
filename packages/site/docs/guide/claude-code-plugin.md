# Claude Code Plugin

Installing Lien as a Claude Code plugin gets you more than an MCP config.
Three `PostToolUse` hooks push structural context, complexity accounting, and
test reminders into the agent's next turn automatically: after a read, after
a write, before a commit, without the agent having to ask or remember to. This
page covers what ships and what each hook actually does.

## Install

```text
/plugin marketplace add getlien/lien
/plugin install lien
```

That's it: no `npm install`, no `lien init`, no per-project `.mcp.json`. The
plugin's MCP server launches on demand via `npx -y @liendev/lien@latest serve`,
which always resolves against the npm registry, so it runs the latest
published release even if you have a local `npm link` or workspace copy of
`@liendev/lien` on the machine. First use in a new git repo triggers a
one-time index automatically.

::: tip Working on Lien itself?
Don't install this plugin in Lien's own dev environment: it points the MCP
server at the published npm binary, bypassing your local build. See
[CONTRIBUTING.md](https://github.com/getlien/lien/blob/main/CONTRIBUTING.md#dogfooding-lien-while-working-on-lien)
for the dogfooding setup that points at your local build instead.
:::

This is Claude Code-specific. For other MCP-compatible editors (Cursor,
Windsurf, OpenCode, Kilo Code, Antigravity), see the
[installation guide](/guide/installation).

::: tip Not using Claude Code?
Most other agentic editors read a plain instruction file instead of hooks.
See [Cross-Editor Agent Setup](/guide/cross-editor-setup) for copy-paste
`AGENTS.md`/`.github/copilot-instructions.md` blocks that carry the same
mandate, with the same honesty caveat: rules-file compliance is best-effort,
not the deterministic guarantee a hook gives you.
:::

## What you get

### MCP tools

`search_code`, `get_files_context`, `get_dependents`, `list_functions`,
`get_complexity`, and `find_similar` all become available with no server to
configure. See the [MCP Tools reference](/guide/mcp-tools) for parameters and
response shapes.

### The read hook: structural context before you edit

`annotate-read.sh` fires on `PostToolUse:Read`. When the file you just read has
non-trivial blast radius, it injects a short impact summary as
`additionalContext`, the one hook output channel verified to actually reach
the model on its next turn (a bare `systemMessage` does not). A real example,
captured live in this session:

```
Lien impact for packages/cli/src/cli/annotate-cmd.ts:
  • 2 files import this — packages/cli/src/cli/index.ts, packages/cli/src/cli/annotate-cmd.test.ts; risk: medium (2 callers, 1 untested).
  • Test coverage: packages/cli/src/cli/annotate-cmd.test.ts.
```

It reports dependent count and blast-radius risk (with reasoning), test
coverage, and, when present, a complexity warning (max cyclomatic complexity
and how many functions in the file are over the warn threshold). It stays
silent when impact is trivial (0-1 dependents, no complexity warnings,
existing test coverage, no near-budget functions), and it won't repeat for the
same file within a session for a TTL (default 5 minutes,
`LIEN_ANNOTATE_TTL_MIN`). The effect is that you see who depends on a file and
how well it's tested *before* you touch it, without having to call
`get_files_context` yourself.

#### The plan-time nudge: before you write, not after

When a function in the file is already at or near its complexity budget
(cyclomatic/cognitive ≥ 80% of threshold, the same computation
`get_files_context`'s `complexityHeadroom` uses), the annotation *leads* with
an imperative warning line instead of burying it as data:

```
⚠ Lien: extractSymbols cognitive 18/15 (over) — avoid adding complexity here; prefer extraction.
Lien impact for packages/cli/src/cli/annotate-cmd.ts:
  • 2 files import this — packages/cli/src/cli/index.ts, packages/cli/src/cli/annotate-cmd.test.ts; risk: medium (2 callers, 1 untested).
  • Test coverage: packages/cli/src/cli/annotate-cmd.test.ts.
```

This fires while there's still a chance to steer around the hot function or extract
instead of adding to it, before the write-gate hook below has anything to check.
`get_files_context`'s response carries the identical signal as a
`complexityHeadroomWarning` field. See
[the plan-time nudge section of lien-delta.md](https://github.com/getlien/lien/blob/main/docs/architecture/lien-delta.md#the-plan-time-nudge-moving-the-headroom-signal-before-the-write)
for why this lives on the read hook instead of a new `PreToolUse` hook.

### The write gate: `lien delta` on every edit

`delta-write.sh` fires on `PostToolUse:Edit|Write|MultiEdit`. It runs
`lien delta --file <path> --format json` and warns only when *that specific
edit* pushed a function to a new complexity-threshold crossing: a function
that was under a cyclomatic/cognitive/Halstead threshold before and is now
over it, or a brand-new function that starts out over. It's silent for
everything else: improvements, pre-existing violations, or worsened-but-still-
under movement. The underlying delta computation is a ~50ms deterministic
check (no LLM call); the hook's own end-to-end latency, including CLI process
startup, measures ~215ms warm / ~410ms cold, well under its 5s timeout.

```
⚠ lien delta: extractSymbols cognitive 12→29 (threshold 15) — consider simplifying before you commit.
```

This drives the exact same primitive that backs the `lien delta` CLI gate, so
the hook's verdict and the command's verdict can never disagree. Because the
warning lands via `additionalContext`, it reaches the agent on its very next
turn, while the change is still in hand, not after a PR review catches it
later. Disable with `LIEN_DELTA_HOOK=off`.

Every `lien delta` invocation (this hook's fast `--file` runs, a manual
`lien delta`, and a CI `--base` run alike) is also recorded as one line in a
local, append-only `delta-events.jsonl` next to your project's index
(`~/.lien/indices/<repoId>/`), with no network call and no telemetry. Run
`lien stats` for 7/30-day counts of runs, new crossings, and functions later
seen clean after being flagged. See
[the measurement section of lien-delta.md](https://github.com/getlien/lien/blob/main/docs/architecture/lien-delta.md#measuring-the-nudge-loop-delta-eventsjsonl--lien-stats)
for what those counts do and don't prove. Disable recording entirely with
`LIEN_DELTA_EVENTS=off`.

### The test reminder: close the loop after you write

`test-reminder.sh` also fires on `PostToolUse:Edit|Write|MultiEdit`, alongside
the write gate. It runs `lien annotate <path> --tests-only` (a cheap
test-association-only lookup against the existing index, no dependency-graph
walk) and, when the file you just changed has associated tests, injects one
compact `additionalContext` line naming them:

```
Lien: you changed packages/review/src/github-api.ts — associated tests: packages/review/test/github-api.test.ts. Run them before completing.
```

This closes the read → write → verify loop: the read hook shows you test
coverage before you edit, and this one reminds you to actually run those tests
afterward: the step agents most often skip once the diff looks done. It stays
silent when the file has no known test associations, and shares the read
hook's per-file-per-session TTL suppression so an edit burst on one file only
reminds once per window (default 5 minutes, `LIEN_ANNOTATE_TTL_MIN`). Disable
with `LIEN_TEST_REMINDER=off`.

### Explore-agent nudge, and a plan-time nudge for builder subagents

A third hook (`PreToolUse:Agent|Task`) appends a short Lien-tool mandate to the
prompt whenever Claude Code launches its built-in `Explore` subagent, since
subagents start with a fresh prompt and don't inherit the parent session's
instructions, so this is the only channel available to reach them. It's a
no-op if the repo has no index yet, or if the prompt already names a Lien MCP
tool. The plugin doesn't ship its own Explore agent definition; this targets
Claude Code's built-in `Explore` subagent (or one installed the legacy way via
`lien init --legacy`).

The same hook also covers every other subagent_type, the ones that actually
write code. When such a prompt names a repo-relative file that resolves on
disk and `lien annotate` reports a function at/near its complexity budget, the
hook appends a compact "Lien plan-time note" naming the near-budget functions,
capped the same way the read-hook's warning line is (3 entries, #788). Silent
whenever no named path resolves or nothing is near budget. Spawned agents get
no nudge by default today, so this closes that gap for the subagents doing the
actual writing. Disable with `LIEN_SUBAGENT_NUDGE=off`.

## Why hooks, not CLAUDE.md rules

A rule written into `CLAUDE.md` only helps if the agent remembers to follow
it, and that gets less reliable as a session's context fills up. A
`PostToolUse` hook fires deterministically on every matching tool call,
regardless of what's still in context. Lien's own `CLAUDE.md` notes that these
hooks automate three of its own MANDATORY policies (checking file context
before an edit, running the associated tests after a change, and running
`lien delta` before a commit), which is also why the plugin runs on Lien's
own development, not just its users' repos.

## Configuration

Every hook is best-effort: a missing `lien`/`jq`, an unindexed repo, or any
internal error exits silently rather than blocking your tool call.

| Env var | Effect |
|---|---|
| `LIEN_ANNOTATE_TTL_MIN` | Read-hook and test-reminder suppression window in minutes (default 5) |
| `LIEN_DELTA_HOOK=off` | Disables the write-time complexity gate |
| `LIEN_TEST_REMINDER=off` | Disables the post-edit test-association reminder |
| `LIEN_DELTA_EVENTS=off` | Disables local `lien delta` event recording (used by `lien stats`) |
| `LIEN_EXPLORE_INJECT=off` | Disables the Explore-agent prompt nudge |
| `LIEN_SUBAGENT_NUDGE=off` | Disables the builder-subagent plan-time complexity nudge |

## Updating

Installed plugins are commit-pinned snapshots
(`~/.claude/plugins/cache/lien/lien/<commit>/`). Merging a change into this
repo does not update a session that already installed the plugin. Run
`/plugin update lien`, or if that errors, `/plugin uninstall lien@lien` then
`/plugin install lien@lien` to force a fresh snapshot.

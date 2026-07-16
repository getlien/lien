# Cross-Editor Agent Setup

Not using Claude Code? The [Claude Code plugin](/guide/claude-code-plugin) wires
Lien's nudges in via hooks — deterministic, fires on every matching tool call.
Most other agentic editors don't have an equivalent hook integration from Lien
yet, but nearly all of them read a plain instruction file already: a single
`AGENTS.md` at your repo root is read natively by Codex CLI, Cursor, Windsurf
(Cascade), GitHub Copilot, Devin, and Amp. `.github/copilot-instructions.md`
covers every Copilot surface the same way. Two files, five-plus tools raised
off the rules-file floor.

## Be honest about what this buys you

Lien's own [Claude Code plugin](/guide/claude-code-plugin#why-hooks-not-claude-md-rules)
page makes the case for hooks over rules-file text: a hook fires
deterministically regardless of what's still in the model's context, while a
written instruction is a standing suggestion competing for attention across a
long session, and a capable agent can still skip it under context pressure or
by taking a shortcut (e.g. reading a file via a shell command instead of its
native Read tool, which wouldn't trigger a hook either way even where hooks
exist). That's design rationale, not a citation — so here's what's actually
measured: a pre-registered A/B injecting Lien's real complexity warning into
a coding-agent prompt (N=8/condition) found the agent crossed its complexity
threshold in 8/8 control trials versus 3/8 with the warning present — every
trial that avoided crossing did so by extracting a helper function, matching
the warning's own wording, "prefer extraction" (see
[`docs/development/nudge-behavioral-ab.md`](https://github.com/getlien/lien/blob/main/docs/development/nudge-behavioral-ab.md)).
That study shows an injected signal changes behavior versus no signal at
all — it isn't a head-to-head of rules-file prose against a hook carrying the
identical instruction, and no such head-to-head is checked into this repo.
So: the blocks below are genuinely useful, strictly better than nothing, and
for the editors on this page they're currently the *only* nudge Lien can
offer — but treat compliance as best-effort, not guaranteed, and don't read
more evidence into that claim than exists above. If your editor gets a real
hook port later (see the roadmap below), that will raise the floor further.

## AGENTS.md — the universal block

Drop this at your repo root (or append it to an existing `AGENTS.md`). It's
plain markdown — copy it as-is:

```markdown
## Lien: query before you touch code

This repo is indexed by [Lien](https://lien.dev) (MCP). Before editing any
file, call `get_files_context` — check `testAssociations`, `imports`, and any
`complexityHeadroomWarning` in the response before you touch it (batch with
`filepaths: [...]` for multi-file edits). Before renaming, removing, or
changing the signature of an exported symbol, call `get_dependents` — a
`riskLevel` of `high` or `critical` means list the affected dependents before
proceeding. Before committing, run `lien delta`; treat any new
complexity-threshold crossing it reports as must-fix, not advisory.
```

That's the whole mandate — kept short deliberately. Every extra sentence
competes with the rest of your rules file for the same limited attention.

## GitHub Copilot — `.github/copilot-instructions.md`

This file is GA today and needs no opt-in: Copilot includes it automatically
in every chat request across VS Code, JetBrains, github.com, and Copilot CLI —
the single highest-reach, lowest-effort artifact of the two on this page. Same
content, same reasoning:

```markdown
## Lien: query before you touch code

This repo is indexed by [Lien](https://lien.dev) (MCP). Before editing any
file, call `get_files_context` — check `testAssociations`, `imports`, and any
`complexityHeadroomWarning` in the response before you touch it (batch with
`filepaths: [...]` for multi-file edits). Before renaming, removing, or
changing the signature of an exported symbol, call `get_dependents` — a
`riskLevel` of `high` or `critical` means list the affected dependents before
proceeding. Before committing, run `lien delta`; treat any new
complexity-threshold crossing it reports as must-fix, not advisory.
```

If you already have an `AGENTS.md`, Copilot reads that natively too — but
`.github/copilot-instructions.md` is the file Copilot's docs commit to
including in every chat request, so committing both removes any ambiguity
about which surfaces pick which file up.

## Windsurf / Cascade: one real caveat

Cascade reads `AGENTS.md` dynamically as it navigates your repo, so the block
above reaches it too — no extra file needed. The caveat, verified against
Cascade's own hook docs: Cascade's hook system (`pre_write_code`,
`pre_read_code`, and others) can log tool calls and hard-block them outright,
but hook output is never injected back into the model's context. That means
for Windsurf specifically, the `AGENTS.md` block above **is the entire nudge**
— there's no hook backstop underneath it the way there is for Claude Code.
Treat it as best-effort here more than anywhere else on this page.

## Codex CLI: already reading AGENTS.md today

Codex CLI auto-reads `AGENTS.md`, walking from its home directory down through
the project tree and concatenating what it finds — nothing to configure.
Codex's own hook system went stable in **v0.124.0 (April 23, 2026)**, with an
event schema close enough to Claude Code's own `PostToolUse`/`PreToolUse` pair
that a real port of Lien's hooks is plausible future work — not yet shipped.
Until then, the `AGENTS.md` block above is Codex's nudge floor.

## Cursor

Cursor also reads `AGENTS.md` natively, so the universal block covers it
without any extra setup. Cursor's hooks (introduced in Cursor 1.7,
[October 2025](https://www.infoq.com/news/2025/10/cursor-hooks/), GA as of
mid-2026) and its `.cursor/rules/*.mdc` targeting system are both richer than
a flat `AGENTS.md` — tracked as follow-up work, not shipped today.

## Roadmap: what's tracked next

This page ships the rules-file floor (step 1 of Lien's cross-editor plan).
Hook ports are follow-up work, in priority order:

| Environment | Ships today | Tracked next |
|---|---|---|
| Codex CLI | Reads `AGENTS.md` natively | Hook port (stable API since v0.124.0) |
| Cursor | Reads `AGENTS.md` natively | Hook port to `.cursor/hooks.json` (hooks GA as of mid-2026) |
| GitHub Copilot | `.github/copilot-instructions.md` (GA) | Hooks — stable in Copilot CLI, [Preview in VS Code](https://code.visualstudio.com/docs/agent-customization/hooks) since its Feb 2026 release; worth a beta label or a wait for GA |
| Windsurf/Cascade | Reads `AGENTS.md` natively | Optional `pre_write_code` hard-block script for the delta gate — additive, but can't carry the read-annotation nudge regardless (architecture limit, not effort) |
| Aider | Nothing yet | Not planned — [no native MCP support](https://github.com/Aider-AI/aider/issues/4506) as of mid-2026; a `--lint-cmd` wrapper around `lien delta` is the only workaround worth a doc note |

## Related pages

- [Claude Code Plugin](/guide/claude-code-plugin) — the hook-driven version of
  this same mandate, for Claude Code.
- [MCP Tools](/guide/mcp-tools) — parameters and response shapes for
  `get_files_context`, `get_dependents`, and the rest.
- [Quick Start](/guide/getting-started) — per-editor `lien init` setup if you
  haven't configured Lien's MCP server yet.

# The did-you-run-the-tests verification nudge

A session-scoped ledger that records which edited files have associated
tests and which Bash commands looked like test runs, and — at session
Stop — advises on any edited file whose associated tests were never
observed running. It closes the gap between `test-reminder.sh` (which
reminds an agent *which* tests to run right after an edit) and actual
verification: CLAUDE.md's "Verification Before Done" section has always
been honor-system, and nothing previously noticed whether the reminder was
ever acted on.

## Motivation

`test-reminder.sh` (see [Test Association](test-association.md)) fires
after every edit and names the associated test files, but that's a
one-shot nudge with no memory: if an agent reads the reminder and keeps
working without running anything, nothing notices. CLAUDE.md's own
"Verification Before Done" rule ("Never mark a task complete without
proving it works... Run tests") is exactly the kind of honor-system gap
`lien delta` closed for complexity and the blast-radius nudge closed for
`get_dependents` — this feature closes it for "did you actually run the
tests you were reminded about."

**Conservative by construction.** Tests can run in ways this ledger cannot
see (watch mode, an IDE, a wrapper script outside Claude Code's own Bash
tool). A false "you didn't test" nag would kill the nudge's credibility
fast, so every design decision below is biased toward silence: any broad
test run silences the whole report, coverage matching is deliberately
generous, and the advisory itself names the "I might be wrong" escape
hatch explicitly.

## What's built

- **A session-scoped ledger** (`packages/cli/src/utils/test-ledger.ts`):
  append-only JSONL, one file per session, recording `edit` events (a file
  with associated tests was edited) and `run` events (a Bash command
  looked like a test invocation). See section A.
- **A pure test-run classifier** (`packages/cli/src/utils/test-run-matcher.ts`):
  from a raw Bash command string alone, decides whether it's a recognized
  test runner, whether it ran broadly (whole suite/workspace) or narrowly
  (specific files), and whether a set of runs covers a set of edited
  files. See section B.
- **`lien verify-tests <subcommand>`** (`packages/cli/src/cli/verify-tests-cmd.ts`):
  `note-edit` (records + reminds, replacing `test-reminder.sh`'s old
  `annotate --tests-only` call), `note-run` (records silently), `report`
  (renders the advisory or nothing). See section C.
- **Three plugin hooks**: the rewired `test-reminder.sh` (PostToolUse:
  Edit/Write/MultiEdit), the new `test-run-note.sh` (PostToolUse: Bash),
  and the new `test-verify-stop.sh` (Stop — the model-visible surface).
  See section D.
- **Session-GC extensions**: `annotate-clean.sh` (SessionStart, 24h idle
  GC) and `annotate-end.sh` (SessionEnd) both now also clean up
  `test-sessions/`, mirroring how `annotated-sessions/` is already managed.

Not built (deliberately out of scope): surfacing the report during the
pre-commit `lien delta` gate — see "Why not wired into `lien delta`" below.

## A. The session ledger (`test-ledger.ts`)

One append-only JSONL file per session:
`<indexDir>/test-sessions/<sessionId>.jsonl`, sibling to
`delta-events.jsonl`/`blast-events.jsonl` under the same per-repo index
directory (`getIndexDir(rootDir)`). Append-only is the load-bearing choice:
the edit hook and the Bash hook fire independently and may interleave, so a
read-modify-write scheme would race; appending never can.

```ts
type TestLedgerEvent =
  | { kind: 'edit'; timestamp: string; file: string; tests: string[] }
  | { kind: 'run'; timestamp: string; command: string };
```

`sessionId` is validated against `^[A-Za-z0-9_-]+$` before it's ever used
in a path — the same defense-in-depth every shell hook in this bundle
already applies to a session ID that will be interpolated into a
filesystem path. An invalid ID makes every ledger operation a silent
no-op, never a thrown error.

`recordEdit`/`recordRun`/`readSession`/`clearSession` are all best-effort:
any I/O failure is swallowed. `LIEN_TEST_VERIFY=off` disables recording
only — `readSession` is never gated by the kill switch, so a report
requested after the switch was flipped mid-session still sees whatever was
recorded before.

Unlike `delta-events.jsonl`/`blast-events.jsonl` (both accumulate
indefinitely, trimmed only once they exceed a byte cap), a session's ledger
has a natural lifetime: it is deleted at `SessionEnd` (graceful exit) and
garbage-collected after 24h of inactivity at `SessionStart` (crash/force-quit
recovery) — the identical belt-and-braces pattern `annotated-sessions/`
already uses, just for files instead of directories.

## B. The pure classifier (`test-run-matcher.ts`)

Zero I/O, zero LLM — fully unit-testable with synthetic command strings.

### `classifyTestCommand(command)`

```ts
interface TestRunClassification { isTestRun: boolean; broad: boolean; scopeTokens: string[]; }
```

1. Splits the command on `&&`, `||`, `|`, `;` (so `cd packages/cli && npm
   test` still recognizes the runner keyword after the `cd`).
2. Matches each segment against a conservative allow-list of runner
   patterns: `npm test`/`npm run test`/`npm t`, `yarn test`, `pnpm test`,
   `bun test`, `npx vitest`/`vitest`, `jest`, `mocha`, `pytest`/`python -m
   pytest`, `go test`, `cargo test`/`cargo nextest`, `rspec`/`bundle exec
   rspec`, `phpunit`, `dotnet test`, `deno test`, `gradle test`, `mvn
   test`, plus workspace-scoped forms (`npm test -w <pkg>`, `pnpm --filter
   <pkg> test`, `nx test <proj>`).
3. For each matching segment, scans the remainder after the runner
   keyword for scoping arguments: a token is path-like if it contains `/`
   or ends in a source extension (reusing `getSupportedExtensions()` from
   `@liendev/parser` rather than hand-maintaining a second extension list —
   a test file shares its language's extension, so "ends in a source
   extension" already covers the test-ish case). Two token classes are
   excluded from ever counting as a scoping argument even though they can
   contain `/`: a workspace-scope flag's value (`-w`/`--workspace`/`--filter`,
   e.g. `@liendev/core`) and Go's glob-all convention (`./...`).
4. A segment with no scoping tokens is `broad` (whole-suite/workspace run);
   any `broad` segment makes the whole command's classification `broad`,
   even if another segment in the same command also named specific files.

### `computeUnverifiedFiles(edits, runs)`

- If **any** observed run is `broad`, returns `[]` — a plausible
  whole-suite/whole-workspace run is presumed to have exercised everything,
  so the report stays silent rather than risk a false nag against an
  incomplete per-file cross-check. This is the single biggest lever in the
  "conservative by construction" design.
- Otherwise, an edited file (with associated tests) is **covered** when
  any scoped run's token substring-matches — either direction,
  case-insensitive — the file's own basename or any of its associated
  tests' basenames. Generous on purpose: a run naming `foo.test.ts` covers
  an edit to `src/foo.ts`, and a run naming `src/foo.ts` itself also
  covers it.
- Uncovered files are returned as `{ file, tests }`.

## C. `lien verify-tests <subcommand>`

A command group (`packages/cli/src/cli/verify-tests-cmd.ts`), like `lien
config`. Every subcommand is fail-open by construction — session/file/
command are plain (not `commander`-required) options, and any error inside
a subcommand is swallowed before the process exits 0 — since these back
hooks that must never block the agent's tool call or trap it at Stop.

- **`note-edit --session <id> --file <path> [--format json]`** — a single
  `vectorDB.scanAll()` → `findTestAssociationsFromChunks`, the exact same
  cheap lookup `lien annotate --tests-only` already used (refactored into a
  shared `scanTestAssociations` helper in `annotate-cmd.ts` so both callers
  can never format the reminder differently). If the file has associated
  tests: `recordEdit` to the ledger **and** print the reminder line
  (`formatTestReminder`, reused verbatim — see "Byte-identity with the old
  `annotate --tests-only` output" below). No tests: prints nothing, records
  nothing.
- **`note-run --session <id> --command <cmd>`** — `classifyTestCommand`; if
  `isTestRun`, `recordRun`. No index touched at all — just classify and
  append.
- **`report --session <id> [--format json]`** — `readSession`, groups
  events into an `edits: Map<file, tests>` (last-write-wins per file — a
  file's test associations don't change mid-session) and a
  `runs: TestRunClassification[]`, then `computeUnverifiedFiles`. Prints
  the advisory (or nothing in text mode; `{unverified: [...]}` in JSON
  mode). Does **not** clear the ledger — that lifecycle belongs to the
  Stop hook's loop-prevention guard and the SessionEnd/SessionStart GC, not
  to a read.

### Byte-identity with the old `annotate --tests-only` output

`note-edit`'s reminder line must be identical to what `lien annotate <file>
--tests-only` printed before this feature existed, since `test-reminder.sh`
now calls `note-edit` instead — an agent's next-turn `<system-reminder>`
text must not change shape. Verified by construction (both paths call the
same `formatTestReminder`) and confirmed empirically: running both commands
against the same real file and diffing the output byte-for-byte produced
zero differences.

```
$ diff <(lien annotate packages/cli/src/cli/annotate-cmd.ts --tests-only) \
       <(lien verify-tests note-edit --session s --file packages/cli/src/cli/annotate-cmd.ts)
$ echo $?
0
```

## D. The three hooks

### 1. `test-reminder.sh` (existing, rewired)

`PostToolUse: Edit|Write|MultiEdit`. Was: shell out to `lien annotate <file>
--tests-only`. Now: shell out to `lien verify-tests note-edit --session
"$session_id" --file "$file_path"`. Same TTL-suppression (per file, per
session, 5-minute default), same `annotated-sessions/` touchfile directory,
same kill switch (`LIEN_TEST_REMINDER=off`) for the reminder itself, plus
the new `LIEN_TEST_VERIFY=off` for the ledger-recording side effect
specifically (so a user can disable FEATURE 2's tracking without losing the
reminder text). Recording is complete despite the TTL suppression: a file's
*first* edit in a session always passes the per-file TTL gate (no
touchfile yet), so the first — and therefore recordable — edit is never
skipped.

### 2. `test-run-note.sh` (new)

`PostToolUse: Bash`. A coarse shell-level keyword pre-filter (`case
"$command_str" in *test*|*vitest*|*jest*|*pytest*|*rspec*|*phpunit*|...`)
runs *before* shelling out to `lien` at all, so a routine non-test Bash
call (`ls`, `git status`, `cat`) spawns **no** `lien` process whatsoever —
the coarse filter is a strict superset of what `classifyTestCommand`
recognizes, so it never silently drops a real test run. On a match, calls
`lien verify-tests note-run --session "$session_id" --command
"$command_str"`. Emits **nothing** to the model on any path — recording
only, never a warning. Kill switch: `LIEN_TEST_VERIFY=off`.

### 3. `test-verify-stop.sh` (new — the model-visible surface)

`Stop`. Reads `stop_hook_active` from stdin first: `true` means this is a
re-entrant Stop after this hook already blocked once this episode, so it
exits 0 immediately — the loop-prevention guard that keeps the nudge to
"block at most once per stop episode," never an infinite back-and-forth.
Otherwise, shells out to `lien verify-tests report --session "$session_id"`
(text format — no JSON parsing needed; the CLI's own text output **is**
the `reason` string verbatim, so the hook does no message templating of
its own). If the report printed anything, emits
`{"decision":"block","reason":"<that text>"}`; if it printed nothing
(nothing unverified, or any resolution error), stays silent and allows the
stop. Kill switch: `LIEN_TEST_VERIFY=off`.

**Why `decision:block`, not `additionalContext`, for the Stop channel:**
the design that shipped this feature was written on the premise that Stop
hooks ignore `additionalContext` entirely and `decision:block` is the only
channel that reaches the model — see
[Claude Code Hook Output Channels](claude-code-hook-channels.md#stop-event-two-channels-not-one)
for a **correction** made during this feature's build: a fresh check of the
official docs found Stop actually supports *both* channels, with different
semantics (`additionalContext` is non-blocking; `decision:block` stops the
turn and forces one more). `decision:block` was still the right choice
here regardless of that correction — the nudge is deliberately a one-shot
"take one more look" interruption, not passive context the agent might
scroll past — but the channel doc's blanket "Stop ignores additionalContext"
claim needed updating once this discrepancy surfaced; see that section for
the current, corrected reference.

## Advisory wording (frozen)

```
Before finishing: these files you edited this session have associated tests I
did not observe running in a Bash command:
  • packages/cli/src/foo.ts → packages/cli/src/foo.test.ts
  • packages/core/src/bar.ts → packages/core/src/bar.test.ts
If you already ran them (watch mode, an IDE, or a wrapper this ledger can't see),
disregard and stop again. Otherwise, consider running them before you finish.
```

Each file shows its first associated test, with a `(+N more)` suffix when
there's more than one. The escape-hatch sentence is load-bearing: it's what
keeps a false positive reading as a gentle check rather than an accusation,
and it's the same design principle `blast-radius-nudge.md` and `lien
delta` both lean on — a warning that can't be wrong-but-graceful stops
being trustworthy the first time it's wrong.

## Why not wired into `lien delta`

The brief for this feature floated also surfacing the unverified-tests
report during the pre-commit `lien delta` gate. Declined: `lien delta` is
a stateless CLI gate with no session context — it has no `session_id`, so
it cannot read a session ledger. Forcing this in would mean inventing a
repo-global (non-session) ledger, a different and more false-positive-prone
design (unable to distinguish one agent session's edits from another's
running concurrently). The Stop hook is the correct session-scoped surface
for this signal; a manual `lien verify-tests report --session <id>` remains
available for scripting or debugging outside the hook pipeline.

## Failure modes (all fail-open)

| Failure | Behavior |
| --- | --- |
| No index (`note-edit`) | `scanAll` yields nothing → no associated tests found → records nothing, stays silent |
| Non-test Bash command | coarse shell pre-filter → no `lien` process spawned at all |
| Malformed stdin / missing `session_id` | hook exits 0 (Edit/Bash hooks: silent; Stop hook: allows the stop) |
| Invalid `session_id` characters | shell `case` guard rejects it; the CLI's own ledger validation also no-ops independently |
| `report` errors at Stop | Stop hook exits 0 → allows the stop, never traps the agent |
| `stop_hook_active == true` | exits 0 → allows the stop (loop prevention) |
| Ledger write/read fails | swallowed; recording is best-effort, `report` degrades to silent |

## Dogfood evidence (real hook stdin shapes)

Verified by piping the real PostToolUse/Stop payload shapes directly into
each script:

- **`test-run-note.sh`**: a real `tool_input.command: "npm test -w
  @liendev/cli -- path/to/foo.test.ts"` payload recorded a `run` event and
  emitted no stdout; a `tool_input.command: "git status"` payload spawned
  no `lien` process at all (confirmed via `bash -x` trace — execution never
  reaches the `lien` invocation line).
- **`test-verify-stop.sh`**: with one recorded unverified edit,
  `stop_hook_active: false` produced
  `{"decision":"block","reason":"Before finishing: ..."}`; recording a
  covering scoped run first and re-running the same payload produced empty
  stdout (silent, allows the stop); a `stop_hook_active: true` payload with
  the same unverified edit still present produced empty stdout (loop
  prevention).
- **Fail-open**: malformed (non-JSON) stdin and a payload missing
  `session_id` both exited 0 with no output, for both new hooks.
- **`test-reminder.sh` (rewired)**: a real `Edit` payload produced the
  identical `additionalContext` reminder text as before **and** recorded
  the edit into `test-sessions/<sessionId>.jsonl` in the same invocation —
  the "one process does both" goal driving the rewire.

## Behavioral A/B: null result

A pre-registered A/B tested whether the Stop advisory itself changes an
agent's next action. See
[Behavioral A/B: does the "tests not run" advisory change what an agent does
next?](../development/test-verification-nudge-ab.md) for the full protocol
and an honest null result: both conditions ran the named tests in 8/8
trials, and several **control** trials — which never saw the advisory —
independently invoked CLAUDE.md's "Verification Before Done" language, one
even inventing a reference to "the hook" it was never told about. Same
ceiling-effect class the sibling [blast-radius nudge
A/B](../development/blast-radius-nudge-ab.md) already documented: subagents
dispatched from within this repository appear to carry forward CLAUDE.md's
own rules regardless of the prompt under test.

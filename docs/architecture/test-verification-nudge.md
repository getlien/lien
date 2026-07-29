# The did-you-run-the-tests verification nudge

A session-scoped ledger that records which edited files have associated
tests and which Bash commands looked like test runs, and — at session
Stop — advises on any edited file whose associated tests were never
observed running. It closes the gap between `test-reminder.sh` (which
reminds an agent *which* tests to run right after an edit) and actual
verification: CLAUDE.md's "Verification Before Done" section has always
been honor-system, and nothing previously noticed whether the reminder was
ever acted on.

> **Consolidated into the session risk-ledger recap (2026-07).** The Stop
> surface described here — `test-verify-stop.sh` — has been replaced by
> `recap-stop.sh` / `lien recap`, which folds this unrun-tests advisory in
> **verbatim** (byte-identical when it is the only unresolved source)
> alongside two more sources (live complexity crossings, unacted blast-radius
> warnings). The ledger, classifier, and `verify-tests note-edit`/`note-run`
> recording paths below are unchanged and still populate the recap. See
> [session-risk-recap.md](session-risk-recap.md). Sections C/D below describe
> the original single-source hook, now superseded by that consolidated surface.

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
  | { kind: 'run'; timestamp: string; command: string }
  | { kind: 'blocked'; timestamp: string };
```

The third variant, `blocked`, was added during PR #843's review as a
loop-prevention fallback for the Stop hook — see section D.3's "Loop-
prevention fallback" note.

`sessionId` is validated against `^[A-Za-z0-9_-]+$` before it's ever used
in a path — the same defense-in-depth every shell hook in this bundle
already applies to a session ID that will be interpolated into a
filesystem path. An invalid ID makes every ledger operation a silent
no-op, never a thrown error.

`recordEdit`/`recordRun`/`readSession`/`clearSession` are all best-effort:
any I/O failure is swallowed. `LIEN_TEST_VERIFY=off` disables edit/run
recording only — the recap's loop-prevention `blocked` marker
(`recordBlocked`) is written regardless, governed by `LIEN_RECAP` instead;
`readSession` is never gated by the kill switch, so a report
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
   test` still recognizes the runner keyword after the `cd`), and strips
   any leading `VAR=value` environment assignments from each segment
   (`CI=1 npm test`, `NODE_ENV=test vitest`) so they don't defeat the
   runner-keyword match, which is anchored to the start of the segment.
2. Matches each segment against a conservative allow-list of runner
   patterns: `npm test`/`npm run test`/`npm t`, `yarn test`, `pnpm test`,
   `bun test`, `npx vitest`/`vitest`, `jest`, `mocha`, `pytest`/`python -m
   pytest`, `go test`, `cargo test`/`cargo nextest`, `rspec`/`bundle exec
   rspec`, `phpunit`, `dotnet test`, `deno test`, `gradle test`, `mvn
   test`, plus workspace-scoped forms (`npm test -w <pkg>`, `pnpm --filter
   <pkg> test`, `nx test <proj>`) and custom npm-script forms (`npm run
   test:e2e:python`, `yarn test:unit`, `pnpm test:unit` — this repo's own
   `npm run test:e2e:<lang>` convention, per CLAUDE.md's gate chain, is
   exactly this shape). npm's bare `npm test` shorthand has no such
   custom-name form, so it's left unextended.
3. For each matching segment, scans the remainder after the runner
   keyword for scoping arguments: a token is path-like if it contains `/`
   or ends in a source extension (reusing `getSupportedExtensions()` from
   `@liendev/parser` rather than hand-maintaining a second extension list —
   a test file shares its language's extension, so "ends in a source
   extension" already covers the test-ish case). Three token classes are
   excluded from ever counting as a scoping argument even when they'd
   otherwise qualify: a workspace-scope flag's value (`-w`/`--workspace`,
   e.g. `@liendev/core`, which contains a `/`), and a config-flag's value
   (`-c`/`--config`, e.g. `vitest.config.ts`, which ends in a source
   extension) or any bare token matching `*.config.*` even without a
   preceding flag, and Go's glob-all convention (`./...`).
4. Separately, the remainder is checked for a **name filter** — a flag
   from a per-runner-family allow-list (`pytest -k`/`-m`, `dotnet
   test`/`swift test --filter`, `rspec -e`/`--example`, `mocha
   --grep`/`-g`, `go test -run`, `vitest`/`jest -t`/`--testNamePattern`),
   or, for `cargo test` specifically, a bare positional argument (its own
   `[TESTNAME]` convention — see the deviation note below for why this
   can't just be "any bare leftover token"). A segment with a path-like
   scoping token is `scoped` regardless of any name filter also present
   (a path always wins). Otherwise: a name-filtered segment is neither
   `broad` nor a `scopeTokens` contributor (see below); only a segment with
   *no* scoping evidence of either kind is `broad`. Any `broad` segment
   makes the whole command's classification `broad`, even if another
   segment in the same command also named specific files or was itself
   name-filtered.

### `computeUnverifiedFiles(edits, runs)`

- If **any** observed run is `broad`, returns `[]` — a plausible
  whole-suite/whole-workspace run is presumed to have exercised everything,
  so the report stays silent rather than risk a false nag against an
  incomplete per-file cross-check. This is the single biggest lever in the
  "conservative by construction" design.
- Otherwise, an edited file (with associated tests) is **covered** when a
  scoped run's token exactly matches (case-insensitive) the file's own
  basename or an associated test's basename, or when their *stems* match —
  basename with one trailing extension and one trailing `.test`/`.spec`
  segment stripped, so `foo.test.ts` and `foo.ts` (or `foo.spec.ts`) share
  a stem. A run naming `foo.test.ts` covers an edit to `src/foo.ts`, and a
  run naming `src/foo.ts` itself also covers it — generous across
  directories and the `.test`/`.spec` convention, but no longer generous
  across unrelated names (see the deviation note below).
- Uncovered files are returned as `{ file, tests }`.

#### Deviation from generous substring matching (2026-07-24)

The original design (`.wip/nudge-design.md` section 2.2) specified coverage
matching as "any token substring match ⇒ covered," reasoning that
generosity in both directions — recognizing more commands as test runs, and
treating more edits as covered — was uniformly the safe, under-firing
direction. Built that way first; changed during PR #843's adversarial
review once a real failure mode surfaced: bidirectional substring
containment lets an **unrelated** run silently mark a file "covered" merely
because one filename happens to be a textual substring of another —
`vitest run src/oauth.test.ts` (ran) covering an edit to `auth.ts` (never
run), because `"auth"` is a substring of `"oauth"`; `superuser.test.ts`
covering `user.ts`; `data.test.ts` covering `a.ts`. Unlike runner
*recognition* (where over-matching only ever costs a wasted, harmless
check), over-matching *coverage* actively suppresses a real nag — a worse
failure mode than the false nag this feature is otherwise biased to avoid,
since a suppressed nag means a genuinely untested file silently reads as
verified. `isCoveredByScope` was tightened to exact-basename-or-stem
equality (see above) instead of substring containment; three regression
tests (`auth.ts`/`oauth.test.ts`, `user.ts`/`superuser.test.ts`,
`a.ts`/`data.test.ts`, all of which must still nag) pin this in
`test-run-matcher.test.ts`. Stem equality is deliberately scoped to the
`name.test.ext`/`name.spec.ext` convention only — other per-language test
naming conventions (Python's `test_foo.py`, Go's `foo_test.go`, Ruby's
`foo_spec.rb`) fall back to exact-basename matching, which already covers
the common case of a run naming the real associated test file.

#### Name-filtered runs are neither `broad` nor `scoped` (2026-07-29)

A run scoped by test **name** rather than file/directory (`pytest -k expr`,
`dotnet test --filter expr`, `go test -run regex`, a bare `cargo test name`,
...) has no path-like scope token at all. Before this fix, `classifyTestCommand`
had exactly two outcomes — `scoped` (path tokens found) or `broad` (none
found) — so every name-filtered run fell into `broad` by construction, and
`computeUnverifiedFiles`'s any-broad-run silence rule then marked the
*entire* session's edit set "verified" off the back of one arbitrarily-named,
unrelated test. Confirmed on the released 0.72.0: an edit with no test run at
all correctly nagged, but the identical edit followed by
`pytest -k test_totally_unrelated_name` went completely silent.

Fixed by adding a third classification outcome — name-filtered — reached
when the remainder carries recognized name-filter evidence (a
per-runner-family flag, or `cargo test`'s bare positional) but no path
token. A name-filtered run keeps `isTestRun: true` (something genuinely ran)
but sets neither `broad` nor a `scopeTokens` entry, so
`computeUnverifiedFiles` treats it exactly as if no run had been observed:
it neither silences the report nor "covers" any file. This is the same
fail-safe bias as the substring-matching deviation above — a false nag costs
one already-escape-hatched line of text, a false "everything is verified"
disables the whole mechanism.

The flag allow-list is deliberately **per runner family**, not one global
set, because two runners in this same allow-list reuse an identical short
flag spelling for unrelated purposes: tox's `-e ENV` selects which
*configured environment* to run (still that environment's whole suite — not
a named test), while rspec's `-e NAME` names one example. A global `-e`
recognition would have wrongly flipped `tox -e py311` (must stay `broad`)
into name-filtered. The same reasoning kept `cargo test <name>`'s bare
positional special-cased to exactly that runner (`POSITIONAL_NAME_FILTER_RUNNERS`
in `test-run-matcher.ts`) rather than "any bare leftover token" — the latter
would also have wrongly swallowed cargo-nextest's required `run` subcommand
keyword and Gradle's `-x <task>`/`--exclude-task <task>` exclusion value,
both bare tokens with unrelated meaning. `--filter` also moved out of the
workspace-scope flag set entirely: pnpm's `--filter <pkg> test` is fully
absorbed by its own anchored runner pattern before this scan ever runs, so
the shared spelling with dotnet/swift's name filter never collides in
practice.

##### A third instance of the same hazard, caught in review: `cargo test`'s own value-taking flags (2026-07-29)

Review of the fix above found that `cargo test`'s bare-positional detection
was too aggressive: `cargo test --features foo`, `-p my_crate`,
`--manifest-path <path>`, `--target <triple>`, `--profile <name>`, and `-j
<n>` all take a bare VALUE in the exact textual position a positional test
name would sit, and none of them narrow which tests run — the run stays
genuinely broad. Before this follow-up, that value was misread as a bare
positional test name (`sawBareToken`), flipping a genuinely broad run to
falsely name-filtered — the opposite direction from the original bug, but
still wrong, and a real regression relative to the pre-existing behavior for
these commands. Fixed by adding `CARGO_TEST_VALUE_FLAGS`
(`valueSkipFlagsFor` in `test-run-matcher.ts`), skipped as flag+value the
same way `WORKSPACE_SCOPE_FLAGS`/`CONFIG_FLAGS` already are, but kept
cargo-test-specific rather than global (a couple of these flag spellings,
e.g. `-j`, aren't universally safe to blanket-skip for every runner).

`--test <name>` (cargo's specific-integration-test-binary-target filter) is
deliberately excluded from that skip set: unlike the flags above, it
genuinely narrows which tests run, so its value is left to flow through as
an ordinary bare token — landing on the same name-filtered (not broad, not
falsely "scoped") outcome as a plain `cargo test <name>`, the safe fallback
for a target name this module has no infrastructure to resolve against a
real file path.

This is the **third** instance of the identical hazard class in one file
(bare/short-flag values misread across an unrelated boundary): tox `-e`
vs. rspec `-e`, cargo-nextest's `run` keyword vs. `cargo test`'s positional,
and now `cargo test`'s own compile-config flags vs. its own positional. All
three are now pinned as regression tests in `test-run-matcher.test.ts`.

##### A fourth instance: pnpm's own `--filter`/`-F` workspace selector (2026-07-29)

Review of the cargo fix above found one more case of the same hazard, then a
second, independent review of *that* claim corrected its direction: `pnpm
test --filter <selector>` (the workspace selector placed AFTER the script
name, rather than the `pnpm --filter <selector> test` form already absorbed
whole by its own anchored `RUNNER_PATTERNS` entry) has a selector value that
routinely contains `/` for a scoped package name (`@hono/core`). Without a
dedicated skip, that value was independently scanned by the generic
path-token check and misread as a real scope-narrowing FILE — flipping a
genuinely broad run to a falsely narrow "scoped to `./@hono/core`" (the
review's first pass called this a suppression risk; a second, independently
verified pass established the direction is actually the opposite — a false
NAG, not a false silence, since a broad-run-misread-as-scoped can only ever
*reduce* claimed coverage, never expand it). Fixed by adding
`PNPM_TEST_VALUE_FLAGS` (`--filter`, `-F`), skipped as flag+value via
`valueSkipFlagsFor` exactly like `CARGO_TEST_VALUE_FLAGS`, but gated on the
generic `pnpm test`/`pnpm test:script` match specifically (`isPnpmTestRunner`)
so dotnet/swift's unrelated test-NAME use of the identical `--filter`
spelling is untouched.

The same review also surfaced, independently of the misclassification bug,
that the `--filter=selector` single-token form placed BEFORE the script
(`pnpm --filter=@hono/core test`) matched no `RUNNER_PATTERNS` entry at all —
pnpm's own docs show this `=` form as the canonical way to write an
exclusion selector (`--filter=!foo`), so a real, documented, non-exotic
invocation always nagged. Fixed by widening the dedicated anchored pnpm
pattern to `(?:--filter|-F)(?:\s+\S+|=\S+)` (both the space and `=` forms,
both the long flag and its documented short alias).

A sweep of every other per-runner name-filter flag's `=` form (`pytest
-k=`/`-m=`, `rspec -e=`/`--example=`, `mocha --grep=`/`-g=`, `go test
-run=`, `vitest`/`jest -t=`/`--testNamePattern=`, `dotnet`/`swift
--filter=`) found no equivalent gap: `isNameFilterFlag`'s existing
`token.startsWith(`${flag}=`)` check already recognizes all of them —
verified directly against `classifyTestCommand`, all still correctly
name-filtered. A separate finding while investigating (`turbo test
--filter=web`) is NOT a `--filter` bug at all: `turbo` is not a recognized
runner in `RUNNER_PATTERNS` at all, so the command is simply unclassified
and falls through to the safe fail-open default (nags because no run was
ever recorded) — unrelated to this fix and out of scope (adding `turbo`
support was never requested and isn't a regression).

This is the **fourth** instance of the identical short-flag/value-collision
hazard class in this file. A generalized "flag arity table" (mapping every
recognized flag per runner to a consumes-value/semantics tag) was considered
in place of a fourth targeted allow-list entry, but rejected for now: the
existing per-concern, per-runner-family lookup idiom (`nameFilterFlagsFor`,
`valueSkipFlagsFor`) already generalizes to this fourth case with one small,
independently testable addition each, matching this module's stated
conservative-allow-list philosophy; a unified table would be a structural
reorganization with no additional correctness benefit over what's here,
and would cost a larger, riskier diff for a module already this
security-sensitive to the nudge's credibility.

##### A scope-broadening flag does NOT make a name-filtered run `broad` — selection and scope are independent axes (2026-07-30)

A review pass suggested that `go test -run TestFoo ./...` /
`go test -run TestFoo .` and `cargo test foo --workspace` /
`cargo test foo --all` should classify as `broad`, on the reasoning that
`./...`/`--workspace`/`--all` are "broad-scope indicators." **This is wrong,
and the classifier's existing behavior (no change needed) is correct** —
verified directly against `classifyTestCommand` and independently re-verified
against a real Go module (gin) with `internal/bytesconv` (4 test functions,
none named `TestFoo`):

```
go test -run TestFoo ./...      => name-filtered (NAGS)  -- executes none of bytesconv's 4 tests
go test -run TestFoo .          => name-filtered (NAGS)
cargo test foo --workspace      => name-filtered (NAGS)
cargo test foo --all            => name-filtered (NAGS)
go test ./...                   => broad (SILENT)  -- no name filter, real whole-suite coverage
cargo test --workspace          => broad (SILENT)
cargo test --all                => broad (SILENT)
```

The reasoning: **which packages/crates get compiled and which tests within
them actually execute are two independent axes.** `./...`/`--workspace`/
`--all` answer the first question (compile everything reachable) — genuinely
scope-broadening, correctly contributing no scoping restriction on their
own. `-run TestFoo` / a bare positional test name answer the second,
completely orthogonal question (of the tests that got compiled, run only
ones matching this name) — and that restriction does not evaporate just
because the first axis was maximally broadened. `go test -run TestFoo ./...`
compiles every package in the module and then, within each one, runs only
tests whose name matches `TestFoo` — the overwhelming majority of real test
functions across the module (e.g. all 4 in `bytesconv`, none named `TestFoo`)
never execute. Treating this as `broad` would make it functionally identical
to running nothing at all while still marking every edited file in the
session "verified" — precisely the false-"tests ran" bug this whole feature
exists to close, just reached via a scope flag instead of a bare name.

The classifier already gets this right by construction, not by any special
case: a scope-broadening flag either lands in a genuinely orthogonal
skip-flag set (`--workspace`/`-w` in the global `WORKSPACE_SCOPE_FLAGS`,
consumed as flag+value and contributing nothing) or is excluded from
path-likeness entirely (`./...` via `GLOB_ALL_TOKENS`) — in both cases it
simply produces **no scoping evidence of its own**, neither for nor against
name-filtering. The *separate* name-filter evidence (`-run`'s presence, or
cargo's bare positional) is tracked independently and is what actually
decides `broad` vs. name-filtered here; a scope flag appearing in the same
command never suppresses that independently-collected evidence. This is
exactly the axis-independence the `--workspace`/`--all`/`./...` case
requires, achieved for free by not having any code path that treats "a
scope flag is present" as license to ignore other evidence in the same
segment. **Do not "fix" this by making a scope-broadening flag force
`broad` regardless of a name filter also present in the same command** — that
is, verbatim, the false-silence bug from the top of this document, just
triggered by a different flag.

Regression tests for all seven commands above are pinned in
`test-run-matcher.test.ts`.

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

### 3. `test-verify-stop.sh` (SUPERSEDED by `recap-stop.sh` — was the model-visible surface)

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

#### Loop-prevention fallback: `stop_hook_active`'s existence couldn't be confirmed (2026-07-24)

During PR #843's adversarial review, a dedicated check (a `claude-code-guide`
agent, plus two direct fetches of the official hooks reference) could not
consistently confirm that Claude Code's real `Stop` hook stdin actually
includes a `stop_hook_active` field: three independent fetches of the same
documentation returned three different field lists for the `Stop` event,
one of which included `stop_hook_active` and two of which didn't (one
instead listed an unrelated `stop_reason` field). Rather than resolve this
by trusting whichever fetch was most convenient, the uncertain result was
treated as "unconfirmed" and a second, ledger-based loop-prevention
mechanism was added as a fallback that holds regardless of whether
`stop_hook_active` is ever actually populated:

- `report` records a `{ kind: 'blocked', timestamp }` event to the session
  ledger the first time it emits a non-empty advisory.
- On every subsequent `report` call, `wasRecentlyBlocked` (pure, unit-tested
  in `verify-tests-cmd.ts`) checks whether a `blocked` event exists within
  the last `BLOCK_SUPPRESSION_WINDOW_MS` (10 minutes, not configurable). If
  so, the report is treated as clean (empty `unverified`) even if the
  underlying edits are still genuinely unverified — applied uniformly to
  both `--format text` and `--format json`, so `report` has one consistent
  answer to "is there something to nudge about right now," not two
  format-dependent ones.
- `stop_hook_active` stays as the first line of defense (free if the field
  ever is populated in a given Claude Code version); the ledger-based
  10-minute suppression is the mechanism that actually holds if it isn't.

10 minutes was chosen to be long enough that a real editing session won't
re-nag on every single Stop, short enough that a genuinely new unverified
edit later in a long session still eventually gets flagged again once the
window lapses.

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

## Known limitations

**Coverage matching is directory-blind.** `isCoveredByScope` compares
basenames (and stems), not full paths, so when two edited files in the same
session happen to share an associated-test basename — the common case
being a per-module `index.ts` → `index.test.ts` naming convention repeated
across several packages — a scoped run that covers one silently covers the
other too, even if the other's test was never actually run. This is a
missed advisory, the safe direction this feature is biased toward
throughout, not a false nag; and in practice it's largely masked by the
any-broad-run silence rule, since a session that touched multiple files
under the same test-file naming convention typically ends in a broad run
anyway (see "Conservative by construction" above). If this ever proves to
matter in practice, the fix is to fall back to directory-qualified path
comparison specifically when two or more pending files' basenames collide,
rather than widening the match further.

## Failure modes (all fail-open)

| Failure | Behavior |
| --- | --- |
| No index (`note-edit`) | `scanAll` yields nothing → no associated tests found → records nothing, stays silent |
| Non-test Bash command | coarse shell pre-filter → no `lien` process spawned at all |
| Malformed stdin / missing `session_id` | hook exits 0 (Edit/Bash hooks: silent; Stop hook: allows the stop) |
| Invalid `session_id` characters | shell `case` guard rejects it; the CLI's own ledger validation also no-ops independently |
| `report` errors at Stop | Stop hook exits 0 → allows the stop, never traps the agent |
| `stop_hook_active == true` | exits 0 → allows the stop (loop prevention, first line of defense) |
| Blocked within the last 10 minutes | `report` treats the session as clean regardless of `stop_hook_active` (loop prevention, second line of defense — see the "Loop-prevention fallback" note) |
| Ledger write/read fails | swallowed; recording is best-effort, `report` degrades to silent |

## Dogfood evidence (real hook stdin shapes)

Verified by piping the real PostToolUse/Stop payload shapes directly into
each script:

- **`test-run-note.sh`**: a real `tool_input.command: "npm test -w
  @liendev/lien -- path/to/foo.test.ts"` payload recorded a `run` event and
  emitted no stdout; a `tool_input.command: "git status"` payload spawned
  no `lien` process at all (confirmed via `bash -x` trace — execution never
  reaches the `lien` invocation line).
- **`test-verify-stop.sh`**: with one recorded unverified edit,
  `stop_hook_active: false` produced
  `{"decision":"block","reason":"Before finishing: ..."}`; recording a
  covering scoped run first and re-running the same payload produced empty
  stdout (silent, allows the stop); a `stop_hook_active: true` payload with
  the same unverified edit still present produced empty stdout (loop
  prevention). **The ledger-based fallback specifically**: sending the exact
  same `stop_hook_active: false` payload a *second* time immediately after
  the first (real) block — i.e. simulating the scenario where Claude Code
  does NOT actually set `stop_hook_active: true` on the re-entrant Stop —
  also produced empty stdout, because `report` found its own just-recorded
  `blocked` event inside the 10-minute suppression window. This is the case
  the fallback exists for: loop prevention that holds even if
  `stop_hook_active` never arrives.
- **Fail-open**: malformed (non-JSON) stdin and a payload missing
  `session_id` both exited 0 with no output, for both new hooks.
- **Name-filtered runs (2026-07-29)**, dogfooded end-to-end in a
  foreign repo (flask, not this one) via `test-reminder.sh`/`test-run-note.sh`
  with real stdin: an edit + a `tool_input.command: "pytest -k
  test_totally_unrelated_name"` payload, on the pre-fix build, produced
  empty `report` output (the bug); the identical sequence on the fixed
  build produced the full advisory, matching the no-run control exactly.
  A genuinely broad run (`python -m pytest`, no filter) still produced
  empty `report` output on the fixed build (no regression), and a
  file-scoped run naming an unrelated file (`pytest
  tests/test_totally_unrelated_module.py`) still nagged.
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

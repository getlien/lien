# The session risk-ledger recap

A single Stop-time advisory that re-raises UNRESOLVED risk from the current
session at the finish line. A nudge delivered at minute 5 — a complexity
crossing, a blast-radius warning, a "did you run the tests" reminder — is gone
from the model's context by minute 90. The recap consolidates three
per-session signals and surfaces whatever is *still* unresolved when the agent
tries to stop, as one block the model sees exactly once.

It replaces `test-verify-stop.sh` (the single-source did-you-run-the-tests Stop
hook from [#843](test-verification-nudge.md)): the unrun-tests advisory is
folded in verbatim, alongside two more sources — unresolved complexity
crossings and unacted blast-radius warnings.

## Motivation

Lien already emits three edit-time nudges (see
[lien-delta.md](lien-delta.md), [blast-radius-nudge.md](blast-radius-nudge.md),
[test-verification-nudge.md](test-verification-nudge.md)). Each fires once, in
the moment, then scrolls out of context. The one that had a finish-line surface
— the did-you-run-the-tests nudge — proved the shape works: block once at Stop
with an advisory the agent can act on or dismiss. This feature generalizes that
surface from one signal to three, and keeps it to **exactly one block per stop
episode** so the finish line never becomes a wall of separate interruptions.

**Credibility is the whole game.** A recap item the agent already fixed reads as
noise and kills trust the first time it happens — worse than staying silent. So
every source is an *unresolved-only* join: it surfaces a concern only when the
session's own records (or the live working tree) show it was never addressed.

## What's built

- **The pure aggregation** (`packages/cli/src/utils/session-recap.ts`): joins
  three already-gathered sources into a recap, and renders the delta/blast
  sections. Zero I/O, unit-tested with synthetic sequences. See section A.
- **`lien recap --session <id>`** (`packages/cli/src/cli/recap-cmd.ts`): the
  command that gathers the sources (including the delta source's live
  recompute), applies loop-prevention, and prints the advisory (text) or the
  structured recap (`--format json`). See section B.
- **The `recap-stop.sh` Stop hook** (`plugins/claude/hooks/recap-stop.sh`):
  replaces `test-verify-stop.sh`, shells out to `lien recap`, and wraps its text
  output in `{"decision":"block","reason":...}`. See section C.

**Not built — the PreCompact half (dropped, with evidence).** The brief scoped
a second surface: inject the recap into the summary just before context
compaction, so open items carry forward. This was dropped after verifying it
isn't buildable on a documented channel — see "Why Stop-only" below.

## A. The three sources (all UNRESOLVED-only)

Each source is a "shown-but-not-resolved" join. The command wrapper gathers the
inputs; the pure module joins them.

### 1. Unrun tests — reused verbatim

`computeUnverifiedFiles(edits, runs)` from
[test-verification-nudge.md](test-verification-nudge.md), fed by the same
`splitSessionEvents` over the same session ledger. **Not reimplemented** — the
recap imports the exact function and the exact frozen advisory
(`formatVerifyTestsAdvisory`), so this section's wording and its broad-run /
coverage rules are byte-for-byte what `test-verify-stop.sh` produced. Resolution
is `computeUnverifiedFiles`'s own: an edited file with associated tests that no
observed test run covered.

### 2. Unresolved complexity crossings — a LIVE delta recompute

The delta source is the design decision that mattered most, and it deliberately
does **not** mine `delta-events.jsonl`. Three facts about that log forced the
choice (all verified against the code, not assumed):

- **No `session_id`.** A `DeltaEvent` carries only a `timestamp`, so there is no
  clean session join — only a lossy time window, which would leak crossings from
  a concurrent run on the same repo.
- **No before/after values.** `flagged[]` is `{filepath, symbol, metric}` — it
  cannot render "cognitive 18 (was 12)".
- **Ambiguous resolution.** A clean `lien delta --file` run records
  `flagged: []` with no record of *which* file it examined, so "seen clean
  later" (as `delta-stats`'s `resolvedAfterFlag` uses) can't be scoped to a
  specific file — any later clean edit would falsely mark everything resolved.

Instead, the recap asks the **same question `lien delta` asks, live at Stop**:
it runs `computeComplexityDelta` (the shared primitive, reused via
`collectFileChange`) on the files this session touched, working tree vs `HEAD`.
This is *stronger* than any event-log join, not weaker:

- **Credible by construction.** A crossing the agent already simplified reads
  clean in the working tree *right now* and never appears — no stale event to
  mistrust. (Dogfood C3 below demonstrates exactly this: reverting the crossing
  makes the delta item vanish.)
- **Numerically rich.** It has the real before/after values, rendered with
  `lien delta`'s own `fmtValue`.
- **Can't diverge from `lien delta`.** Same primitive, same thresholds
  (`resolveDeltaThresholds` over the project's `.lien.config.json`).

**Session scoping.** "Files this session touched" is the union of the session
ledger's `edit` files and this session's `nudge-events` `file` fields
(get_files_context / get_dependents signals and shown nudges — the mandatory
pre-edit `get_files_context` call means an edited file is almost always in
here). A crossing is surfaced only when its file is in that set, so a crossing
in a file this session never worked on is not attributed to it. If the set is
empty (a session that recorded nothing), the delta source contributes nothing.

**Honest limitation.** Scoping rests on `git diff HEAD` (working tree) intersected
with session-touched files. It cannot separate this session's uncommitted change
in `hot.ts` from *another* concurrent agent's uncommitted change in the same
`hot.ts` — but per-worktree index isolation and one-agent-per-worktree make that
overlap rare, and the working-tree state genuinely *is* unresolved risk at the
finish line regardless of who authored it. A crossing the agent already
**committed** does not surface (it's in `HEAD`, so the working tree reads clean);
that's the `lien delta` pre-commit gate's job, a strictly earlier surface.

### 3. Unacted blast-radius warnings

`computeUnactedBlastNudges(events, sessionId)` inverts `nudge-stats.ts`'s blast
matched-join: a blast `shown` event (recorded by `api-delta-write.sh` at edit
time) is UNRESOLVED unless a `get_dependents` signal at or after its earliest
shown timestamp names the same symbol, or a file it was shown for. Deduped by
symbol, most-recently-shown first. A shown event with no `symbol` is skipped
(can't render or match it) — a silent miss in the safe direction. The rule
mirrors `isActedOn`'s `blast` case exactly, so the recap and the `lien stats`
funnel agree on what "acted-on" means.

## B. `lien recap --session <id>`

`packages/cli/src/cli/recap-cmd.ts`. Fail-open by construction, like
`verify-tests`: any error is swallowed and the process still exits 0 (it backs a
Stop hook that must never trap the agent), and a missing/invalid `--session` is a
silent no-op.

Flow: resolve the project root, read the session ledger + nudge-events, gather
the three sources (the delta source does the live git/parse work, all wrapped in
try/catch → `[]` on any failure), assemble the recap, then:

- **Empty recap** → print nothing (text) / `{tests,delta,blast,suppressed:false}`
  with empty arrays (json). Silent, no block.
- **Recently blocked** (see loop-prevention) → suppressed; print nothing (text) /
  `suppressed:true` (json).
- **Otherwise** → record the `blocked` marker, (re)populate the `test-verify`
  funnel's shown side when the tests section fired, and print the stacked
  advisory (text) / the full recap (json).

**Section order and the frozen-tests guarantee.** The text stacks *delta, blast,
then the tests advisory last*. Each section is self-contained (its own opener and
escape-hatch closer) so the recap never has to paraphrase the frozen tests
advisory to fit a merged frame. Putting tests last guarantees a **tests-only
recap is byte-identical to the old `verify-tests report`** output (dogfood C1),
so nothing regressed for the common single-source case; the whole stack is one
`decision:block` reason.

**Caps.** Delta and blast each show at most `MAX_RECAP_ITEMS_PER_SECTION` (3),
worst-first (delta) / most-recent-first (blast), with a `(+N more)` line. The
tests section keeps its established, uncapped per-file listing.

**Kill switch.** `LIEN_RECAP=off` disables the whole Stop recap surface
(checked in both the command and the hook).

## C. The `recap-stop.sh` Stop hook

Mirrors `test-verify-stop.sh`'s structure: `command -v jq`, source
`lien-resolve.sh`, `LIEN_RECAP=off` kill switch, read `stop_hook_active` /
`session_id` / `cwd` from stdin, harden `session_id` against path traversal,
shell out to `lien recap --session <id>` from the session's `cwd`, and — when the
recap printed anything — emit `{"decision":"block","reason":"<that text>"}`. The
recap's own text output IS the `reason` verbatim; the hook does no message
templating. Silent (`exit 0`, no output) on an empty recap, a suppressed one, a
resolution error, malformed stdin, or a missing `session_id`.

`{"decision":"block","reason":...}` is the deliberate channel (see
[claude-code-hook-channels.md](claude-code-hook-channels.md)'s Stop section): the
recap is a one-shot "take one more look before you finish" interruption, not
passive `additionalContext` the agent might scroll past.

### Exactly one block per stop episode — both #843 layers kept

The recap consolidates all three sources behind a **single** block, and keeps
both loop-prevention layers from #843 so it never nags twice for one episode:

1. **`stop_hook_active`** (first line of defense): the hook exits 0 immediately
   on a re-entrant Stop, free if Claude Code populates the field.
2. **Ledger recent-block suppression** (second line): `lien recap` records a
   `{kind:'blocked'}` event to the session ledger when it emits, and treats the
   session as clean if `wasRecentlyBlocked` finds one inside
   `BLOCK_SUPPRESSION_WINDOW_MS` (10 min). This holds even if `stop_hook_active`
   is never populated in a given Claude Code version — the reason #843 added it.

The recap reuses the *same* `blocked` event and `wasRecentlyBlocked` as #843, so
there is exactly one suppression window covering ALL recap content, not one per
source. One change was required: `recordBlocked` is now exempt from the
`LIEN_TEST_VERIFY=off` recording gate, because the `blocked` marker is now the
recap's loop-prevention (gated by `LIEN_RECAP` at the call site) — a
delta/blast-only recap, with test-verify recording off, must still be able to
suppress its own re-nag.

## Why Stop-only: the PreCompact half was dropped (verified)

The brief scoped a second surface — inject the recap into the summary just
before compaction so open items survive into the compacted context — but made it
conditional on verifying a real channel exists first ("do not build on an
unverified channel"). It does not. Verified against the official Claude Code
hooks docs (via a `claude-code-guide` agent cross-checking multiple fetches):

- A `PreCompact` hook receives `session_id`, `transcript_path`, `cwd`,
  `hook_event_name`, and `compact_trigger` (`manual`/`auto`).
- Its **only** documented output is decision control:
  `{"decision":"block",...}` (or exit 2) *blocks compaction* and shows the
  reason to the **user** — it is not a context-injection channel.
- There is **no** documented `additionalContext` for `PreCompact`, and **no**
  documented way for its output to steer the compaction summary or survive into
  the post-compaction context. (The documented pattern for post-compaction
  context is a `SessionStart` hook with a `compact` matcher, which fires *after*
  compaction — a different mechanism, out of scope here and a possible future
  follow-up.)

So the "before compaction" half is not buildable as scoped, and the recap ships
Stop-only. The `lien recap` command is session-scoped and reusable, so a future
`SessionStart:compact` surface could call it unchanged.

## Failure modes (all fail-open)

| Failure | Behavior |
| --- | --- |
| Malformed stdin / missing `session_id` | hook exits 0, allows the stop (silent) |
| Invalid `session_id` characters | shell `case` guard rejects it; the CLI's own ledger/path validation also no-ops |
| Not a git repo (delta) | `collectFileChange` throws → caught → delta source contributes `[]` |
| Config load fails (delta) | falls back to default thresholds |
| Malformed ledger / nudge-events line | skipped on read (per-line), never fails the whole recap |
| `lien recap` errors at Stop | hook sees empty output → exits 0 → allows the stop |
| `stop_hook_active == true` | hook exits 0 (loop prevention, first line) |
| Blocked within the last 10 min | `recap` treats the session as clean regardless of `stop_hook_active` (loop prevention, second line) |
| `LIEN_RECAP=off` | whole recap surface disabled, silent |

## Dogfood evidence (real hook stdin shapes)

Verified end-to-end against an isolated temp repo with a real committed
baseline, a real working-tree complexity crossing, and fabricated session
ledger / nudge-events, driving `recap-stop.sh` with the real Stop payload shape
(a `lien` shim pointed the hook at the built CLI).

- **Full recap blocks once.** `{session_id, cwd, stop_hook_active:false}` with a
  live crossing (`computeFoo` cognitive 0→36), an unacted blast
  (`parseThing`), and an unrun test (`src/mod.ts`) produced a single
  `{"decision":"block","reason":"…"}` whose `reason` stacked all three sections
  (delta, blast, then the frozen tests advisory).
- **Identical replay is silent.** Re-sending the same payload produced empty
  output — the ledger `blocked` marker from the first block suppressed the
  second (loop prevention that holds without `stop_hook_active`).
- **`stop_hook_active:true` is silent** even with open items still present
  (first-line guard).
- **Everything resolved is silent.** A session with a broad test run (tests
  covered), no touched-file crossing, and no unacted blast produced empty output.
- **Fail-open.** Non-JSON stdin and a payload missing `session_id` both exited 0
  with no output.
- **`LIEN_RECAP=off` is silent** even with open items.
- **Tests-only is byte-identical** to `verify-tests report` for the same
  unverified set (`diff` produced no output) — the frozen advisory is preserved.
- **Credibility axis (the load-bearing one).** Reverting the working-tree
  crossing so `computeFoo` drops back under threshold made the delta section
  disappear from the very next recap (`delta: []`), with the tests section
  unchanged — a fixed concern is never re-raised, because the delta source reads
  the live working tree rather than a stale event log.

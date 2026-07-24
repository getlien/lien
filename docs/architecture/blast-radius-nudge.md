# The blast-radius nudge: `get_dependents` before an exported-signature edit

`lien api-delta` detects, at edit time and from content alone, when a working-tree
change altered or removed the signature of an **exported top-level function or
exported class method** — the two shapes covered, not "any exported symbol" (see
"Known limitations" for what's out of scope) — and turns that into a CLI exit
code, a warning from the plugin's post-edit hook, and a local event log
(`lien stats`) tracking how often it fires. It extends the `lien delta` pattern
(deterministic core → thin hook → local JSONL ledger) to the other mandatory rule
in CLAUDE.md that was still honor-system: "run `get_dependents` before changing
the signature of an exported symbol." Within its covered shapes it's a nudge for
that rule, not a complete enforcement of it.

## Motivation

CLAUDE.md has had two "before you touch an exported symbol" rules for a while.
`lien delta` (see [lien-delta.md](lien-delta.md)) automates the complexity rule —
an agent gets warned the moment a function crosses a threshold, not after review.
The `get_dependents` rule had no equivalent: nothing at edit time noticed that a
signature change would break every caller of the old shape, or that deleting an
export would break them outright. The gap was pure trust that the agent would
remember to check.

## What's built

- **The detection primitive** (`packages/cli/src/utils/signature-delta.ts`):
  computes, from two content strings, which exported functions/methods had their
  signature changed or their export dropped. See section A.
- **The `lien api-delta` CLI** (`packages/cli/src/cli/api-delta-cmd.ts`): runs the
  primitive against `HEAD` or `--base <ref>`, enriches with dependent counts and
  risk when the index is available, and prints a report. Advisory only — there is
  no gate, unlike `lien delta`. See section B.
- **A PostToolUse hook** (`plugins/claude/hooks/api-delta-write.sh`): warns once,
  right after an `Edit`/`Write`/`MultiEdit`, when that edit changed or removed an
  exported signature. See section C.
- **An event log and a `lien stats` section**: a local JSONL log of every edit
  that changed an exported signature, aggregated into 7- and 30-day windows,
  additive to `lien stats`'s existing JSON shape. See section D.

Not built (deliberately out of scope for this feature): a `PreToolUse` variant,
a gate/exit-1 mode, and a CI backstop job. `lien delta`'s CI job
(`.github/workflows/ci.yml`'s `delta` job) exists because the complexity rule is
a pass/fail gate; this feature has no such notion — it's an advisory nudge, so
there is nothing for a CI job to fail on. See "Why advisory, not a gate" below.

## A. The detection primitive (`signature-delta.ts`)

### How it reuses existing machinery

Like `computeComplexityDelta` (`packages/parser/src/insights/complexity-delta.ts`),
this is pure and content-only: it calls the existing `chunkFile(path, content, {
useAST: true, astFallback: 'line-based' })` on a "before" and an "after" content
string and compares per-function metadata. No new parsing, no git plumbing of its
own — the CLI layer reuses `delta-git.ts`'s existing `collectFileChange` /
`collectFileChanges` (the same collectors `lien delta` uses).

Per-chunk metadata already carries everything needed:

- `metadata.exports: string[]` — the file's exported-name list, identical on
  every chunk in that file (it's file-level, not per-symbol).
- `metadata.signature: string` — the function/method's declaration signature.
- `metadata.symbolType`, `metadata.symbolName`, `metadata.parentClass`.

**What "exported" means for a chunk:**

- A top-level `function` chunk is exported when its own `symbolName` is in
  `exports`.
- A `method` chunk is exported when its **`parentClass`** is in `exports` —
  methods never appear in `exports` by name; an exported class's public methods
  are part of the API surface, and breaking their signature breaks callers the
  same way breaking a top-level exported function does.
- Hard-private JS methods (`symbolName` starting with `#`) are filtered out
  before classification ever runs: changing or removing one can never break an
  external caller, so they are never flagged even on an exported class.

This "exported" rule was verified empirically against the built parser before
any detection logic was written (a throwaway script asserting `exports`/
`signature`/`parentClass` population on function, method, and private-method
chunks) — not assumed from the type declarations alone.

### Matching functions across versions

Identical to `complexity-delta.ts`'s `functionMetadataByKey`: functions are
matched by the qualified key `` `${parentClass ?? ''}::${symbolName}` ``, with
same-keyed functions on either side paired positionally by ascending `startLine`.
Reusing the exact matching logic means the two detectors — complexity and
exported-signature — can never structurally disagree about what counts as "the
same function across an edit."

**The positional-pairing mechanism does not actually engage for TypeScript's
canonical overload-declaration pattern.** Verified empirically: chunking a
function with two `declare`-only overload signatures followed by one
implementation produces a *single* function chunk (the implementation), not
three — the overload declaration lines (no body) aren't emitted as their own
`symbolName`-bearing chunks at all, so there is never more than one chunk per
qualified key for this shape. The positional-pairing code exists (inherited
unchanged from `complexity-delta.ts`, so the two detectors stay in lockstep for
whatever cases *do* produce multiple same-keyed chunks) but it has no effect
here: an edit that changes only an overload declaration's signature, leaving
the implementation signature untouched, is a **silent miss** — `signature-delta`
only ever sees the implementation chunk's signature, which didn't change.

### Classification

For each matched (before?, after?) pair:

- **Not exported before** (on either side): silent, always — including a
  newly-added export (rule: adding an export breaks no existing caller, so there
  is no signal to surface).
- **Exported before, not exported after** (deleted, or the `export` keyword was
  dropped while the function still exists): `removed` — the highest-blast-radius
  case, since every existing caller will break.
- **Exported on both sides, signature unchanged**: silent (the common case for
  most edits — a body-only change).
- **Exported on both sides, signature changed**: `signature-changed`, carrying
  both the before and after signature strings.

Changes are sorted worst-first (`removed` before `signature-changed`) so a
truncated top-N list (the hook shows at most 3) always surfaces the highest-risk
change first.

```ts
interface ExportedSymbolChange {
  symbol: string; // display name, parentClass-qualified: "Foo.bar"
  symbolName: string; // bare name, for get_dependents / findDependents
  parentClass?: string;
  kind: 'signature-changed' | 'removed';
  beforeSignature?: string; // present only for 'signature-changed'
  afterSignature?: string; // present only for 'signature-changed'
}
```

Pure, content-only, fully unit-testable with two content strings — zero LLM,
zero index, zero git (see `signature-delta.test.ts`).

## B. The `lien api-delta` CLI command

`packages/cli/src/cli/api-delta-cmd.ts`, registered in `packages/cli/src/cli/index.ts`.
Parallels `lien delta`'s shape (`--file <path>`, `--base <ref>`, `--format
text|json`) but drops `--soft` and `--threshold`: there is no gate to soften and
no numeric threshold to tune.

1. Resolve the repo root (`getRepoRoot`); not a git repo exits 2.
2. Build the `FileContentChange`(s) via the reused delta-git collectors —
   `--file` for the hook's single-file fast path, or the whole working tree.
3. Run `computeExportedSignatureDelta` per file.
4. **Enrich, best-effort** (section below).
5. Record one ledger event per file with at least one change (section D).
6. Print the report; **exit 0 always** — this is advisory, not a gate, so
   there's no exit-1 concept the way `lien delta` has one.

### Enrichment: dependent counts and risk, best-effort

Only runs when at least one change was found (the rare event, so the common
edit — no exported-signature change — pays only the cheap content check and
never touches the index). For each changed symbol, calls the existing
`findDependents(vectorDB, filepath, log, symbolName, indexVersion)` and composes
a risk level via the shared `computeBlastRadiusRisk` primitive — the same two
calls `get_dependents` and `annotate-read.sh` already make. `indexVersion` is
captured once (`vectorDB.getCurrentVersion()`) so every symbol in one run shares
`findDependents`'s internal scan cache — only the first symbol in a file pays
the `scanAll`.

**Graceful degrade**, in two layers:

- **No index at all**: a cheap existence check
  (`fs.access(<indexDir>/structural.db)`) runs *before* `createVectorDB` — this
  matters because `createVectorDB(...).initialize()` would otherwise silently
  create an empty `structural.db` as a side effect of merely running the CLI in
  an unindexed repo, exactly the failure mode `test-reminder.sh`'s hook already
  guards against with the same existence check. If no index exists, every
  change in the batch degrades to signature-only.
- **`findDependents` throws for one symbol**: only that symbol degrades; the
  rest of the batch (and other files) still enrich normally.

A degraded change carries `dependentCount: null`, `untestedDependentCount:
null`, `riskLevel: null`, `enriched: false` — the warning still fires, it just
can't say how many callers exist.

```jsonc
// --file mode: a single flat object (what the hook parses)
{
  "filepath": "packages/cli/src/cli/delta-cmd.ts",
  "changes": [
    {
      "symbol": "formatDeltaText",
      "symbolName": "formatDeltaText",
      "kind": "signature-changed",
      "beforeSignature": "...",
      "afterSignature": "...",
      "dependentCount": 4,
      "untestedDependentCount": 1,
      "riskLevel": "medium",
      "enriched": true
    }
  ]
}
```

Whole-tree mode (no `--file`) prints a JSON array of these per-file objects
instead — a secondary, human-facing surface the hook never calls, so its exact
shape wasn't frozen by any consumer.

## C. The PostToolUse hook (`api-delta-write.sh`)

Mirrors `delta-write.sh` exactly in structure: `command -v jq`, source
`lien-resolve.sh`, an env kill switch (`LIEN_BLAST_HOOK=off`), read
`tool_name`/`tool_input.file_path`/`cwd` from stdin, shell out to
`lien api-delta --file <path> --format json` from the session's `cwd`, and stay
silent (`exit 0`, no stdout) whenever `changes[]` is empty or the CLI produced no
output at all (not a git repo, unsupported file, malformed stdin). Registered as
a 4th `PostToolUse: Edit|Write|MultiEdit` entry in `hooks.json`, alongside
`delta-write.sh` and `test-reminder.sh` — independent hook entries, same
matcher.

The warning text depends on `(kind, enriched)`:

```
⚠ lien: exported signature changed — formatUser (4 dependents, 1 untested, risk medium). Run get_dependents before relying on callers.
⚠ lien: exported symbol removed — oldHelper (7 dependents, risk high). Callers will break — check get_dependents.
⚠ lien: exported signature changed — formatDeltaText. Check get_dependents (index unavailable for counts).
```

The single-change case (by far the common one — most edits touch one exported
symbol) renders one of these full sentences. Two or three changes fall back to a
terser combined line (`⚠ lien: N exported-signature changes — item1; item2;
item3 (+K more). Run get_dependents before relying on callers.`), worst-first,
matching `computeExportedSignatureDelta`'s own sort.

Output channel: `hookSpecificOutput.additionalContext` — the same channel
`delta-write.sh` and `test-reminder.sh` use, verified in
[claude-code-hook-channels.md](claude-code-hook-channels.md) as the one field
that reaches the model on the next turn.

### Dogfood evidence (real PostToolUse stdin shape)

Verified by piping the real `{session_id, transcript_path, cwd, hook_event_name,
tool_name, tool_input, tool_response}` payload shape into the hook script
directly, covering:

- **Enriched, signature-changed**: `⚠ lien: exported signature changed — computeDeltaWindowStats (2 dependents, 0 untested, risk low). Run get_dependents before relying on callers.`
- **Enriched, removed**: `⚠ lien: exported symbol removed — computeDeltaWindowStats (2 dependents, risk low). Callers will break — check get_dependents.`
- **Degraded (no index)**: `⚠ lien: exported signature changed — greet. Check get_dependents (index unavailable for counts).` — confirmed only `blast-events.jsonl` was created on disk, never `structural.db`.
- **Fail-open**: malformed (non-JSON, and valid-JSON-missing-fields) stdin, and a non-git directory — all exit 0 with no `additionalContext` emitted.

## D. Event ledger + `lien stats`

`packages/cli/src/utils/blast-events.ts` is a sibling of `delta-events.ts`, not
an extension of its `DeltaEvent` shape — a blast-radius event has no exit code,
mode, or crossing counts, and `lien api-delta` is advisory-only. One line is
appended to `<indexDir>/blast-events.jsonl` per changed file that had at least
one exported-signature change — **never for a clean run**, so `lien stats`'s
"runs" count answers "edits that changed an exported signature," not "edits
observed." Same 2 MB front-trim, same shape-validation-on-read, same kill switch
convention (`LIEN_BLAST_EVENTS=off`) as `delta-events.ts`.

`packages/cli/src/utils/blast-stats.ts` is the pure aggregation:
`computeBlastWindowStats(events, windowDays, now?)` reports, per window, `runs`,
`distinctSymbolsChanged` (unique `(filepath, symbol)` pairs), and `byRiskLevel`
(a count per `low|medium|high|critical|unknown` — `unknown` covers degraded,
no-index changes).

`lien stats` gains a second "Exported-signature nudge" section, printed after
the existing complexity-delta windows. JSON output nests the new data under a
`blastRadius` key — additive; the pre-existing top-level `totalEvents`/`windows`
shape is unchanged for any existing caller.

## Known limitations

All of these are silent misses (safe direction — the nudge under-fires, it
never fires on something that isn't real), not false positives:

- **Scope: exported top-level functions and exported class methods only.**
  Verified misses, each confirmed not to produce a chunk `signature-delta` can
  see:
  - **Interface method signatures** (e.g. `export interface Foo { bar(x: number): void }`)
    — an interface's methods aren't `function`/`method`-typed chunks with a
    `symbolName`, so they're filtered out before classification ever runs.
  - **Exported type-alias function types** (e.g. `export type Handler = (x: number) => void;`)
    — same reason: not a function/method chunk.
  - **Aliased re-exports** (`export { foo as bar }`) — the file's exported-name
    list carries the alias (`bar`), not the declared function's own name
    (`foo`); `isExportedChunk` matches on `symbolName`, so a function only
    exported under an alias is never recognized as exported.
  - **Reference-form default exports** (`function foo() {...}; export default foo;`)
    — same alias problem: the export list doesn't necessarily carry `foo`'s own
    name.
  - **Anonymous default exports** (`export default function() {...}`) — no
    `symbolName` at all, filtered out by the "must have a name" guard before
    the exported check ever runs.
- **TypeScript overload declarations** — see "Matching functions across
  versions" above: only the implementation signature is trackable; an
  overload-declaration-only signature change is a silent miss.
- **Function-level renames are not tracked** (inherited from
  `complexity-delta.ts`'s matching): renaming `foo` to `bar` reads as `foo`
  removed plus `bar` added under a different qualified key, not one function
  matched across the rename.
- **Whitespace/formatting-only signature changes are normalized away**
  (collapsed spacing, added/removed trailing commas, single-to-multi-line
  param reflow all compare equal — see `normalizeSignature`), but a **positional
  parameter rename is deliberately still flagged** (`f(a)` → `f(input)`):
  identifier text is never touched by normalization, and a parameter rename is
  a real API-surface change in keyword-argument languages (e.g. Python), not
  noise.

## Why advisory, not a gate

`lien delta` fails a commit (exit 1) on a new complexity crossing because
"this function got more complex" has an unambiguous, checkable answer. "Did you
check `get_dependents`?" doesn't: the agent might already know every caller
(a self-contained refactor), or the change might be safe by inspection. Blocking
the edit — or even the commit — on this signal would be enforcing a process step,
not a correctness property, and CLAUDE.md's own gate liturgy reserves hard
failures for objectively-verifiable regressions. The nudge exists to make the
honor-system rule hard to forget, not to replace judgment with a mechanical gate.
This is also why there is no CI backstop job: a CI job blocking a PR on "an
exported signature changed" would be a policy no one asked for.

A pre-registered behavioral A/B tested whether the *nudge itself* changes
agent behavior — a separate question from whether it should ever block. See
[Behavioral A/B: does the blast-radius warning change what an agent says about
callers?](../development/blast-radius-nudge-ab.md) for the full protocol and
an honest null result: the chosen experimental design hit a ceiling effect
(subagents inherit this repo's own CLAUDE.md, which already states the rule
the warning reinforces), so it could not isolate the nudge's marginal effect
— reported as such rather than reframed as inconclusive-therefore-supportive.

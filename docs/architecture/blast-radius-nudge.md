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

## Two risk concepts — read this before assuming every `riskLevel` agrees

Lien computes **two genuinely different things** and, until CLI-4/REVIEW-6 were
fixed, both were exposed under the identical field name `riskLevel`. They answer
different questions, are computed by different formulas over different inputs,
and are **expected to disagree** for the same file at the same moment. Treat
that as a documented property, not a bug to chase — see
`packages/parser/src/insights/complexity-vs-blast-radius-risk.test.ts`, which
pins concrete cases where they diverge in both directions.

| | **Complexity risk** (`get_complexity`/`lien complexity`) | **Blast-radius risk** (this doc's subject) |
|---|---|---|
| Question answered | "How risky is this file's own complexity?" | "How risky is *changing* this file, given who depends on it?" |
| Field name | `complexityRiskLevel` (`lien complexity --format json`'s `files[x].complexityRiskLevel`; `get_complexity`'s `violations[].complexityRiskLevel`) | `riskLevel` (`get_dependents`, `lien annotate`, `lien api-delta`) |
| Formula | `max(calculateRiskLevel(own violations' severity), calculateRiskLevelFromCount(dependentCount) boosted by dependents' complexity)` — a **ceiling that only ever rises**, never falls | `computeBlastRadiusRisk`: dependent breadth + untested-dependent count, with a complexity **floor** (one tier below `complexityRiskBoost`, never a ceiling) |
| Test coverage of dependents | **Not a term in the formula at all** | Central: an untested dependent escalates risk; full coverage lowers it (but never below the complexity floor) |
| Implementation | `packages/parser/src/insights/chunk-complexity.ts` (`calculateRiskLevel`, `enrichWithDependencies`) + `packages/parser/src/dependency-analyzer.ts` (`calculateRiskLevelFromCount`, `calculateComplexityRiskBoost`) | `packages/parser/src/risk/blast-radius-risk.ts` (`computeBlastRadiusRisk`) |
| Internal type field | `FileComplexityData.riskLevel` (`packages/parser/src/insights/types.ts`) — kept as-is internally; renamed only at the `get_complexity`/`lien complexity --format json` output boundary, since that's where the same-named collision was actually observed | n/a |

**Why the rename (not a formula merge).** Reading both implementations: these
are legitimately different concepts, not one concept computed two
inconsistent ways. Collapsing them into one formula would lose information —
"this function's cyclomatic complexity is already over threshold" and "three
of your five callers have no tests" are both real, independent signals a
change author needs, and neither should silently override the other. The
fix is the name collision, not the formula difference: `get_complexity`'s
field is `complexityRiskLevel`; the three surfaces below keep `riskLevel` for
blast-radius risk.

**This can't silently re-converge (or re-diverge) unnoticed:**

- The two-concepts comparison above is pinned by a test
  (`complexity-vs-blast-radius-risk.test.ts`) that computes both formulas
  against the same fixtures and asserts they land on *different* levels — if
  a future change makes either formula start agreeing with the other on
  those fixtures, that test fails and must be consciously updated (and this
  table re-read), rather than drifting unnoticed.
- Within blast-radius risk itself, all three surfaces (`get_dependents`,
  `lien annotate`, `lien api-delta`) must feed `computeBlastRadiusRisk` the
  **same population** — production dependents only, never production + test
  — see "Enrichment: dependent counts and risk, best-effort" below for the
  HOOKS-2 fix that made `lien annotate` match the other two, and why
  production-only is the correct population.

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
a risk level via the shared `computeBlastRadiusRisk` primitive — the same
primitive `get_dependents` and `lien annotate` compose their own risk from.
`indexVersion` is captured once (`vectorDB.getCurrentVersion()`) so every
symbol in one run shares `findDependents`'s internal scan cache — only the
first symbol in a file pays the `scanAll`.

**Population parity across all three surfaces (HOOKS-2).** Sharing
`computeBlastRadiusRisk` is not sufficient for the three surfaces to agree —
they must also feed it the *same* `dependentCount`. `get_dependents` and
`lien api-delta` always have (`productionDependentCount`, excluding test
files: a test importing the target isn't the same risk as production code
importing it). `lien annotate` did not: until this fix it fed the WIDER
`dependents.length` (production + test) into `computeBlastRadiusRisk` while
already using the narrower `uncoveredProductionDependents` for the untested
count in the same call — an internal mismatch as well as a cross-surface
one. A file with many test-only importers and few or no production ones
could come back a *higher* risk from `lien annotate` than `get_dependents`
reported for the identical file at the identical moment (confirmed live:
`lien annotate` read `risk: medium (8 callers, ...)` while `get_dependents`
read `riskLevel: "low"` / `productionDependentCount: 2` for the same file,
same index, same moment). Fixed by feeding `productionDependentCount` into
`lien annotate`'s `computeBlastRadiusRisk` call too, and relabeling the
reasoning's generic "N callers" entry as "N production callers" (shared
`relabelCallerReasoning` in `packages/cli/src/utils/blast-radius-reasoning.ts`,
used by both `get_dependents` and `lien annotate` — one implementation, not
two copies that can drift again) so the wider dependents list this command
also prints (production + test, sorted production-first) is never confused
with the narrower count driving the risk verdict.

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

## E. docRefs: shifting docs-drift left onto a REMOVED change

The PR-review engine's docs-drift pass (`packages/parser/src/signals/docs-drift-signals.ts`,
dark by default) already catches "an untouched doc still names a symbol this PR
removed" — but only at PR time. This extends the same fact one step earlier: when
`enrichOneChange` classifies a change as `kind: 'removed'`, it also looks up which
indexed documentation chunks still reference that symbol, and appends the count
and up to 3 paths to the same warning. No LLM anywhere — the agent reading the
warning is the judge of what to do about it.

### Precondition, verified empirically before any of this was built

Markdown gets heading-chunked (`type: 'doc'`) and indexed by default — no flag,
no opt-in. Confirmed two ways: reading the code path (`DEFAULT_INDEX_INCLUDE_PATTERNS`
in `packages/parser/src/constants.ts` includes `**/*.md`/`**/*.mdx`/`**/*.markdown`
unconditionally; `chunkFile` in `packages/parser/src/chunker.ts` routes any such
path to `chunkMarkdownFile` with no feature flag), and by querying this repo's own
live index directly: `sqlite3 <indexDir>/structural.db "SELECT COUNT(*) FROM chunks
WHERE type='doc'"` returned 1,078 real doc chunks, including CLAUDE.md broken into
per-heading sections. Had this been flag-gated or unbuilt, this feature would not
have been buildable as scoped — see the original brief's step-zero gate.

### Matching primitives: lifted, not duplicated — then genuinely improved, twice, both disclosed

The review pass's word-boundary regex (negative-lookaround `wordBoundaryRe`,
guarding against matching a token as a substring of a longer identifier/path) and
its corpus-driven distinctiveness gate (originally `isDistinctiveBareDirectory`,
scoped to bare top-level directory names) are the exact precision machinery this
feature needs too — a removed symbol named `index` or `config` must not spam the
warning with incidental prose hits. Both moved into `@liendev/parser`'s new
`doc-reference-matching.ts` (generalized from "bare directory" to "any token"),
and `docs-drift-signals.ts` now imports them instead of defining its own copies —
`isDistinctiveBareDirectory` survives as a one-line delegating export (its own
test suite imports it by that name). **The code-motion step itself was proven
behavior-identical** before anything else changed: review's full 39-test
`docs-drift-signals.test.ts` suite, and its full 1581-test package suite, passed
unchanged immediately after the pure lift, with no logic altered yet.

Two real behavior changes followed, both found by dogfooding this feature (not
assumed away), both disclosed here rather than folded silently into "the lift":

**1. Fence-awareness (a fix).** The distinctiveness gate's original
neighbor-character check (a `/` or backtick directly adjacent to the match) only
recognized *inline* code spans. It did not recognize a multi-line fenced code
block — and `createVectorDB`, used as the first real-world dogfood symbol, is
genuinely referenced in CLAUDE.md's own fenced package-structure tree and in
`packages/core/README.md`'s fenced usage examples, neither of which have a
backtick or `/` touching the token itself. The gate mis-classified all of those
as "not distinctive" and suppressed a real, correct doc reference down to zero.
Fixed by tracking per-line fence state (mirrors `docs-drift-signals.ts`'s own
`isInsideFence`) and treating any line inside a fence as code context outright,
regardless of neighbor characters.

**This is a genuine behavior change for `isDistinctiveBareDirectory`, not an
identical refactor** — a bare directory name referenced ONLY inside a fenced
code block previously read as "not distinctive" (silently suppressed) and now
reads as "distinctive" (correctly flagged). No pre-existing review fixture
exercised that shape, so no existing test result changed, but the *logic* now
answers a question it didn't used to get right. This is a deliberate,
disclosed improvement that aligns the shared gate with `docs-drift-signals.ts`'s
own `isInsideFence` sweep path — not a "no behavior changed" claim. A new
review-side regression fixture pins the new behavior explicitly (see
`docs-drift-signals.test.ts`'s "fenced bare-directory reference" case).

**2. Identifier-shape exemption (a fix, found because the flagship claim
stopped reproducing).** The distinctiveness gate's rule is "a single prose hit
ANYWHERE in the corpus suppresses the whole token" — and once this very
architecture-doc section was written and indexed, it itself contained plain,
un-backticked prose mentions of `createVectorDB` (e.g. "9 docs reference
createVectorDB:" in the dogfood-evidence prose below). Under the pre-fix gate,
that alone made `createVectorDB` "not distinctive," suppressing the flagship
9-file claim back down to zero — a real over-suppression bug, not a fencing
edge case. The fix: a token containing an uppercase letter or an underscore
anywhere (`createVectorDB`, `authToken`, `MyClass`, a single Capitalized class
name like `Widget`) is exempt from the corpus-wide prose gate entirely — no
ordinary lowercase English word has that shape, so no amount of plain-prose
surrounding text can make it ambiguous. A bare all-lowercase token (`index`,
`config`, `platform`) is unaffected and still goes through the exact same
strict, corpus-driven check as before.

**This exemption cannot change `isDistinctiveBareDirectory`'s existing
behavior** — review's bare-top-level-directory referands are always lowercase
by this repo's own directory-naming convention (verified: every existing
fixture and this repo's real directories), so the exemption never engages for
that call site. Proven, not just argued: review's full suite (1581 tests)
passes unchanged, plus the same new fenced-bare-directory fixture above also
covers a lowercase token, so it exercises the fence fix without ever touching
the exemption path.

### Query path

`packages/cli/src/utils/doc-references.ts`'s `findDocReferences(vectorDB,
symbolName)`: `vectorDB.scanAll()` (the full unscoped read — no `type` filter
exists on `VectorDBInterface`, and this already matches the cost class
`findDependents` pays for the same event), filtered to `metadata.type === 'doc'`,
then to genuine `wordBoundaryRe` matches, then gated by `isDistinctiveToken`. The
surviving distinct file paths are sorted and capped at
`MAX_DOC_REF_PATHS` (3), with the true total count preserved separately so the
warning can say "(+N more)". Runs *only* when a removal was already classified —
never on the common edit, and never for a `signature-changed` row (the symbol
still exists, so "docs reference it" isn't a drift signal there).

Fail-open throughout: `findDocReferences` catches internally and returns `null`
on any error (closed db, corrupt store), which the caller treats identically to
"zero references" — omit the line, never block, never throw.

### Surface

Additive fields only:

- `EnrichedExportedSymbolChange` gains `docRefCount: number | null` and
  `docRefPaths: string[]` — `null`/`[]` for every `signature-changed` row and for
  a degraded `removed` row (no index, or the lookup failed).
- `api-delta-write.sh`'s warning gains one sentence for the single-change
  `removed` case: `" N docs reference X: path1, path2, path3 (+K more)."` The
  2-3-change fallback branch stays terse — just `", N docs"` per removed item,
  to avoid ballooning an already-combined line.
- `BlastEventChange` gains `docRefCount?: number | null` — optional (not just
  nullable) because events recorded before this field existed have no such key
  at all; `isValidBlastEventChange`'s reader treats absent, `null`, and a real
  number as the three legitimate states, and rejects anything else (e.g. a
  string). `lien stats` is untouched — no natural aggregation was worth adding
  for this pass.

```jsonc
// single 'removed' change, enriched, with doc references
{
  "symbol": "createVectorDB",
  "kind": "removed",
  "dependentCount": 7,
  "riskLevel": "low",
  "enriched": true,
  "docRefCount": 9,
  "docRefPaths": ["CLAUDE.md", "docs/architecture/blast-radius-nudge.md", "docs/architecture/decisions/0010-retire-qdrant-backend.md"]
}
```

### Dogfood evidence (real PostToolUse stdin shape, this repo's own index)

All cases piped through the real hook script with the genuine `{session_id,
transcript_path, cwd, hook_event_name, tool_name, tool_input, tool_response}`
payload shape, against this repo's own live overlay index (not a synthetic
fixture) — **re-captured after the identifier-shape exemption and fence fixes**,
against the rebuilt CLI, so every claim below reproduces against this PR's own
final code, not an earlier draft of it:

**Removed symbol with real doc references** (`createVectorDB`, temporarily
de-exported in the working tree only, reverted immediately after capture):

```
⚠ lien: exported symbol removed — createVectorDB (7 dependents, risk low). Callers will break — check get_dependents. 9 docs reference createVectorDB: CLAUDE.md, docs/architecture/blast-radius-nudge.md, docs/architecture/decisions/0010-retire-qdrant-backend.md (+6 more).
```

Unchanged from the pre-fix capture (still 9 files) — expected: this doc's own
prose additions landed inside a file (`blast-radius-nudge.md`) that was already
one of the 9, so the *distinct-file* count didn't move, only the exemption's
correctness did (see the two fixes above for what actually changed and why).

**Removed symbol with zero doc references.** Deliberately NOT `detectFileType`
— an earlier draft of this doc used that as the example and named it directly
in this same prose, which itself became a doc reference the moment this file
was indexed, silently invalidating a "zero references" claim about to be
committed. Demonstrated instead with a synthetic, disposable exported symbol
(`zzzUnreferencedNudgeDemoHelper`, added and removed via a temporary commit,
squashed away immediately after capture — never part of this PR's real history)
specifically so naming it here can never turn it into a real reference:

```
⚠ lien: exported symbol removed — zzzUnreferencedNudgeDemoHelper (0 dependents, risk low). Callers will break — check get_dependents.
```

The docRefs sentence is correctly absent — not "0 docs reference…".

**Degraded (no index)**, a fresh scratch repo:

```
⚠ lien: exported symbol removed — greet. Check get_dependents (index unavailable for counts).
```

Confirmed only `blast-events.jsonl` was created on disk (`docRefCount: null` in
the ledger), never `structural.db`.

**Fail-open**: malformed (non-JSON, and valid-JSON-missing-fields) stdin, and a
non-git directory — all exit 0 with no `additionalContext` emitted.

**Robustness: a hostile/malformed enrichment (`docRefCount: 5, docRefPaths:
null`).** Before the null-guard fix, piping this shape into the hook script's
`docRefsClause` crashed jq outright (`Cannot iterate over null (null)`, exit
5) — silently dropping the ENTIRE warning, including the base "symbol removed"
sentence that has nothing to do with docRefs. After the fix
(`(.docRefPaths // [])`), the same input degrades gracefully instead:

```
⚠ lien: exported symbol removed — x (1 dependents, risk low). Callers will break — check get_dependents. 5 docs reference x:  (+5 more).
```

The path list renders empty but the count and the base warning both survive —
never a silent total loss over one malformed field.

## F. attributionCaveat: closing the symbol-scoped honesty gap (#1097)

`lien api-delta`'s enrichment (`enrichOneChange`, section B above) is
symbol-scoped by construction — it always calls `findDependents(vectorDB,
filepath, log, change.symbolName, indexVersion)`. Found by an adversarial-
review agent stress-testing this exact code path: `checkDependentAttributionIncomplete`
(`@liendev/parser`'s `dependency-analyzer.ts`) used to guard on `symbol ||
...`, unconditionally skipping its whole "does this language have a known
import-invisible access shape" determination whenever a query was
symbol-scoped — precisely the shape both `get_dependents({filepath, symbol})`
and every `lien api-delta` check use. A real, non-type-declaration exported
symbol with zero import-graph-visible dependents in a `hasDependentAttributionBlindSpot`
language (C#, Java, Kotlin, Swift — #1005) came back with no caveat at all,
even though the identical file's file-level query correctly carried
`dependentAttributionIncomplete`. This surfaced as `lien api-delta` printing
a bare `0 dependents, 0 untested, risk low` for e.g. a Java class's method
with genuine same-package callers the import graph structurally can't see —
a false-all-clear, the exact #1014 shape this repo's index-state-honesty
policy exists to prevent, just triggered by `symbol` truthiness instead of
index state.

**The fix**: `checkDependentAttributionIncomplete` now runs its blind-spot
determination for a symbol-scoped query too, gated on the exact same facts
already used for the file-level case (`hasDependentAttributionBlindSpot` +
zero final dependents + `targetIndexed`) — reusing the existing decision
rather than inventing new criteria. The one guard added: it skips when
`typeSymbolAttributionIncomplete` already explains the same zero (a
type-declaration symbol query, e.g. querying a class name itself rather than
one of its methods), so the two caveats never contradict each other on one
response. `symbolAttributionDegraded` needs no equivalent guard — it only
ever fires with a nonzero final dependent count, so the shared zero-count
check already excludes it structurally.

**Surface**: `EnrichedExportedSymbolChange` (`api-delta-cmd.ts`) gains
`attributionCaveat: AttributionCaveat | null` — the identical five-reason
vocabulary `get_dependents` exposes, computed by the same shared
`buildAttributionCaveatFromAnalysis` (extracted from `get-dependents.ts`'s
`buildAttributionCaveat`) so the two surfaces can never disagree about when
to hedge. `null` when there's nothing to hedge, or when enrichment failed
entirely (`enriched: false`). The text renderer (`formatApiDeltaText`) prints
the note as a trailing warning line; the PostToolUse hook
(`api-delta-write.sh`) appends it to the single-change warning sentence
(`attributionCaveatClause`, mirroring `docRefsClause`'s shape) and a terse
", attribution incomplete" marker to the 2-3-change combined line.

```jsonc
// lien api-delta --file src/main/java/com/example/util/Logger.java --format json
// (a REAL same-package Java caller with no import statement -- App.java in the
// same package calls Logger.logInfo() with no `import` at all, valid Java)
{
  "filepath": "src/main/java/com/example/util/Logger.java",
  "changes": [
    {
      "symbol": "Logger.logInfo",
      "symbolName": "logInfo",
      "kind": "signature-changed",
      "dependentCount": 0,
      "untestedDependentCount": 0,
      "riskLevel": "low",
      "enriched": true,
      "attributionCaveat": {
        "reason": "dependent-attribution-incomplete",
        "note": "No import-based dependents were found for src/main/java/com/example/util/Logger.java (symbol: \"logInfo\"), but its language lets real callers use its exports with no per-file import naming it at all ..."
      }
    }
  ]
}
```

### Dogfood evidence

**Real PostToolUse stdin shape, piped through the actual hook script**
(`api-delta-write.sh`), against the fixture above:

```text
⚠ lien: exported signature changed — Logger.logInfo (0 dependents, 0 untested, risk low). Run get_dependents before relying on callers. ⚠ No import-based dependents were found for src/main/java/com/example/util/Logger.java (symbol: "logInfo"), but its language lets real callers use its exports with no per-file import naming it at all (e.g. C#'s "global using" / implicit enclosing-namespace access, Java/Kotlin's same-package visibility, or Swift's whole-module access). The import graph has no signal for that usage shape, so dependentCount: 0 and riskLevel: "low" here mean "the scan found nothing," not "nothing depends on this file" — don't treat this as a verified clear.
```

**A real `lien serve` process, real MCP `tools/call` over stdio** (`get_dependents({filepath, symbol: "logInfo"})` against the same fixture) returns `dependentCount: 0` with the identical `attributionCaveat` — the file-level and symbol-level queries now agree.

**All 11 real per-language corpora this repo's own E2E suite tracks** (`packages/cli/test/e2e/real-projects.test.ts`'s projects, freshly cloned and indexed), each queried with a real exported symbol via a live `get_dependents` MCP call:

| Project | Language | Symbol queried | dependentCount | attributionCaveat |
|---|---|---|---|---|
| Requests | Python | `get_encoding_from_headers` | 3 | none |
| Zod | TypeScript | `$ZodString` | 64 | `type-symbol-attribution-incomplete` (pre-existing #1015 mechanism, unrelated to this fix) |
| Express | JavaScript | `Router` | 0 | none |
| Monolog | PHP | `pushHandler` | 15 | `symbol-attribution-degraded` (pre-existing #931 mechanism) |
| Anyhow | Rust | `Error` | 5 | `type-symbol-attribution-incomplete` (pre-existing) |
| Chi | Go | `RouteContext` | 0 | none (Go is deliberately excluded from the blind-spot set — #1005) |
| **JavaPoet** | **Java** | `hasModifier` | **0** | **`dependent-attribution-incomplete` — the #1097 fix firing on a real, unmodified open-source method** |
| MediatR | C# | `IRequestHandler` | 0 | `type-symbol-attribution-incomplete` (interface — the double-caveat guard correctly suppresses the new flag) |
| Sinatra | Ruby | `dispatch!` | 20 | `symbol-attribution-degraded` (pre-existing) |
| Klaxon | Kotlin | `JsonObject` | 0 | `type-symbol-attribution-incomplete` (data class — same guard as MediatR) |
| **SwiftyJSON** | **Swift** | `rawString` | **0** | **`dependent-attribution-incomplete` — the #1097 fix firing on a real, unmodified open-source method** |

Two corpora (JavaPoet, SwiftyJSON) reproduce the exact reported bug shape on
real, unmodified upstream code: a real method with zero import-graph-visible
dependents in a blind-spot language now correctly carries the caveat. Two
more (MediatR, Klaxon) confirm the double-caveat guard: a type-shaped symbol
query in the same languages correctly keeps its existing, more specific
`type-symbol-attribution-incomplete` caveat rather than also setting the new
flag. Three (Requests/Python, Express/JavaScript, Chi/Go) confirm no
over-firing with no caveat at all — non-blind-spot languages (Go
deliberately so, per #1005), genuinely clean zero. The remaining four
(Zod/TypeScript, Monolog/PHP, Anyhow/Rust, Sinatra/Ruby) confirm the two
PRE-EXISTING, unrelated caveat mechanisms (`type-symbol-attribution-incomplete`,
`symbol-attribution-degraded`) still fire exactly as they did before this
change — this fix touches neither their conditions nor their wording.
`lien api-delta --file <path> --format json` was additionally run against
real, unmodified-then-reverted signature edits on both JavaPoet's
`TypeSpec.hasModifier` and SwiftyJSON's `JSON.rawString`, confirming the CLI
surface (not just the MCP tool) carries the same caveat.

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
- **docRefs (section E) only fires for `removed`, never `signature-changed`** —
  a symbol that merely changed shape still exists, so "docs reference it" isn't
  a drift signal by itself.
- **docRefs has no suppression tiers.** Unlike the review pass it borrows its
  matching primitives from, this feature does not exclude changelog/changeset
  entries, fenced-code samples that are stale on purpose, or past-tense
  ("formerly", "was removed") prose — a CHANGELOG.md mention counts exactly the
  same as a live guide. This is a deliberate scope cut (the agent reading the
  warning is the judge), not an oversight; the review pass's dedicated
  `isSuppressed`/`classifyPositionTier` machinery was left there rather than
  duplicated here.
- **An extra, uncached full `scanAll()` per removed symbol.** `findDocReferences`
  does not share `findDependents`'s internal scan cache (a private module-level
  cache in `dependency-analyzer.ts`) — accepted because this only runs on the
  rare already-detected-removal event, the same event `findDependents` itself
  already pays a full scan for.
- **Recall is capped at `MAX_DOC_REF_PATHS` (3) displayed paths**, though the
  true count is preserved and shown via "(+N more)" — never silently truncated
  to a smaller number without saying so.
- **Fence detection covers ` ``` `/`~~~` only, not a 4-space-indented code
  block** (the other Markdown convention for a literal code sample). This is
  consistent with the chunker's own `FENCE_RE` (`markdown-chunker.ts`), which
  has the same gap — an indented block was never a first-class construct here.
  A token referenced only inside an indented block, with no other doc mention,
  still reads as ordinary prose and can be wrongly suppressed by the
  distinctiveness gate unless it also happens to have an unambiguous
  identifier shape (section E's exemption).

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

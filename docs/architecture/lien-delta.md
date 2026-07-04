# lien delta — complexity accounting before the commit

Status: **Phase 1 (in progress)** — mechanisms 1 + 4 of a 5-mechanism plan.

## Motivation

An agent shipped a PR that passed every gate — format, lint, typecheck, build,
test — but raised a function's cognitive complexity from under the threshold to
**29 against a threshold of 15**. Nothing at edit time noticed. The PR-review
engine caught it *after the fact*, which cost a full extra fixer-agent run for
something a ~50 ms deterministic check could have flagged while the agent still
had the change in hand.

Lien already computes cognitive/cyclomatic/Halstead complexity per function and
already surfaces threshold violations in PR review. The gap is purely one of
**timing**: the signal exists, but only *after* the code is pushed. `lien delta`
moves that signal to before the commit.

This is the product thesis in miniature — Lien is the tool that stops agents
from writing AI-shaped code. A blunt "your function is too complex" at review
time is a slap on the wrist. The same verdict at edit time is a course
correction the agent can act on for free.

## Scope

Phase 1 delivers two of the five planned mechanisms:

- **Mechanism 4 — the shared primitive** (build first; it shapes everything).
  A complexity-delta computation that lives in `@liendev/parser`. It takes two
  versions of a file's content and emits per-function verdicts. Because the PR
  review engine (`packages/review`) depends on parser *only* (not core), review
  can adopt the exact same primitive later — so write-time and review-time
  verdicts can never structurally disagree.
- **Mechanism 1 — the `lien delta` CLI command.** Compares the working tree
  against `HEAD` across changed files and prints a concise per-function table of
  crossings plus a summary line, with exit codes designed for a commit gate.

Explicitly **out of Phase 1** (later phases): the annotate-hook crossing
warnings (mechanism 2), `get_files_context` complexity priming (mechanism 3),
and any commit-*blocking* / soft-block behaviour (mechanism 5). Phase 1 builds
**no hooks and blocks no commits** — `lien delta` is a gate an agent *chooses*
to run, exactly like `npm test`.

## A. The shared primitive (`@liendev/parser`)

### Where it lives

`packages/parser/src/insights/complexity-delta.ts`, exported from
`packages/parser/src/index.ts`. It sits *beside* `analyzeComplexityFromChunks`
(same directory, same metric machinery) rather than reimplementing anything.

### How it reuses existing machinery

The primitive does not invent metrics. It calls the existing
`chunkFile(filepath, content, opts)` (from `chunker.ts`) which already:

1. parses content via tree-sitter (`chunkByAST`),
2. emits one chunk per function/method with
   `complexity` (cyclomatic), `cognitiveComplexity`, `halsteadEffort`,
   `halsteadBugs`, `symbolName`, `parentClass`, `signature`, `startLine`.

`chunkFile` takes a **content string**, not a path on disk — so the primitive
can chunk a "before" image (`git show HEAD:file`) and an "after" image (working
tree) purely in memory, with no second checkout. This is the key difference from
the existing review-side delta (see "Relationship to review" below).

Halstead-effort thresholds are expressed in minutes in config; the primitive
converts via the existing `minutesToEffort()` helper, exactly as
`findViolations` does.

### API

```ts
export interface ComplexityDeltaThresholds {
  testPaths: number;               // cyclomatic  — matches config complexity.thresholds
  mentalLoad: number;              // cognitive
  timeToUnderstandMinutes: number; // halstead effort (converted to effort units)
  estimatedBugs: number;           // halstead bugs
}

export type ComplexityDeltaVerdict =
  | 'new-over-threshold'   // FAILS gate: function added and already over threshold
  | 'crossed'              // FAILS gate: existed under threshold, now over it
  | 'worsened'             // advisory: increased but still under threshold
  | 'pre-existing'         // advisory: was over before, still over (no NEW crossing)
  | 'improved'             // complexity decreased (may still be over — that's fine)
  | 'unchanged'
  | 'new-under-threshold'  // function added, under threshold
  | 'removed';             // function deleted

export interface MetricComplexityDelta {
  metricType: ComplexityMetricType; // 'cyclomatic' | 'cognitive' | 'halstead_effort' | 'halstead_bugs'
  before: number | null;            // null => function is newly added
  after: number | null;             // null => function was removed
  threshold: number;
  verdict: ComplexityDeltaVerdict;
}

export interface FunctionComplexityDelta {
  key: string;            // qualified match key, e.g. "MyClass::doThing"
  symbolName: string;
  parentClass?: string;
  filepath: string;
  language: string;
  startLine: number;      // location in the "after" image (or "before" if removed)
  verdict: ComplexityDeltaVerdict;  // worst verdict across the function's metrics
  isRegression: boolean;            // verdict is 'crossed' | 'new-over-threshold'
  metrics: MetricComplexityDelta[];
}

export interface FileComplexityDelta {
  filepath: string;
  oldPath?: string;       // set when the file was renamed
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  functions: FunctionComplexityDelta[];
}

export interface ComplexityDeltaResult {
  files: FileComplexityDelta[];
  regressions: FunctionComplexityDelta[]; // flattened convenience view of failing functions
  summary: {
    filesChanged: number;
    functionsAnalyzed: number;
    regressions: number;      // functions with a failing verdict
    crossed: number;
    newOverThreshold: number;
    worsened: number;
    improved: number;
  };
  thresholds: ComplexityDeltaThresholds;   // the resolved thresholds actually applied
}

export interface FileContentChange {
  filepath: string;       // path in the "after" tree (or the deleted path)
  before: string | null;  // HEAD content; null = file added
  after: string | null;   // working-tree content; null = file deleted
  oldPath?: string;       // previous path, when renamed
}

// One file:
export function computeFileComplexityDelta(
  change: FileContentChange,
  thresholds?: Partial<ComplexityDeltaThresholds>,
): FileComplexityDelta;

// Many files, aggregated with a summary:
export function computeComplexityDelta(
  changes: FileContentChange[],
  thresholds?: Partial<ComplexityDeltaThresholds>,
): ComplexityDeltaResult;

// Gate helper:
export function hasRegressions(result: ComplexityDeltaResult): boolean;
```

Thresholds default to the same constants `analyzeComplexityFromChunks` uses
(`testPaths: 15, mentalLoad: 15, timeToUnderstandMinutes: 60, estimatedBugs:
1.5`); a partial override is deep-merged over the defaults.

### Per-metric classification

Given a metric's `before` value `b`, `after` value `a`, and threshold `t`
(`b`/`a` are `null` when the function is absent on that side):

```
a === null                 -> 'removed'
b === null                 -> a >= t ? 'new-over-threshold' : 'new-under-threshold'
b <  t && a >= t           -> 'crossed'
b >= t                     -> a < b ? 'improved' : a > b ? 'pre-existing' : 'unchanged'
otherwise (both < t)       -> a > b ? 'worsened' : a < b ? 'improved' : 'unchanged'
```

A function's overall `verdict` is the **worst** of its per-metric verdicts,
ordered `crossed > new-over-threshold > pre-existing > worsened >
new-under-threshold > improved > unchanged > removed`.
`isRegression` is true iff that verdict is `crossed` or `new-over-threshold`.

**Which metrics gate.** All four metrics can produce a regression. This is
deliberate: it is exactly the set `analyzeComplexityFromChunks` (and therefore
PR review) already scores, so a delta regression and a review violation are the
same event computed the same way. Metric-selection policy (e.g. "only cognitive
gates, Halstead is advisory") is a plausible future knob, but it would then be
tuned in this one shared primitive and both engines would move together. It is
**not** a Phase-1 config surface (YAGNI).

### Function matching across versions

Functions are matched by **qualified name**: `` `${parentClass ?? ''}::${symbolName}` ``.
When a key has multiple functions on one side (overloads, or same-named methods),
they are paired positionally by ascending `startLine`; any extra on the "after"
side are `added`, any extra on the "before" side are `removed`.

Honest limitations (documented, not solved in Phase 1):

- **Renames are not tracked at the function level.** Renaming `foo` to `bar`
  reads as `foo` removed + `bar` added. If `bar` is over threshold it surfaces
  as `new-over-threshold`. This is defensible (a new over-threshold function
  *did* appear) but can nag on pure renames. File-level rename detection
  (`--find-renames`) still lets us diff the *body*, so a renamed-but-unchanged
  file produces no function-level noise; only function *identifier* renames are
  affected.
- **Signature changes do not break matching** — the key is name + parent, not
  the full signature, so changing parameters or return type still matches the
  same function (which is what we want: that is the common "edited a function"
  case).
- **Overload disambiguation is positional**, best-effort. TypeScript overloads
  that reorder could mis-pair; rare enough to accept for Phase 1.

## B. The `lien delta` CLI command

`packages/cli/src/cli/delta-cmd.ts`, registered in `packages/cli/src/cli/index.ts`.

### Behaviour

1. Resolve the project root (walk up to `.git`, mirroring existing commands).
2. Load thresholds from `.lien.config.json` via `configService.load()`
   (`@liendev/core`) — the *same* source the review reads — falling back to
   built-in defaults when the file or the `complexity` block is absent.
   `--threshold <n>` overrides `testPaths` + `mentalLoad` (parity with the
   review's single `--threshold`).
3. Discover changed files (working tree vs `HEAD`):
   - `git diff --name-status --find-renames HEAD` for tracked changes
     (this already unions staged + unstaged, since it compares HEAD to the
     working tree),
   - plus `git ls-files --others --exclude-standard` for untracked new files
     (treated as `added`).
   - Filter to parser-supported code extensions (`getSupportedExtensions()`).
4. For each changed file, build a `FileContentChange`:
   - modified → `before = git show HEAD:path`, `after = read(worktree)`;
   - added / untracked → `before = null`, `after = read(worktree)`;
   - deleted → `before = git show HEAD:path`, `after = null`;
   - renamed → `before = git show HEAD:oldPath`, `after = read(worktree:newPath)`,
     `oldPath` set.
5. Call `computeComplexityDelta(changes, thresholds)`.
6. Print the table + summary; exit per the codes below.

### Git edge cases

- **Unborn HEAD** (no commits yet): `git rev-parse --verify HEAD` fails →
  every changed/tracked/untracked file is treated as `added` (`before = null`).
- **Not a git repo**: operational error, exit 2 (see below).
- **Worktrees** (post-#667): `HEAD` and `git show HEAD:path` resolve against the
  current worktree's HEAD — no special handling needed.

### Output

Concise, one row per function with a non-trivial verdict, grouped by file:

```
lien delta — complexity vs HEAD

  packages/cli/src/cli/foo.ts
    ✗ crossed     processRequest      cognitive 12 → 18  (threshold 15)
    ⚠ worsened    helper              cognitive  8 → 11
    ✓ improved    legacyThing         cognitive 24 → 9

  ✗ 1 new crossing · ⚠ 1 worsened · ✓ 1 improved · 1 file · 41 ms
```

Clean changeset prints a single reassuring line and exits 0. `--format json`
emits the `ComplexityDeltaResult` for tooling.

### Exit-code semantics (designed for the gate liturgy)

| Code | Meaning |
|------|---------|
| **0** | No new threshold crossings (or `--soft`). Improved / pre-existing / worsened-but-under do **not** fail. |
| **1** | At least one regression: `new-over-threshold` or `crossed`. |
| **2** | Operational failure — not a git repo, git missing, unreadable file. (Distinct from 1 so a gate can tell "found problems" from "couldn't run".) |

`--soft` forces exit 0 always (advisory mode) while still printing the table —
for agents that want the signal without the gate teeth during exploration.

The asymmetry is the whole point: you are punished only for **making things
worse than HEAD**, never for pre-existing debt you happened to touch. This keeps
the gate honest and prevents it from blocking unrelated work in a hot file.

### Optional MCP variant — deferred

`get_complexity({ diff: true })` is attractive but does **not** fall out of A+B
for free: the existing `get_complexity` handler reads the persisted index, while
the delta primitive is content-based against `HEAD`. Wiring it means a new MCP
schema field + a handler path that shells out to git. Deferred to a later phase
with this note; the CLI is the Phase-1 surface.

## Relationship to PR review (integration path — follow-up, NOT this PR)

`packages/review/src/delta.ts` already computes a complexity delta, but at the
**report** level: it diffs two `ComplexityReport`s (base clone vs head clone),
so it only sees functions that *violate* on one side — it cannot observe a
function that worsened while staying under threshold, and it requires the review
engine's two full checkouts.

The Phase-1 primitive is strictly more capable (function-level, sees
under-threshold movement, needs only content strings). The intended follow-up —
**not done in this PR** — is to have `packages/review` call
`computeComplexityDelta` on the before/after content it already has from its two
clones, and retire the report-diffing logic in `review/src/delta.ts`. That is
what structurally guarantees write-time and review-time verdicts agree: one
function, one classification table, two callers. This PR only adds the primitive
and the CLI; review is left untouched.

## C. Gate liturgy

Agents follow gate lists religiously, so `lien delta` is added as the **sixth
gate**:

1. `CLAUDE.md` → "Before EVERY Commit (MANDATORY)" gains
   `lien delta` after `npm test`.
2. `lien init` templates: init currently writes no project-level commit-gate
   file — its only agent artifact is the read-only Explore agent
   (`packages/cli/src/cli/agents/explore-agent.ts`). Phase 1 surfaces
   `lien delta` guidance there (under the "Safe to change? / tech-debt" framing
   the Explore agent already uses). A dedicated project-scoped gate template
   emitted by `lien init` is a new output surface and is deferred (YAGNI).

## Deviations from the brief

- **init gate template**: the brief anticipated an init-written gate template to
  edit; none exists today (init only installs the Explore agent). Documented
  above; the concrete Phase-1 edits are repo `CLAUDE.md` + the Explore agent
  template.
- **Metric gating**: the brief centres the cognitive-complexity incident, but
  the primitive gates on all four metrics for structural parity with review
  (rationale above). The CLI table leads with the crossed metric so the cognitive
  case still reads front-and-centre.
- **Exit code 2**: the brief specified non-zero only on new crossings; we split
  that non-zero space into 1 (found crossings) vs 2 (couldn't run) so a gate can
  distinguish the two. Exit 1 remains "new crossings," as specified.

## Milestones

- [ ] 1. Design doc + draft PR
- [ ] 2. Shared delta primitive in parser + unit tests
- [ ] 3. `lien delta` CLI + tests (git edge cases: staged/unstaged, unborn HEAD, renames)
- [ ] 4. Gate liturgy docs (CLAUDE.md + init templates) + changeset
- [ ] 5. Full gate green + real-repo & worsened-function demos with timing

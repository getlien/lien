# lien delta — complexity accounting before the commit

Status: **Phase 1 shipped** (mechanisms 1 + 4, PR #672) · **Phase 2 in progress**
(mechanisms 2 + 3 — see "Phase 2" below) of a 5-mechanism plan.

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

## Milestones (Phase 1 — shipped in #672)

- [x] 1. Design doc + draft PR
- [x] 2. Shared delta primitive in parser + unit tests
- [x] 3. `lien delta` CLI + tests (git edge cases: staged/unstaged, unborn HEAD, renames)
- [x] 4. Gate liturgy docs (CLAUDE.md + init templates) + changeset
- [x] 5. Full gate green + real-repo & worsened-function demos with timing

---

# Phase 2 — the signal at the moment of the edit

Phase 1 made the verdict *available* (`lien delta`, a gate the agent chooses to
run). Phase 2 moves it from "when the agent runs the gates" to "the moment the
agent edits" — **detection** (mechanism 2) plus **prevention** (mechanism 3).
Neither blocks anything; both are advisory nudges on channels the agent already
consumes. Mechanism 5 (commit *soft-block*) and the review-engine adoption of
the shared primitive remain explicitly out of scope.

Both mechanisms reuse Phase-1 machinery unchanged. Mechanism 2 shells out to the
same `lien delta` command (so write-time and hook verdicts are byte-identical);
mechanism 3 reads complexity metrics **already stored in the index** (no
re-parse) and compares them against the same default thresholds the primitive
uses.

## D. Mechanism 2 — PostToolUse hook on Edit/Write (detection)

A Claude Code plugin hook (`plugins/claude/hooks/delta-write.sh`, registered in
`plugins/claude/hooks/hooks.json`) that fires **after** every `Edit`, `Write`,
and `MultiEdit` tool call and warns — once, concisely — only when *that edit*
introduced a **new** complexity threshold crossing.

### How it locates and drives the CLI

It mirrors `annotate-read.sh` exactly:

- `command -v jq` and `command -v lien` — exit 0 (silent) if either is missing.
  The hook never assumes a bundled binary; it uses whatever `lien` is on `PATH`,
  same as every other Lien hook.
- Reads the PostToolUse payload from stdin, pulls `tool_name`, `tool_input.file_path`,
  and `cwd` with `jq`, and runs the delta **from `cwd`** so `resolveProjectRoot`
  and `git` resolve against the session's repo (multi-repo safe).

### hook → CLI invocation (the key decision)

The hook drives the Phase-1 primitive through a **new `--file <path>` flag** on
`lien delta` rather than running the full working-tree scan and filtering the
JSON. Rationale:

- The full scan runs `git diff HEAD` across **every** changed file, reads each,
  and chunks each — wasteful when this hook fires on *every* edit and cares
  about exactly one file. `--file` bounds the work to a single `git show
  HEAD:<path>` + one working-tree read + one before/after chunk pair.
- It is the same code path and the same `computeComplexityDelta` call, so the
  hook's verdict and `lien delta`'s verdict cannot diverge.

`lien delta --file <path> --format json` semantics:

- Resolves `<path>` (absolute or relative) to a repo-relative path against the
  git root. Path outside the repo, or a non-code / unsupported extension →
  empty result, exit 0 (the hook stays silent).
- `before = git show HEAD:<relpath>` (null when the file is untracked/new or
  HEAD is unborn → absolute-threshold classification); `after` = working-tree
  content (null when deleted).
- Exit codes are unchanged from Phase 1 (0 clean, 1 regression, 2 operational).
  The hook **ignores** the exit code and inspects the JSON `regressions[]`
  array — it emits a warning *iff* that array is non-empty, i.e. only for
  `crossed` / `new-over-threshold` verdicts. Worsened-but-under, pre-existing,
  and improved are all silent by design (an always-on hook that fires on
  advisory movement becomes wallpaper and burns context).

### Output channel (hard-won)

The hook emits, on stdout, exactly the JSON shape `annotate-read.sh` uses —
`additionalContext` is the **only** field that reaches the model on the next
turn (verified in CC 2.1.142; a bare `systemMessage` does not):

```json
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"⚠ lien delta: extractSymbols cognitive 12→29 (threshold 15) — consider simplifying before you commit."}}
```

The message lists up to the top 3 regressing functions (worst-first, as the
primitive already sorts them), each rendered `name metric before→after
(threshold N)`; a `(+N more)` suffix when there are more. A newly-added
over-threshold function renders its `before` as `new`. **Silence** (exit 0, no
stdout) in every other case: no regression, non-code file, file outside a git
repo, unreadable payload, missing `jq`/`lien`. The hook never fails the user's
edit (`set -u`, best-effort throughout, always `exit 0`).

Kill switch: `LIEN_DELTA_HOOK=off`.

### Performance

The hook cost is dominated by **CLI process startup** (Node + loading the bundled
`@liendev/lien` image), not the delta compute — the single-file delta itself is a
few ms. Measured end-to-end on this repo (see PR body for the transcript);
target is well under 1 s and it clears it comfortably. Because the cost is
startup, not work, the honest optimisation levers (if it ever matters) are a
persistent/daemon `lien` or a slimmer entrypoint — **not** pursued now (YAGNI;
the measured number is already inside budget).

### Subagent caveat (dogfooding item for the maintainer)

Whether a plugin PostToolUse hook fires for `Edit`/`Write` performed *inside a
subagent session* cannot be verified outside a live Claude Code run (it is the
same `Agent`-vs-`Task` tool-name matcher subtlety the explore hook already
navigates). This is flagged as the one explicit live-CC dogfooding check before
Phase 2 is considered fully proven; the offline drive-the-script tests below
cover everything else.

## E. Mechanism 3 — `get_files_context` headroom priming (prevention)

`get_files_context` is MANDATORY before any edit. That makes it the natural place
to *prevent* a crossing: when the agent asks for a file's context, tell it which
functions are already near or over their complexity budget, so it steers around
them before writing a line.

### Zero re-parse

The complexity metrics (`complexity` = cyclomatic, `cognitiveComplexity`) are
**already stored per chunk** in the structural index (`chunks` table columns;
`SELECT *` in `read-ops.ts` projects them, `buildMetadata` maps them back onto
`SearchResult.metadata`). The handler already fetches the file's own chunks via
`searchFileChunks`. So headroom is computed from data in hand — **no second
parse, no extra query.**

### Shape

A new optional `complexityHeadroom` per file — an array of the functions at
≥ 80 % of a threshold (near) or over it, worst-first:

```jsonc
"complexityHeadroom": [
  { "symbol": "scanPatches", "metric": "cognitive", "value": 14, "threshold": 15 }
]
```

- One element **per function** — the single metric closest to (or furthest over)
  its threshold, by `value / threshold` ratio — never two rows for one function.
- Metrics considered: **cyclomatic + cognitive** only. These are the integer,
  intuitive, agent-actionable ones and the ones `--threshold` tunes. Halstead
  effort/bugs are deliberately left out of the *headroom hint* to keep the
  payload lean (a prior tuning pass showed response bloat degrades agent
  behaviour); the write-time `lien delta` gate still scores all four.
- Thresholds are the primitive's defaults (`DEFAULT_COMPLEXITY_DELTA_THRESHOLDS`:
  cyclomatic 15, cognitive 15). The handler stays **zero-I/O** — it does not load
  per-project `.lien.config.json`. Documented limitation: a project that
  customises `complexity.thresholds` heavily will see headroom computed against
  defaults; wiring config into `ToolContext` is a deferred follow-up (YAGNI).
- **Cap 5 per file**, sorted worst-first. Overflow is noted with a sibling
  `complexityHeadroomMore: <N>` (count of near/over functions beyond the 5 shown),
  present only when truncated.
- The field (and its `More` sibling) is **omitted entirely** when nothing is near
  budget — the overwhelmingly common case — so quiet files pay zero bytes.

### Discoverability

One sentence added to the `get_files_context` tool description and one to the
server instructions, naming the field. No other tool guidance is reworded.

## F. Phase-1 review findings (fixed on this branch)

Lien Review flagged five legitimate issues on the merged Phase-1 code, all in the
files Phase 2 touches. They are fixed here (commit `fix(delta): address Phase-1
review findings`) so they ship before Phase 1 reaches users:

1. **`classifyMetric` "improved" semantics** (`complexity-delta.ts`). A function
   that drops but stays over threshold (e.g. 20→18 @ 15) was reported `improved`,
   which reads as "this is fine" for a still-violating function. **Decision:**
   `improved` is reserved for drops that land **strictly below** threshold; a
   still-over-threshold decrease is `pre-existing` (the violation persists). Exit
   code is unaffected either way (neither is a regression), but the report must
   not imply a still-violating function is healthy. Boundary tests: 20→18@15
   (`pre-existing`), 20→14@15 (`improved`), 20→15@15 (`pre-existing`).
2. **`--threshold` validation** (`delta-cmd.ts`). Parsed with
   `parseInt`+`isNaN` only, so `-5` (turns every function into a regression) and
   `5.7` (silently truncated) were accepted. Now requires a **positive integer**
   or exits 2 with a clear message. Tests: `-5`, `5.7`, `0`.
3. **`configService.load` rejection** (`delta-cmd.ts`). A malformed
   `.lien.config.json` produced a Node uncaught-exception exit instead of the
   operational exit-2 path. Now wrapped: clear message + exit 2.
4. **`readWorktree` swallowing all errors as null** (`delta-git.ts`). `null`
   downstream means "deleted", so an `EACCES`/`EISDIR` read masqueraded as a
   deletion. Now **only `ENOENT` → null** (genuinely absent); any other errno is
   re-thrown to the operational (exit 2) path. Same treatment applied wherever
   the file maps read errors to null.
5. **Halstead-effort display vs classification** (`complexity-delta.ts` /
   `delta-cmd.ts`). The table `Math.round`ed effort-minutes (`60m` for 59.7)
   while classification used the raw value, so an under-limit function could
   render at-the-limit. **Decision:** display **floors** effort-minutes, so the
   shown number can never round *up* past a limit the classifier treats as under.

These interact cleanly with Phase 2: the hook and headroom both surface the
*corrected* verdicts, and finding #1's `improved`/`pre-existing` split is exactly
the distinction the hook relies on to stay silent on non-regressions.

## Phase 2 milestones

- [ ] 1. Phase-2 design doc section + draft PR (this section)
- [ ] 2. Fix Phase-1 review findings (5) + tests — separate commit
- [ ] 3. Mechanism 2: `lien delta --file` flag + `delta-write.sh` hook + hooks.json + unit tests
- [ ] 4. Mechanism 3: `complexityHeadroom` in `get_files_context` + description/instructions + unit tests
- [ ] 5. Verification: drive hook (3 transcripts) + MCP headroom response + latency; full gate green; changeset

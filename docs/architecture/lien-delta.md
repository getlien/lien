# lien delta: complexity accounting before the commit

`lien delta` computes the complexity difference between two versions of a
file, per function, and turns a new threshold crossing into signal an agent
can act on: a CLI exit code, a warning from the plugin's post-edit hook, a
headroom hint in `get_files_context`, and a check on every pull request. A
local event log (`lien stats`) tracks whether any of this changes what
agents actually commit.

## Motivation

An agent once shipped a PR that passed every gate (format, lint, typecheck,
build, test) but raised a function's cognitive complexity from under
threshold to **29 against a threshold of 15**. Nothing at edit time noticed;
the PR-review engine caught it after the fact, costing a full extra
fixer-agent run for something a roughly 50 ms deterministic check could have
flagged while the agent still had the change in hand.

Lien already computes cognitive, cyclomatic, and Halstead complexity per
function, and already surfaces threshold violations in PR review. The gap is
timing: the signal exists, but only after the code is pushed. `lien delta`
moves it to before the commit.

## What's built

- **The shared primitive** (`@liendev/parser`): computes a per-function
  complexity verdict from two content strings. See section A.
- **The `lien delta` CLI** (`packages/cli`): runs the primitive against
  `HEAD` or `--base <ref>`, with a text table, JSON output, and exit codes
  designed for a commit gate. See section B.
- **The gate liturgy**: `lien delta` is CLAUDE.md's sixth pre-commit gate.
  See section C.
- **A PostToolUse hook** (`plugins/claude/hooks/delta-write.sh`): warns
  once, right after an `Edit`/`Write`/`MultiEdit`, when that edit introduced
  a new crossing. See section D.
- **`get_files_context` headroom**: primes the agent with near- or
  over-budget functions before it writes, not just after. See section E.
- **A CI backstop**: `.github/workflows/ci.yml`'s `delta` job runs
  `lien delta --base` against the PR's target branch on every pull request.
  See section F.
- **An event log and `lien stats`**: a local JSONL log of every
  `lien delta` run, aggregated into 7- and 30-day windows.
- **The plan-time nudge**: the same headroom signal folded into the
  mandatory pre-edit `annotate` hook and the `get_files_context` response,
  so the warning reaches the agent before it writes, not only after.

Two things from the original design remain unbuilt: blocking a commit
outright on a crossing, and review's adoption of the shared primitive.
`packages/review/src/delta.ts` still computes its own report-level delta
rather than calling `computeComplexityDelta`; see "Relationship to PR
review" below.

## A. The shared primitive (`@liendev/parser`)

### Where it lives

`packages/parser/src/insights/complexity-delta.ts`, exported from
`packages/parser/src/index.ts`. It sits beside `analyzeComplexityFromChunks`
(same directory, same metric machinery) rather than reimplementing anything.

### How it reuses existing machinery

The primitive does not invent metrics. It calls the existing
`chunkFile(filepath, content, opts)` (from `chunker.ts`), which already:

1. parses content via tree-sitter (`chunkByAST`),
2. emits one chunk per function/method with
   `complexity` (cyclomatic), `cognitiveComplexity`, `halsteadEffort`,
   `halsteadBugs`, `symbolName`, `parentClass`, `signature`, `startLine`.

`chunkFile` takes a content string, not a path on disk, so the primitive can
chunk a "before" image (`git show HEAD:file`) and an "after" image (working
tree) purely in memory, with no second checkout. This is the key difference
from the existing review-side delta (see "Relationship to PR review" below).

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
1.5`); a partial override is deep-merged over the defaults. See the
[configuration guide](../../packages/site/docs/guide/configuration.md#thresholds)
for how a project sets these.

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

One boundary matters more than the pseudocode above shows: when a metric
decreases while the function was already over threshold, `improved` applies
only if the new value now clears the threshold. A decrease that leaves the
function still over threshold is `pre-existing`, not `improved`, since
reporting it as `improved` would read as "this is fine" for a function
that's still in violation. Against a threshold of 15: 20 to 18 is
`pre-existing`, 20 to 14 is `improved`, and 20 to 15 is `pre-existing` (15
still meets the "at or over threshold" bound).

A function's overall `verdict` is the worst of its per-metric verdicts,
ordered `crossed > new-over-threshold > pre-existing > worsened >
new-under-threshold > improved > unchanged > removed`. `isRegression` is
true iff that verdict is `crossed` or `new-over-threshold`.

All four metrics can produce a regression. This is deliberate: it's exactly
the set `analyzeComplexityFromChunks` (and therefore PR review) already
scores, so a delta regression and a review violation are the same event
computed the same way. Metric-selection policy (for example, "only
cognitive gates, Halstead is advisory") is a plausible future knob, but it
would then be tuned in this one shared primitive and both engines would
move together. It is not a config surface today (YAGNI).

### Function matching across versions

Functions are matched by qualified name: `` `${parentClass ?? ''}::${symbolName}` ``.
When a key has multiple functions on one side (overloads, or same-named
methods), they are paired positionally by ascending `startLine`; any extra
on the "after" side are `added`, any extra on the "before" side are
`removed`.

Known limitations:

- **Renames are not tracked at the function level.** Renaming `foo` to `bar`
  reads as `foo` removed plus `bar` added. If `bar` is over threshold it
  surfaces as `new-over-threshold`. This is defensible (a new over-threshold
  function did appear) but can nag on pure renames. File-level rename
  detection (`--find-renames`) still lets us diff the body, so a
  renamed-but-unchanged file produces no function-level noise; only
  function *identifier* renames are affected.
- **Signature changes do not break matching.** The key is name plus parent,
  not the full signature, so changing parameters or the return type still
  matches the same function, which is the common "edited a function" case.
- **Overload disambiguation is positional**, best-effort. TypeScript
  overloads that reorder could mis-pair; rare enough to accept.

## B. The `lien delta` CLI command

`packages/cli/src/cli/delta-cmd.ts`, registered in `packages/cli/src/cli/index.ts`.

### Behaviour

1. Resolve the project root (walk up to `.git`, mirroring existing commands).
2. Load thresholds from `.lien.config.json` via `configService.load()`
   (`@liendev/core`), the same source the review reads, falling back to
   built-in defaults when the file or the `complexity` block is absent.
   `--threshold <n>` overrides `testPaths` + `mentalLoad` (parity with the
   review's single `--threshold`). It must be a positive integer; a
   negative, zero, or non-integer value exits 2 with a clear message
   instead of silently changing the gate's meaning. A malformed
   `.lien.config.json` also exits 2, rather than crashing with an
   uncaught exception.
3. Discover changed files (working tree vs `HEAD`):
   - `git diff --name-status --find-renames HEAD` for tracked changes
     (this already unions staged and unstaged, since it compares HEAD to
     the working tree),
   - plus `git ls-files --others --exclude-standard` for untracked new
     files (treated as `added`).
   - Filter to parser-supported code extensions (`getSupportedExtensions()`).
4. For each changed file, build a `FileContentChange`:
   - modified: `before = git show HEAD:path`, `after = read(worktree)`;
   - added / untracked: `before = null`, `after = read(worktree)`;
   - deleted: `before = git show HEAD:path`, `after = null`;
   - renamed: `before = git show HEAD:oldPath`, `after = read(worktree:newPath)`,
     `oldPath` set.
5. Call `computeComplexityDelta(changes, thresholds)`.
6. Print the table and summary; exit per the codes below.

### Edge cases and validation

- **Unborn HEAD** (no commits yet): `git rev-parse --verify HEAD` fails, so
  every changed, tracked, or untracked file is treated as `added`
  (`before = null`).
- **Not a git repo**: operational error, exit 2.
- **Worktrees**: `HEAD` and `git show HEAD:path` resolve against the
  current worktree's own HEAD; no special handling needed.
- **File reads**: a read distinguishes absence (`ENOENT`, treated as
  `null`, meaning deleted) from any other error (permissions, a path that's
  actually a directory), which is an operational failure (exit 2) instead
  of being silently read as a deletion.

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
emits the `ComplexityDeltaResult` for tooling. Halstead-effort minutes in the
table are floored, not rounded, so a function just under the effort
threshold never displays a rounded-up number that looks like it crossed.

### Exit-code semantics (designed for the gate liturgy)

| Code | Meaning |
|------|---------|
| **0** | No new threshold crossings (or `--soft`). Improved / pre-existing / worsened-but-under do **not** fail. |
| **1** | At least one regression: `new-over-threshold` or `crossed`. |
| **2** | Operational failure: not a git repo, git missing, or unreadable file. (Distinct from 1 so a gate can tell "found problems" from "couldn't run".) |

`--soft` forces exit 0 always (advisory mode) while still printing the
table, for agents that want the signal without the gate teeth during
exploration.

This asymmetry is deliberate: you are penalized only for making things
worse than `HEAD`, never for pre-existing debt you happened to touch, so
the gate cannot block unrelated work in a hot file.

### `--base <ref>`: comparing against a ref other than HEAD

Comparing the working tree to `HEAD` is the right default for an agent
running the gate locally mid-edit, but it has a blind spot in CI: by the
time a PR's branch is checked out, its commits are already `HEAD` and the
working tree is clean, so a crossing introduced by an earlier commit in the
same PR produces no diff at all against `HEAD`. Plain `lien delta` sees
nothing to flag.

`--base <ref>` compares the current state against any ref instead:

```bash
lien delta --base origin/main
lien delta --base origin/main --format json
lien delta --base HEAD~3 --file src/foo.ts
```

The pipeline is unchanged; only the ref supplying "before" content changes.
`collectFileChanges(rootDir, baseRef?)` and `collectFileChange(rootDir,
filePath, baseRef?)` both take an optional ref; omitted, behavior is
byte-for-byte the original HEAD-vs-working-tree path (including the
unborn-HEAD fallback, which only applies to that default case: an explicit
`--base` ref is validated to exist, so there is no "unborn base" to
handle). File discovery becomes `git diff --name-status --find-renames -z
<baseRef>` (replacing `... HEAD`), and "before" content is read via `git
show <baseRef>:path` (replacing `git show HEAD:path`); untracked files are
still additions regardless of the baseline. `--base` composes with every
other flag (`--file`, `--format json`, `--soft`, `--threshold`), and
omitting it is byte-for-byte identical to the original behavior.

A `--base` ref that does not resolve to a commit (`git rev-parse --verify
--quiet <ref>^{commit}`) is an operational error: a clear `base ref "<ref>"
not found` message, exit 2, the same convention as an unreadable file or a
missing git binary, not a silent no-op.

The CLI report header reflects the comparison point (`lien delta —
complexity vs origin/main` instead of `... vs HEAD`), so `--format text`
output is honest about what it compared; `--format json` is unaffected,
since the ref isn't part of `ComplexityDeltaResult`, only the CLI's own
report header.

### Optional MCP variant (deferred)

`get_complexity({ diff: true })` is attractive but doesn't fall out of the
primitive and CLI for free: the existing `get_complexity` handler reads the
persisted index, while the delta primitive is content-based against a git
ref. Wiring it means a new MCP schema field and a handler path that shells
out to git. Deferred; the CLI remains the primary surface.

## Relationship to PR review (a follow-up, not yet built)

`packages/review/src/delta.ts` computes a complexity delta at the report
level: it diffs two `ComplexityReport`s (base clone vs. head clone), so it
only sees functions that violate on one side. It cannot observe a function
that worsened while staying under threshold, and it requires the review
engine's two full checkouts.

The primitive in section A is strictly more capable: function-level, it
sees under-threshold movement, and it needs only content strings. The
intended follow-up, not yet done, is to have `packages/review` call
`computeComplexityDelta` on the before/after content it already has from
its two clones, and retire the report-diffing logic in
`review/src/delta.ts`. That is what would structurally guarantee write-time
and review-time verdicts agree: one function, one classification table, two
callers.

## C. Gate liturgy

`lien delta` is the sixth commit gate:

1. CLAUDE.md's "Before EVERY Commit (MANDATORY)" section lists `lien delta`
   after `npm test`.
2. `lien init`'s only agent-facing artifact today is the read-only Explore
   agent (`packages/cli/src/cli/agents/explore-agent.ts`); it surfaces
   `lien delta` guidance under the "Safe to change? / tech-debt" framing
   that agent already uses. A dedicated project-scoped gate template
   emitted by `lien init` is a new output surface and stays out of scope
   (YAGNI).

## D. Mechanism 2: the PostToolUse hook on Edit/Write (detection)

A Claude Code plugin hook, `plugins/claude/hooks/delta-write.sh`
(registered in `plugins/claude/hooks/hooks.json`), fires after every
`Edit`, `Write`, and `MultiEdit` tool call and warns, once and concisely,
only when that edit introduced a new complexity threshold crossing. It
reuses the primitive and CLI above unchanged: the hook shells out to
`lien delta` itself, so hook and CLI verdicts can never diverge.

### How it locates and drives the CLI

It mirrors `annotate-read.sh`: `command -v jq` and `command -v lien` exit 0
(silent) if either is missing (the hook never assumes a bundled binary; it
uses whatever `lien` is on `PATH`, like every other Lien hook). It reads
the PostToolUse payload from stdin, pulls `tool_name`,
`tool_input.file_path`, and `cwd` with `jq`, and runs the delta from `cwd`
so `resolveProjectRoot` and `git` resolve against the session's repo
(multi-repo safe).

### hook → CLI invocation (the key decision)

The hook drives the primitive through a `--file <path>` flag on
`lien delta` rather than running the full working-tree scan and filtering
the JSON:

- The full scan runs `git diff HEAD` across every changed file, reads
  each, and chunks each: wasteful when this hook fires on every edit and
  cares about exactly one file. `--file` bounds the work to a single
  `git show HEAD:<path>`, one working-tree read, and one before/after
  chunk pair.
- It is the same code path and the same `computeComplexityDelta` call, so
  the hook's verdict and `lien delta`'s verdict cannot diverge.

`lien delta --file <path> --format json` semantics:

- Resolves `<path>` (absolute or relative) to a repo-relative path against
  the git root. A path outside the repo, or a non-code / unsupported
  extension, returns an empty result and exits 0 (the hook stays silent).
- `before = git show HEAD:<relpath>` (null when the file is untracked,
  new, or HEAD is unborn, in which case classification is
  absolute-threshold only); `after` is the working-tree content (null when
  deleted).
- Exit codes are unchanged (0 clean, 1 regression, 2 operational). The
  hook ignores the exit code and inspects the JSON `regressions[]` array
  instead, emitting a warning only when that array is non-empty, i.e. only
  for `crossed` / `new-over-threshold` verdicts. Worsened-but-under,
  pre-existing, and improved are all silent by design: an always-on hook
  that fires on advisory movement becomes wallpaper and burns context.

### Output channel

The hook emits, on stdout, the same JSON shape `annotate-read.sh` uses.
`additionalContext` is the only field that reaches the model on the next
turn (verified in CC 2.1.142; a bare `systemMessage` does not; see
[claude-code-hook-channels.md](claude-code-hook-channels.md) for the full
channel breakdown):

```json
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"⚠ lien delta: extractSymbols cognitive 12→29 (threshold 15) — consider simplifying before you commit."}}
```

The message lists up to the top 3 regressing functions (worst-first, as the
primitive already sorts them), each rendered `name metric before→after
(threshold N)`, with a `(+N more)` suffix when there are more. A
newly-added over-threshold function renders its `before` as `new`. The
hook stays silent (exit 0, no stdout) in every other case: no regression, a
non-code file, a file outside a git repo, an unreadable payload, or a
missing `jq`/`lien`. It never fails the user's edit (`set -u`, best-effort
throughout, always `exit 0`).

Kill switch: `LIEN_DELTA_HOOK=off`.

### Performance

The hook's cost is dominated by CLI process startup (Node plus loading the
bundled `@liendev/lien` image), not the delta computation itself, which
takes a few milliseconds for a single file. Measured end-to-end (hook
script plus `lien delta --file`, including CLI startup): about 215 ms warm,
410 ms cold, well under the 1 s target and the 5 s hook timeout. Because
the cost is startup, not work, the optimization levers that would help (a
persistent `lien` daemon, a slimmer entrypoint) aren't worth pursuing now:
the measured number is already inside budget (YAGNI).

### Subagent caveat

Whether this PostToolUse hook fires for an `Edit`/`Write` performed inside a
subagent session depends on the same `Agent`-vs-`Task` tool-name matching
subtlety the explore hook already navigates (see
[claude-code-hook-channels.md](claude-code-hook-channels.md)). Verifying
this requires a live Claude Code run, not just the offline script tests.

## E. Mechanism 3: `get_files_context` headroom priming (prevention)

`get_files_context` is mandatory before any edit, which makes it the place
to prevent a crossing, not just detect one: when the agent asks for a
file's context, the response can name which functions are already near or
over their complexity budget, so the agent can steer around them before
writing a line.

### Zero re-parse

The complexity metrics (`complexity` = cyclomatic, `cognitiveComplexity`)
are already stored per chunk in the structural index (the `chunks` table
columns; `SELECT *` in `read-ops.ts` projects them, `buildMetadata` maps
them back onto `SearchResult.metadata`). The handler already fetches a
file's own chunks via `searchFileChunks`, so headroom is computed from data
already in hand: no second parse, no extra query.

### Shape

A new optional `complexityHeadroom` field per file: an array of the
functions at 80% or more of a threshold (near) or over it, worst-first:

```jsonc
"complexityHeadroom": [
  { "symbol": "scanPatches", "metric": "cognitive", "value": 14, "threshold": 15 }
]
```

- One element per function: the single metric closest to (or furthest
  over) its threshold, by `value / threshold` ratio, never two rows for
  one function.
- Metrics considered: cyclomatic and cognitive only. These are the
  integer, agent-actionable metrics that `--threshold` tunes; Halstead
  effort and bugs are deliberately left out of this hint to keep the
  payload lean (a prior tuning pass showed response bloat degrades agent
  behavior). The write-time `lien delta` gate still scores all four.
- Thresholds are the primitive's defaults
  (`DEFAULT_COMPLEXITY_DELTA_THRESHOLDS`: cyclomatic 15, cognitive 15).
  The handler stays zero-I/O: it does not load per-project
  `.lien.config.json`. A project that customizes `complexity.thresholds`
  heavily will see headroom computed against the defaults instead; wiring
  config into `ToolContext` is a deferred follow-up (see the
  [configuration guide](../../packages/site/docs/guide/configuration.md#thresholds)
  for how those overrides work).
- Capped at 5 per file, sorted worst-first. Overflow is noted with a
  sibling `complexityHeadroomMore: <N>` (the count beyond the 5 shown),
  present only when truncated.
- The field (and its `More` sibling) is omitted entirely when nothing is
  near budget, the common case, so quiet files pay zero bytes.

### Discoverability

One sentence in the `get_files_context` tool description and one in the
server instructions name the field. No other tool guidance is reworded.

## F. CI backstop

Before this job existed, `lien delta` was an honor-system gate: nothing
outside an agent's own discipline stopped a PR from merging with a new
complexity crossing buried in an earlier commit. Every other commit gate
(`format:check`, `lint`, `typecheck`, `build`, `test`) already ran in CI on
every PR; `lien delta` was the one an agent could forget to run and nobody
would know.

`.github/workflows/ci.yml` gains a `delta` job that runs only on
`pull_request` events:

```yaml
delta:
  if: github.event_name == 'pull_request'
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0 # need origin/<base> locally to diff against
    - uses: actions/setup-node@v4
    - run: npm ci
    - run: npm run build:core && npm run build -w packages/cli
    - run: node packages/cli/dist/index.js delta --base "origin/$GITHUB_BASE_REF"
```

`fetch-depth: 0` is required: a normal PR checkout is shallow and only
fetches the merge-commit ref, so `origin/<base-branch>` would not exist
locally to diff against. `$GITHUB_BASE_REF` is the PR's target branch name,
populated automatically by Actions on `pull_request` events (e.g. `main`);
the job compares the checked-out PR state against `origin/main`, catching a
crossing introduced by any commit in the PR, not just its latest one, which
is exactly the gap `--base` exists to close. A non-zero exit (a new
crossing) fails the job.

## Measuring the nudge loop: `delta-events.jsonl` + `lien stats`

The primitive, the CLI, the hook, and the CI backstop make `lien delta`
available, proactive at edit time, and enforced. None of it produces a
number proving the gate changes what agents actually commit. This log turns
that claim into local counters.

### Design constraints (non-negotiable)

- **Strictly local.** No network call, no telemetry, nothing phones home.
  Every event lives in a file on the user's own disk, next to the
  structural index it already trusts Lien to manage.
- **Instrument the source of truth, not the shell hook.** The recording
  call lives inside `deltaCommand` itself
  (`packages/cli/src/cli/delta-cmd.ts`), not in `delta-write.sh`, so a
  manual `lien delta`, the plugin hook's `lien delta --file <path>` fast
  path, and a CI `--base` run are all the same code path and therefore all
  counted; none of them can be run around the measurement.
- **No causal claims.** The field is named `resolvedAfterFlag`, not
  "warnings heeded" or "fixed", because v1 has no way to know why a
  function stopped being flagged. See the limitation below.

### The event log (`packages/cli/src/utils/delta-events.ts`)

One JSONL line is appended to `<indexDir>/delta-events.jsonl` per
`lien delta` invocation. `indexDir` is `getIndexDir(rootDir)` from
`@liendev/parser`, the same per-repo directory (`~/.lien/indices/<repoId>/`)
the structural index and manifest already live in, so there's no new
top-level location to reason about, garbage-collect, or explain.

```ts
interface DeltaEvent {
  timestamp: string; // ISO-8601, when the run completed
  mode: 'normal' | 'soft'; // '--soft' or not
  exitCode: number;
  counts: {
    crossings: number; // crossed + newOverThreshold — the gate-failing count
    newOverThreshold: number;
    improved: number;
  };
  // One row per (function, metric) with a failing verdict this run. Empty when clean.
  flagged: Array<{ filepath: string; symbol: string; metric: ComplexityMetricType }>;
}
```

`symbol` matches the CLI report's display name (`MyClass.doThing` when the
function has a parent class). Recording happens right after
`computeComplexityDelta` returns, using the exact `ComplexityDeltaResult`
the report and exit-code logic already computed: no second pass, no
re-parse.

**Growth cap.** After each append, if the file exceeds 2 MB
(`MAX_BYTES_BEFORE_TRIM`) it is trimmed from the front (oldest lines
dropped) down to the newest 2000 lines (`KEEP_LINES_AFTER_TRIM`): simple
and bounded, no silent unbounded growth. The common case, well under the
cap, pays only the append; the trim's read-modify-write only runs once the
file has actually grown large.

**Kill switch:** `LIEN_DELTA_EVENTS=off` disables recording (the gate
itself is unaffected: `lien delta`'s report and exit code never depend on
this). Recording is best-effort throughout: any failure (an unwritable
disk, a race with a concurrent writer) is swallowed silently so it can
never break the gate it instruments. A malformed line on read (say, a torn
write from a crash) is skipped rather than failing the whole read.

### Aggregation (`packages/cli/src/utils/delta-stats.ts`)

Pure functions over an in-memory `DeltaEvent[]`, no I/O, so trivially
unit-testable with synthetic event sequences. `computeDeltaWindowStats(events,
windowDays, now?)` reports, per window:

- **`runs`**: total `lien delta` invocations in the window.
- **`runsWithCrossings`**: runs where `counts.crossings > 0`.
- **`distinctFunctionsFlagged`**: unique `(filepath, symbol)` pairs
  appearing in any run's `flagged` list (metric is ignored for this
  identity: the same function flagged on two metrics in one run, or across
  runs, counts once).
- **`resolvedAfterFlag`**: a function flagged in one event and absent from
  the flagged set of a strictly later event in the window. Once a function
  is seen clean after being flagged, it counts even if a still-later run
  flags it again; the metric answers whether it was ever seen resolved,
  not whether it is currently clean.
- **`softShareOfFlaggedRuns`**: the fraction of crossing-having runs that
  were `--soft` (advisory only); `null` when there were no crossing-having
  runs.

### What `resolvedAfterFlag` does not mean

This is presence and absence over time, nothing more. A function can leave
the flagged list because an agent simplified it in response to the
warning, or because the file was rewritten for an unrelated reason, the
function was deleted, or a later unrelated edit happened to move a
Halstead-effort number back under threshold. v1 has no causal signal to
distinguish these; the field is named for exactly what it measures,
deliberately avoiding language that implies causation. A future version
could narrow this, for example by correlating with git blame on the
specific lines, but that is out of scope here.

### `lien stats` (`packages/cli/src/cli/stats-cmd.ts`)

A new top-level command, not a section bolted onto `lien status`. The two
answer different questions with different data shapes: `status` is a
point-in-time snapshot (does an index exist, is it stale, what mode is
worktree indexing in; all cheap `fs.stat`/`git rev-parse` calls with no
growth profile of their own), while `stats` aggregates a growing historical
log and reports time-windowed counts. Folding the second concern into
`status`'s already branchy `--verbose` output would couple two unrelated
read paths and make `status` slower as the log grows, for no reason
`status`'s own users asked for. This also matches an existing convention:
`lien gc` is a separate command for a different index-directory concern
rather than a `status` sub-mode.

`lien stats --format text|json` resolves the same repo root `lien delta`
itself uses (`getRepoRoot`, i.e. `git rev-parse --show-toplevel`, so it
reads from the exact directory `lien delta` just wrote to), reads all
events via `readDeltaEvents`, and reports the 7-day and 30-day windows.
Text output ends with a one-line reminder of the local-only guarantee, the
kill switch, and the non-causal nature of `resolvedAfterFlag`; the same
disclaimer belongs in the tool's own output, not only in this doc.

### YAGNI cuts (deliberately not built in v1)

- No dashboards, no charts: the command prints numbers.
- No config surface beyond the one env kill switch: no
  `.lien.config.json` knobs for window sizes, cap thresholds, or output
  shape.
- No cross-repo aggregation: one event log per repo, matching how the
  structural index itself is already scoped per `repoId`. A user with
  several worktrees of the same repo gets one independent log per
  worktree (the same isolation the index already has), not a merged view.

## The plan-time nudge: moving the headroom signal before the write

The hook (D) and a manual `lien delta` both fire after code is written.
Mechanism E moved the underlying data earlier, to the mandatory pre-edit
`get_files_context` call, but it was still data, not a nudge an agent could
miss. This section turns that data into an imperative warning at two points
in the mandatory pre-edit workflow: reading the file, and calling
`get_files_context`.

### Why not a new `PreToolUse:Edit|Write` hook

The obvious design is a third plugin hook, `PreToolUse` on
`Edit|Write|MultiEdit`, mirroring `delta-write.sh`'s `PostToolUse`
counterpart. It doesn't work, per
[claude-code-hook-channels.md](claude-code-hook-channels.md):
`PreToolUse`'s only channel that delivers content the model reads is
`hookSpecificOutput.updatedInput.prompt`, and that's specific to the
subagent-launch tool (`augment-explore-task.sh` rewrites a launched
subagent's own prompt); `Edit`/`Write`'s `tool_input` has `file_path` and
`old_string`/`new_string` or `content`, never a `prompt` field to rewrite.
`PreToolUse`'s other channel, `exit 2` plus stderr, does reach the model,
but by blocking the tool call. Using it for an advisory nudge would
silently convert "steer away from this function" into a hard stop,
violating every existing hook's fail-open discipline: a warning must never
block the edit.

`annotate-read.sh` (`PostToolUse:Read`, `additionalContext`) already fires
right before the mandatory `get_files_context` → `Edit` sequence in the
normal agent workflow. Enriching its existing annotation reaches the same
moment, just before a write, through infrastructure already proven to
reach the model, with TTL suppression inherited for free instead of
rebuilt.

### What changed

- **`get-files-context.ts`**: `computeComplexityHeadroom`'s parameter type
  widened from `SearchResult[]` to a minimal `{ metadata: ChunkMetadata }`
  shape (`HeadroomInputChunk`); no behavior change, but now callable with
  `@liendev/parser`'s `CodeChunk[]` too, which is what `annotate-cmd.ts`
  has in hand. A new `formatComplexityHeadroomWarning(entries, overflow)`
  renders the headroom array as one imperative line (`⚠ Lien: <fn> <metric>
  <value>/<threshold> [(over)], … avoid adding complexity here; prefer
  extraction.`), shared by both callers below so the wording can't drift
  between them.
- **`get_files_context` response**: gains an optional
  `complexityHeadroomWarning` string field, spread into the response
  object before `complexityHeadroom` so it's the first thing the agent
  reads in the serialized JSON. Purely additive: `complexityHeadroom`
  itself is unchanged, so nothing that already parses it breaks.
- **`lien annotate` / `annotate-read.sh`**: `annotate-cmd.ts` now computes
  the same headroom for the file it's annotating (scoped to that file's
  own chunks; `allChunks` from `findDependents` spans dependents too, so
  it's filtered down first) and, when non-empty, prepends the shared
  warning line ahead of the "Lien impact for …" header, the first line the
  agent sees. `isTrivial` gained a fourth `headroomCount` parameter
  (defaulted to `0` so existing 3-arg callers are unaffected): a
  near/over-budget function now forces the annotation to print even when
  dependents, tests, or complexity would otherwise call it trivial.

### What was deliberately deferred

A `delta-events.jsonl` entry for "nudge shown" (to let `lien stats`
eventually correlate warnings shown against later crossings flagged) was
scoped out. `DeltaEvent`'s shape (`mode`, `exitCode`, `counts.crossings`)
is built around a delta run, not a read-time annotation; there's no exit
code or crossings count for "the agent read a file and saw a warning."
Fitting a nudge event into that shape would mean either overloading
`DeltaEvent`'s existing fields with meanings they don't have, or
introducing a second event or log format alongside it: real design work,
not a natural extension of the current schema. Left as a follow-up once
there's a clearer answer for what "correlate nudge-shown with
later-resolved" should even mean when the nudge fires on a read,
potentially many turns before any edit happens.

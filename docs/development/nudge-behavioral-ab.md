# Behavioral A/B: does Lien's complexity nudge change what an agent writes?

A small, pre-registered experiment testing whether the near-budget warning
Lien surfaces to a coding agent (the mechanism in open PR #772,
`feat(cli,plugin): plan-time complexity nudge before edits`) measurably
changes the code a Sonnet subagent produces for an identical task, relative
to an identical prompt with no warning.

**Headline result:** the nudge changed both the crossing rate and the
extraction behavior. Control crossed its complexity threshold in 8/8 trials;
the nudge condition crossed in 3/8, and every trial that avoided crossing did
so by extracting a helper function, exactly what the warning's wording
("prefer extraction") asks for. N=8/condition is small; see Limitations.

This document *is* the citable artifact: the prior A/B referenced from
PR #772 and elsewhere in this repo's history lived only in unpublished
session records. This is dogfooding #772's warning line for real, not a
synthetic example.

## Protocol (pre-registered, frozen before any trial ran)

The full pre-registration (hypothesis, exact prompt template, exclusion
rules, and analysis plan, written and frozen *before* the first trial was
launched) is preserved verbatim below. (Original: `.wip/ab-nudge-protocol.md`
in the branch that ran this experiment; gitignored, referenced here by name
per this repo's `.wip/` convention for temporary docs.)

> ### Hypothesis
>
> Injecting Lien's real near-budget complexity warning (as rendered by
> `lien annotate`, the mechanism shipped in PR #772) into a coding-task prompt
> measurably reduces the rate at which a Sonnet subagent's generated edit
> pushes the target function's complexity over threshold, relative to an
> identical prompt with no warning.
>
> Null hypothesis: the warning has no effect (or a reversed effect) on
> crossing rate / complexity delta.
>
> ### Target function
>
> `formatDeltaText` in `packages/cli/src/cli/delta-cmd.ts` (repo root, commit
> `180f62c2`, the `origin/main` tip at freeze time).
>
> Baseline complexity (static, via `lien complexity`):
> - cyclomatic: 13 / threshold 15 (2 points of headroom)
> - cognitive: 13 / threshold 15 (2 points of headroom)
>
> Same file also contains `deltaCommand` (cyclomatic 12, cognitive 13 / 15),
> which is why the real annotate warning names both functions. Trials are not
> asked to touch `deltaCommand`; it is expected to remain `unchanged` in the
> delta report.
>
> ### Verbatim warning line (Condition A)
>
> Built from the REAL formatter shipped in open PR #772
> (`feat/plan-time-nudge`, commit `71d30b6`), not reconstructed by hand.
> Procedure: `git worktree add` a scratch checkout of that branch, `npm ci`,
> `npm run build:native -w @liendev/parser-native`, `npm run build`, then ran
> `node packages/cli/dist/index.js annotate packages/cli/src/cli/delta-cmd.ts`
> against the indexed repo. Output (top line only — this is what's injected):
>
> ```
> ⚠ Lien: formatDeltaText cyclomatic 13/15, deltaCommand cognitive 13/15 — avoid adding complexity here; prefer extraction.
> ```
>
> Diffing that build's annotate output against the same command run on
> current `main` (pre-#772) confirmed this warning line is the ONLY delta
> PR #772 introduces to `lien annotate`'s output for this file — everything
> below it ("Lien impact for …", dependents, test coverage) is identical in
> both builds. So the injected block is exactly, and only, the nudge under
> test.
>
> ### Conditions
>
> Both conditions receive a byte-identical prompt except for one inserted
> block (a `NOTE —` paragraph carrying the verbatim warning line above,
> placed after the file is shown and before the task instructions). Full
> template (`{{WARNING_BLOCK}}` is empty string in Condition B):
>
> ```
> You are asked to make one small, self-contained change to a single
> TypeScript file from an open-source CLI tool called Lien. Below is the
> CURRENT FULL CONTENT of `packages/cli/src/cli/delta-cmd.ts`.
> {{WARNING_BLOCK}}
> TASK:
> `formatDeltaText` (in the file below) renders a human-readable report. Add
> ONE feature: when a single file's function list is long, cap it.
> Specifically — inside `formatDeltaText`, for each file being rendered, if
> `file.functions.length` is greater than 20, print only the first 20
> function rows (in the existing order) and then append one additional
> summary line reading exactly `    … and N more` (dim-styled like the rest
> of the report, where N is the number of functions NOT shown), instead of
> printing every row. When a file has 20 or fewer functions, behavior is
> unchanged.
>
> Implement this as a real, working code change — not a comment or TODO. You
> may add a small helper if you want to; you may also inline it directly in
> `formatDeltaText` — the choice is yours.
>
> OUTPUT FORMAT (read carefully):
> - Do NOT use any tools, do NOT attempt to browse a filesystem or
>   repository — there is none available to you; this is a pure
>   text-completion exercise based solely on the file content given below.
> - Respond with ONLY the complete, modified file content in a single fenced
>   code block (```typescript ... ```). No other prose, no explanation,
>   before or after the code block. The code block must contain the ENTIRE
>   file from the first line to the last, with your change applied.
>
> --- BEGIN FILE: packages/cli/src/cli/delta-cmd.ts ---
> <verbatim content of packages/cli/src/cli/delta-cmd.ts @ 180f62c2>
> --- END FILE ---
> ```
>
> Condition A's `{{WARNING_BLOCK}}` (inserted verbatim, including blank
> lines shown):
>
> ```
>
> NOTE — Lien's own tooling annotated this file when it was read, with this
> exact message:
>
> ⚠ Lien: formatDeltaText cyclomatic 13/15, deltaCommand cognitive 13/15 — avoid adding complexity here; prefer extraction.
>
> ```
>
> Condition B: `{{WARNING_BLOCK}}` is the empty string (nothing inserted —
> no mention of complexity, thresholds, or Lien's analysis anywhere in the
> prompt).
>
> Task prompt is otherwise byte-identical across all 16 trials. No repo
> access, no tools, no MCP — each trial is a single generation turn from a
> fresh subagent with no memory of this conversation or of other trials.
>
> ### N and execution
>
> - N = 8 trials per condition, 16 total.
> - Each trial = one fresh `Agent` tool call, `subagent_type: general-purpose`,
>   `model: sonnet`, no `isolation` (no worktree needed — trials don't touch
>   the repo).
> - Naming: `nudge-trial-control-1..8` (Condition B), `nudge-trial-signal-1..8`
>   (Condition A) — chosen to avoid collision with an unrelated `ab-1550-*`
>   agent lineage already visible in this session's roster.
> - Trials run independently; order (control first or signal first) is not
>   expected to matter since each is a stateless fresh subagent, but for the
>   record trials are launched in interleaved batches, not all-control-then-
>   all-signal, to avoid any systematic drift (e.g. infra warm-up) correlating
>   with condition.
>
> ### Primary metric
>
> For each trial, apply the returned file verbatim to
> `packages/cli/src/cli/delta-cmd.ts` in a clean git working tree at commit
> `180f62c2` (this worktree, file restored via `git checkout --` before and
> after each trial), then run:
>
> ```
> node packages/cli/dist/index.js delta --file packages/cli/src/cli/delta-cmd.ts --format json
> ```
>
> which diffs working tree vs `HEAD` using the same static-analysis primitive
> `lien delta` uses in CI/hooks (tree-sitter parse, no execution of the code).
> **Primary outcome:** does `formatDeltaText` (or any function in the file)
> receive verdict `crossed` or `new-over-threshold` on the `cyclomatic` or
> `cognitive` metric? (A "crossing" per the pre-registered hypothesis.)
> Reported as a per-condition crossing rate (crossings / valid trials).
>
> ### Secondary metrics
>
> 1. **Cognitive-complexity delta of `formatDeltaText` specifically** — the
>    `before`/`after` pair for `metricType: 'cognitive'` on the
>    `formatDeltaText` entry in the same JSON output (or `unchanged`/absent if
>    the function wasn't touched, in which case delta = 0 and before value is
>    read from the baseline instead, i.e. 13→13).
> 2. **Extraction signal** — count of functions in the delta JSON's `functions`
>    array for this file carrying verdict `new-under-threshold` or
>    `new-over-threshold` (i.e. genuinely new symbols not present in the
>    baseline) — a proxy for "did the trial extract a helper instead of
>    inlining." Cross-checked by eyeballing the diff (new top-level `function`
>    declarations not named `formatDeltaText`/`deltaCommand`/etc.).
> 3. **Dogfood note** — for Condition A trials only: does the response's
>    generated code (or, if present, any inline comment) show evidence the
>    warning's wording ("prefer extraction") was heeded, e.g. a new named
>    helper function extracted specifically to keep `formatDeltaText`'s body
>    flat? Judged qualitatively per-trial in the write-up, not statistically.
>
> ### Exclusion rules (pre-registered, not silently dropped)
>
> A trial is **invalid** (excluded from the primary/secondary metric
> aggregates, but its count is reported per condition) if any of:
>
> 1. The response's fenced code block cannot be cleanly extracted as the sole
>    payload (missing/malformed code fence, or prose mixed into the block that
>    isn't valid TypeScript).
> 2. The extracted file fails `npx tsc --noEmit -p packages/cli/tsconfig.json`
>    after being swapped into place (real compile-validity check against the
>    actual project tsconfig — catches both syntax errors and type errors).
> 3. The response shows unambiguous internal evidence of tool use (e.g. it
>    narrates reading additional files, running shell commands, or quotes
>    content never included in the prompt) despite the explicit "do not use
>    tools" instruction — such a trial is not "pure generation" and is
>    invalid regardless of whether its code compiles.
>
> Invalid trials are still reported (count per condition, and the reason),
> per the task's instruction not to silently drop them.
>
> ### Analysis plan
>
> - Report crossing rate (crossings / valid N) per condition, raw counts.
> - Report mean and per-trial cognitive-complexity delta for `formatDeltaText`
>   per condition.
> - Report extraction-signal count per condition (and read the dogfood
>   question qualitatively for Condition A).
> - Report invalid-trial counts per condition with reasons.
> - **No significance testing.** N=8/condition is a small, pre-registered
>   comparison. State effect direction and raw numbers plainly. If the
>   observed effect is null, absent, or reversed, that is reported as the
>   result, and the launch-announcement claim is flagged for the owner to
>   drop or soften accordingly — this protocol does not permit post-hoc
>   re-framing of a null result as inconclusive-therefore-supportive.
>
> ### Known limitations (frozen up front)
>
> - Single task, single target function, single file, single language
>   (TypeScript), single model (Claude Sonnet) — this is not a claim about
>   nudges in general, only about this one nudge/task pair.
> - Trials are pure single-turn generation with the full file pasted in
>   context and no tool access — not a faithful reproduction of an agent
>   editing a file mid-session with full repo context, prior conversation,
>   and its own judgment about whether to even open the file. Real-world
>   effect size may differ in either direction.
> - No mechanism fully guarantees a subagent honored "do not use tools";
>   mitigated by instruction + manual inspection per exclusion rule 3, not
>   by hard sandboxing.
> - `lien delta`'s own documented limitation applies here too: function-level
>   renames aren't tracked and overloads are paired positionally — irrelevant
>   for this single-function edit but noted for completeness.

## Results

### Invalid trials

**0 / 16.** Every trial's response was a single clean fenced code block
(no stray prose), every extracted file passed `npx tsc --noEmit -p
packages/cli/tsconfig.json`, and every trial's own async-agent metadata
reported `tool_uses: 0`, independently confirming the "no tools" instruction
was honored, not just assumed.

### Primary metric: crossing rate

| Condition | Crossed | Rate |
|---|---|---|
| Control (no warning) | 8 / 8 | **100%** |
| Signal (warning injected) | 3 / 8 | **37.5%** |

"Crossed" = `formatDeltaText` received verdict `crossed` or
`new-over-threshold` on the `cyclomatic` or `cognitive` metric in `lien
delta`'s JSON output, comparing the trial's file against `HEAD`
(commit `180f62c2`).

### Per-trial detail

`formatDeltaText` baseline: cyclomatic 13, cognitive 13 (threshold 15 for
both).

| Trial | Cyclomatic (13→) | Cognitive (13→) | Crossed? | Extracted a helper? |
|---|---|---|---|---|
| control-1 | 14 | 15 | ✗ crossed | no |
| control-2 | 14 | 15 | ✗ crossed | no |
| control-3 | 14 | 15 | ✗ crossed | no |
| control-4 | 14 | 15 | ✗ crossed | no |
| control-5 | 14 | 15 | ✗ crossed | no |
| control-6 | 14 | 15 | ✗ crossed | no |
| control-7 | 14 | 15 | ✗ crossed | no |
| control-8 | 14 | 15 | ✗ crossed | no |
| signal-1 | 12 | 11 | ✓ clean | **yes** (`pushFunctionRows`) |
| signal-2 | 14 | 15 | ✗ crossed | no |
| signal-3 | 14 | 15 | ✗ crossed | no |
| signal-4 | 14 | 15 | ✗ crossed | no |
| signal-5 | 13 (unchanged) | 13 (unchanged) | ✓ clean | **yes** (`fmtFileFunctionRows`) |
| signal-6 | 12 | 11 | ✓ clean | **yes** (`fmtFileFunctions`) |
| signal-7 | 12 | 11 | ✓ clean | **yes** (`pushFunctionRows`) |
| signal-8 | 12 | 11 | ✓ clean | **yes** (`fmtFileFunctions`) |

Every control trial produced structurally the same edit: an inline
`if (functions.length > 20) { slice + push "… and N more" }` block added
directly to `formatDeltaText`'s existing loop, hence identical complexity
numbers across all 8 (13→14 cyclomatic, 13→15 cognitive, every time).

Signal-2/3/4 produced the *same* inline pattern as every control trial: the
warning didn't move them. The other five signal trials extracted a small
helper (`pushFunctionRows` / `fmtFileFunctionRows` / `fmtFileFunctions`,
naming varies but the shape is identical: slice, map, push a dim summary
line) and called it from `formatDeltaText`, which is exactly the "prefer
extraction" the warning asked for. Signal-5's extraction was clean enough
that `formatDeltaText`'s complexity is **not just under threshold but
byte-for-byte unchanged**: the call site swap (`for (const fn of
file.functions) lines.push(fmtFunction(fn))` → `for (const row of
fmtFileFunctionRows(file.functions)) lines.push(row)`) preserves the exact
same branching shape.

`deltaCommand` (the file's other near-budget function, cyclomatic 12 /
cognitive 13, mentioned in the same warning line) was left untouched
(`unchanged`) in all 16 trials, as expected: the task only asked trials to
modify `formatDeltaText`.

### Secondary metric: cognitive-complexity delta

| Condition | Per-trial cognitive delta (after − before) | Mean |
|---|---|---|
| Control | +2, +2, +2, +2, +2, +2, +2, +2 | **+2.0** |
| Signal | −2, +2, +2, +2, 0, −2, −2, −2 | **−0.5** |

Control's cognitive complexity moved in exactly one direction (up, into the
crossing zone) in every trial. Signal's mean is negative: the five
extraction trials pulled the average down enough to more than offset the
three trials that matched control's inline pattern.

### Secondary metric: extraction signal

| Condition | Trials that extracted a new helper function |
|---|---|
| Control | 0 / 8 |
| Signal | 5 / 8 |

In this dataset, extraction and avoiding-the-crossing are perfectly
correlated: every trial that extracted a helper stayed under threshold (or,
in signal-5's case, left complexity completely unchanged); every trial that
didn't extract crossed the threshold, control and signal alike.

### Dogfood note: did the warning's wording pull its weight?

The injected line ends with `— avoid adding complexity here; prefer
extraction.` Two of five extracting trials (signal-1, signal-7) named their
helper `pushFunctionRows` and included an explicit comment tying the
extraction back to the warning, e.g. signal-1's:

> `Extracted so the summary branch doesn't add to formatDeltaText's own
> complexity budget (see the file-level complexity note above).`

and signal-7's near-identical phrasing. Signal-6 and signal-8 similarly
commented "kept out of `formatDeltaText` to avoid adding to its complexity"
/ "extracted out of `formatDeltaText` to keep that function's own complexity
from growing (see the file-level Lien annotation)." Signal-5 extracted
without an explicit comment tying it to the warning, but produced the
cleanest result of all 16 trials (zero complexity change). So: yes, the
specific "prefer extraction" wording appears to have pulled its weight: four
of the five extracting trials explicitly cited the warning as their reason
for extracting, in their own generated code comments, not prompted to explain
themselves.

## Honest read

This is a small (N=8/condition), single-task, single-model, generation-only
comparison, not a general claim about nudges. Within those bounds: a
100%→37.5% crossing-rate swing, a mean cognitive-delta flip from +2.0 to
−0.5, and a perfect correlation between the nudge condition's extraction
behavior and avoiding the crossing, with several trials explicitly
narrating "the warning told me not to add complexity here" in their own
generated comments. The effect is not subtle, and it runs in the
pre-registered direction. The biggest caveat is generalizability: real
Lien usage is multi-turn, tool-using, and the agent chooses what to read in
the first place. This experiment measures a narrower thing (does the
warning change a single forced generation), and a real edit-time nudge
could plausibly perform better *or* worse than this. The launch-announcement
claim ("Lien's nudge changes what an agent writes") is supported by this
artifact for the scope tested; it should be stated with that scope, not
generalized further than the data license.

## Artifacts

- Protocol: `.wip/ab-nudge-protocol.md` (gitignored, referenced above)
- Raw per-trial outputs: `.wip/ab-trials/{control,signal}-{1..8}.ts`
  (gitignored)
- Measurement script + logs: `.wip/run-trials.sh`,
  `.wip/ab-results/*.{tsc.log,delta.json,delta.err}` (gitignored)

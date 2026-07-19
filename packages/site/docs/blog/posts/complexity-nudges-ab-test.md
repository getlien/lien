---
title: "Do Complexity Nudges Change What Agents Write? A Pre-Registered A/B"
description: "A small, pre-registered experiment: does Lien's near-budget complexity warning measurably change the code a coding agent produces? 8 trials per condition, no significance theater, numbers as they landed."
date: 2026-07-19
author: Alf Henderson
tags: [evidence, agents, complexity]
draft: true
---

<!-- DRAFT: awaiting owner voice pass -->

# Do Complexity Nudges Change What Agents Write? A Pre-Registered A/B

Lien's write-side hook runs `lien delta` after every edit — a deterministic,
~50ms check that speaks up only when *that specific edit* pushes a function's
complexity over a threshold it wasn't over before. The plan-time nudge in
[PR #772](https://github.com/getlien/lien/pull/772) goes a step further:
before an agent even makes an edit, Lien can surface a near-budget warning
for a function it's about to touch — "this is close to its complexity
ceiling; prefer extraction" — while there's still time to act on it.

Both are cheap to build. Neither is worth anything if agents just ignore the
warning and write the same code anyway. So before claiming this changes
anything, we ran a small, pre-registered experiment to check.

## What we tested

**Hypothesis:** injecting Lien's real near-budget complexity warning into a
coding-task prompt measurably reduces the rate at which a coding agent's
generated edit pushes the target function's complexity over threshold,
relative to an identical prompt with no warning.

**Target function:** `formatDeltaText` in `packages/cli/src/cli/delta-cmd.ts`,
sitting at cyclomatic 13/15 and cognitive 13/15 — two points of headroom on
both metrics, the same headroom lien's own `annotate` command would flag in
real usage.

**The task:** add one feature (cap a long function list at 20 rows, append a
summary line for the rest) to `formatDeltaText`. Both conditions received a
byte-identical prompt, except for one inserted block: the real warning line,
built from the actual PR #772 formatter, not reconstructed by hand —

```
⚠ Lien: formatDeltaText cyclomatic 13/15, deltaCommand cognitive 13/15 — avoid adding complexity here; prefer extraction.
```

Condition A (signal) got that block. Condition B (control) got nothing —
no mention of complexity, thresholds, or Lien anywhere in the prompt. Every
trial was a single, fresh, tool-less generation: no repo access, no memory of
other trials, so nothing about the setup could leak between conditions.

**N = 8 trials per condition, 16 total.** Small by design — this is a
pre-registered check on one nudge and one task, not a claim about nudges in
general. The full protocol (exact prompt template, exclusion rules, analysis
plan) was written and frozen *before* the first trial ran; it's preserved
verbatim in [`docs/development/nudge-behavioral-ab.md`](https://github.com/getlien/lien/blob/main/docs/development/nudge-behavioral-ab.md).

Every trial's output was applied to a clean copy of the real file and scored
with the same static-analysis primitive `lien delta` uses in CI: does
`formatDeltaText` cross its complexity threshold, yes or no. 0 of 16 trials
were excluded — every response was a clean, compiling code block, and every
trial's own metadata confirmed zero tool calls, independently corroborating
the "no tools" instruction was honored.

## Results

| Condition | Crossed threshold | Rate |
|---|---|---|
| Control (no warning) | 8 / 8 | **100%** |
| Signal (warning injected) | 3 / 8 | **37.5%** |

Every control trial produced the same shape of edit: an inline
`if (functions.length > 20) { … }` block added directly to
`formatDeltaText`'s existing loop. All 8 landed at cyclomatic 14, cognitive
15 — crossed, every time.

Five of the eight signal trials did something different: they extracted a
small helper function (`pushFunctionRows`, `fmtFileFunctionRows`,
`fmtFileFunctions` — naming varied, the shape didn't) and called it from
`formatDeltaText`, exactly the "prefer extraction" the warning asked for.
One of those (signal-5) extracted cleanly enough that `formatDeltaText`'s
complexity didn't move at all — byte-for-byte unchanged. The other three
signal trials matched control's inline pattern and crossed anyway — the
warning didn't move every trial, just most of them.

Cognitive-complexity delta tells the same story from a different angle:
control moved +2 in all 8 trials (into the crossing zone, every time);
signal's mean was **−0.5**, pulled down by the five extraction trials.

Extraction and avoiding-the-crossing were perfectly correlated in this
dataset: every trial that extracted a helper stayed under threshold (or, for
signal-5, left it unchanged); every trial that didn't, crossed — control and
signal alike.

## Did the wording actually matter, or just the presence of a warning?

Four of the five extracting trials cited the warning directly in their own
generated code comments, unprompted. Signal-1:

> "Extracted so the summary branch doesn't add to `formatDeltaText`'s own
> complexity budget (see the file-level complexity note above)."

Signal-6 and signal-8 used near-identical phrasing ("kept out of
`formatDeltaText` to avoid adding to its complexity"). Signal-5 — the one
with zero complexity change — extracted without an explicit comment tying it
to the warning, but produced the cleanest result of all 16 trials anyway.
So: the specific "prefer extraction" wording appears to have pulled real
weight, not just the fact that *something* was flagged.

## The honest read

This is a small (N=8/condition), single-task, single-model,
single-language, generation-only comparison. It is not a claim about
complexity nudges in general — only about this one warning, on this one
function, in this one task shape. Within those bounds, the result is about
as clean as a 16-trial experiment gets: a 100%→37.5% crossing-rate swing, a
mean cognitive-delta flip from +2.0 to −0.5, and a perfect correlation
between the nudge condition's extraction behavior and avoiding the crossing.

The biggest caveat is generalizability. Real Lien usage is multi-turn,
tool-using, and the agent chooses what to read in the first place — these
trials are pure single-turn generation with the full file pasted in and no
tool access, which is a narrower thing than an agent editing a file mid-session
with full repo context and its own judgment about whether to even open it. A
real edit-time nudge could plausibly perform better or worse than this. We're
stating the claim at the scope the data supports — "the warning changed what
a Sonnet subagent wrote, for this task" — not generalizing further than that.

We ran the analysis plan we pre-registered, on the numbers we got, without
re-framing a null result as inconclusive-therefore-supportive — there wasn't
a null result to reframe, but that commitment was made before we knew that.

[OWNER: your call on whether to add a line here about what this means for
the roadmap — e.g. whether the plan-time nudge graduates from PR #772 into
something more prominent, or what the next experiment should test.]

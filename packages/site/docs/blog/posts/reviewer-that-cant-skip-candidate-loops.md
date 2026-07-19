---
title: "A Reviewer That Can't Skip: Candidate Loops in Lien Review"
description: "How a real, live bug in drizzle-orm — 6 new column types silently unhandled by 4 downstream packages — became the evidence for a structural fix to how Lien Review handles crowded PRs."
date: 2026-07-19
author: Alf Henderson
tags: [evidence, review, architecture]
draft: true
---

<!-- DRAFT: awaiting owner voice pass -->

# A Reviewer That Can't Skip: Candidate Loops in Lien Review

Lien Review runs one LLM agent over a PR, checking it against up to nine
rules that all share one findings list. That sharing has a real, measured
cost: on a PR that carries both a boring documentation drift and a juicier
code bug, the model's one list rationally favors the code bug. That's the
finding the doc-truth arc landed months ago (PRs #722–#733) — and swapping
models didn't fix it, because the bottleneck is the shared output list
itself, not any one model's judgment. The fix that shipped then was narrow:
give doc-truth its own dedicated pass, its own budget, no competing rules.

[ADR-014](https://github.com/getlien/lien/blob/main/docs/architecture/decisions/0014-per-rule-candidate-loop-passes.md)
is the story of generalizing that fix — and the evidence that it actually
works came from a real, live bug we found in `drizzle-orm` along the way.

## The general shape: candidate loops

Not every rule can get a dedicated pass. Some rules are open investigations —
"where's the race condition in this locking code" has no enumerable worklist
to check off. But a rule qualifies for a dedicated **candidate loop** when
its signal produces a bounded, enumerable list of candidates, each with a
closed set of possible verdicts — the same shape doc-truth already had.

Three rules fit:

| Loop | Verdict vocabulary | What it catches |
|---|---|---|
| `stale-duplicate` | `stale \| intentional-reuse \| unverifiable` | A literal duplicated elsewhere that the PR changed in one place but not the other |
| `incomplete-handling` | `incomplete \| handled \| intentional \| unverifiable` | An added enum/union member, a sibling file, or a new struct field whose consumers weren't updated |
| `removed-exports` | `breaking \| intentional \| internal-only \| unverifiable` | A removed public export with a surviving caller |

Each one runs as its own pass: its own prompt, its own budget, no other
rule's findings competing for space in the output. `structural-analysis`
stays hybrid on purpose — its "did callers handle this *changed* export
correctly" half is still open investigation and stays in the shared pass
forever; only its removed-export half graduated to a loop.

Every loop ships **hybrid-gated**: it needs both an opt-in flag *and* at
least one real candidate before it fires, and the rule's own prompt text
never leaves the shared pass — the dedicated loop is additive, not a
replacement. That's a deliberate, non-default choice: none of these three
loops has a proven-over-inclusive-recall signal the way doc-truth's does, so
none of them graduate to running *instead of* the shared pass. Not yet.

## The part that actually needed proof

Building the mechanism is one thing. Showing it finds more real bugs than
the shared pass it's meant to improve on is another — and until mid-July,
that second part was untested. `incomplete-handling` needed a real,
ground-truthed bug to check against, not a synthetic example.

We found one in `drizzle-orm`. [PR #4172](https://github.com/drizzle-team/drizzle-orm/pull/4172)
adds a new "Gel" dialect and, with it, six new column-type variants —
`dateDuration`, `duration`, `relDuration`, `localTime`, `localDate`,
`localDateTime` — to drizzle's core `ColumnDataType` union. Four downstream
packages generate runtime validation schemas from that union:
`drizzle-arktype`, `drizzle-zod`, `drizzle-valibot`, and `drizzle-typebox`.
Every one of their `columnToSchema` functions still only branches on the
*original* nine members. None was ever updated for the six new ones.

The practical effect: a Gel column using any of those six new types falls
straight through every package's fallback branch — `type.unknown`,
`z.any()`, `v.any()`, `t.Any()` — and silently gets **no real runtime
validation** instead of a proper schema. It's exactly the shape
`incomplete-handling`'s `variant-sweep` signal exists to catch: a new
enum/union member added in one place, with consumer sites elsewhere that
never got the memo. We reported it upstream as
[drizzle-team/drizzle-orm#6027](https://github.com/drizzle-team/drizzle-orm/issues/6027).

## Same bug, two review arms

With a real bug in hand, we could finally run the comparison ADR-014 needed:
replay the same PR through the shared pass and through the dedicated
`incomplete-handling` loop, and see which one actually converts the evidence
into a finding.

**Shared pass** (flags off, competing against Lien Review's other active
rules): a 3-vote screen converted the bug into a real finding on **1 of 3**
votes. The other two votes aren't a mystery — their own tool-call traces show
them reading `get_files_context` and `read_file` on all four downstream
`column.ts` files. They looked at the right code. They just didn't say
anything about any rule, on any file, in that run.

**Dedicated `incomplete-handling` loop**: 3 of 3. That result was strong
enough to escalate to a full 10-vote calibration, the same bar every rule in
Lien Review has to clear before it can ship: **10/10** named the correct
variants and all four affected packages. (Three of the ten runs used a more
compact "unknown/any" phrasing our keyword gate hadn't anchored on yet —
once we added that anchor and re-scored the same ten transcripts offline, at
zero additional cost, all ten passed clean. The three-verdict smoke test —
does the assertion correctly pass a perfect answer, fail an empty one, and
fail a distractor — was re-run after the widening and never false-passed.)

The whole comparison — both arms, the escalation, the keyword tuning — cost
**$0.80 of a $1.40 authorized budget**. The fixture is committed:
[`pr4172-columndatatype-gel-gap.assertions.ts`](https://github.com/getlien/lien/blob/main/packages/review/test/harness/fixtures/crossrepo/pr4172-columndatatype-gel-gap.assertions.ts).

This is one fixture, one candidate shape (`variant-sweep` — the loop's other
two shapes, `sibling-surface` and `unread-field`, are untested by it), on one
model. It's not a corpus-wide lift claim. But it's the first same-fixture,
controlled comparison of a dedicated candidate loop against the shared
pass's own signal-augmented prompt — and on this bug, the shared pass
investigated the right files and stayed silent two-thirds of the time, while
the dedicated loop converted the same evidence into a finding every time.

## Why "can't skip"

The other half of this design is about what happens when a candidate loop
*doesn't* have an answer. The doc-truth arc's own worst finding (internally,
"pr658 Finding A") was a single claim silently dropped from a long worklist
— not wrong, just missing, with nothing in the output to say so.

Every candidate loop closes that gap structurally: the model must return
exactly one verdict for every candidate id in the worklist, from a fixed
vocabulary. A missing id, a duplicate, or an unrecognized verdict value
doesn't get silently ignored — it marks the pass's own result honestly
`incomplete` (`AgentStopReason: 'incomplete_verdict'`), the same way a
budget cutoff or a provider error already did. The pass can't quietly skip a
candidate and have that read as "nothing to report here."

That honesty is externally visible, not just an internal log line. Lien
Review attaches a delivery attestation to every run — a machine-readable
receipt naming which passes ran, why any pass didn't, and whether any pass
was cut short. Before this generalization, that receipt only had room for
one pass; a doc-truth-only budget cutoff would attest as the *main* pass
running out of budget, which was directionally honest but pointed at the
wrong entry. Attestation now carries one entry per pass that actually ran,
and the verdict computation attributes a starvation or partial result to
whichever specific pass stopped early. If a candidate loop can't finish its
worklist, the receipt says so, by name.

## What's still open

All three candidate loops are merged and dark — off by default for
`@liendev/review` and `@liendev/action` consumers, opt-in via a config flag
or env var. This repo's own CI opts `stale-duplicate` and
`incomplete-handling` into its Lien Review workflow to dogfood them against
real PRs; `removed-exports` hasn't been opted in yet. That's deliberate:
the mechanism is proven end-to-end (byte-diff-neutral when off, verified
attestation wiring, unit-tested completeness contracts), but corpus-wide lift
is proven for exactly one fixture and one candidate shape so far. Turning any
of these on by default is a separate, evidence-priced decision from building
them — and it hasn't been made yet.

[OWNER: your call on whether to preview a timeline for turning these on more
broadly, or leave this as a pure status report.]

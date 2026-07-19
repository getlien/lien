---
title: "Does Warning a Coding Agent Actually Change What It Writes?"
description: "We warned an AI coding agent, right before it touched a function, that the function was already hard to follow. Then we tested whether that actually changed what it wrote, or whether the agent just ignored it."
date: 2026-07-19
author: Alf Henderson
tags: [evidence, agents, complexity]
draft: true
---

<!-- DRAFT: awaiting owner voice pass -->

# Does Warning a Coding Agent Actually Change What It Writes?

If you tell an AI coding agent, right before it edits a piece of code, that
the code is already hard to follow, does it actually write something
simpler? Or does it read the warning, do the task anyway, and leave the
mess exactly as bad?

The obvious answer is "of course it listens, you told it to." But agents
skim past a lot of things buried in their instructions, and a warning
sitting next to an actual task is an easy thing to nod at and ignore. We
didn't want to guess. We wanted to test it fairly and see what actually
happened.

## What "hard to follow" means here

Software has a fairly standard way of scoring how tangled a function's
logic is: essentially, how many different paths the code can take
depending on its inputs. It's not a matter of taste. Once a function
crosses a certain score, most engineering teams agree it's gotten to the
point where it's risky to change safely, easy to introduce a bug in, and
annoying to review. Lien tracks that score for every function in a
codebase and can warn about it. The interesting question wasn't whether
Lien could compute the score. It was whether telling an agent about it,
right before an edit, would change anything.

## The test

We picked one real function from Lien's own code that was already sitting
right at that risky score, and gave an AI coding agent (Claude) one small,
well-defined feature to add to it. Then we ran the exact same task 16
times: 8 times with a short warning inserted first, and 8 times with
nothing extra at all, no mention of complexity, no hint that anything was
being measured.

The warning was not a paraphrase we wrote up for the blog. It was the
literal line Lien's own tooling produces when it flags a function like
this:

```text
⚠ Lien: formatDeltaText cyclomatic 13/15, deltaCommand cognitive 13/15. Avoid adding complexity here; prefer extraction.
```

Every one of the 16 attempts was a single, isolated response: no back and
forth, no access to the rest of the codebase, nothing carried over between
attempts. That was deliberate. It meant nothing about the setup could leak
between the warned group and the unwarned group. [The full write-up,
including the exact instructions given to the agent and how we scored the
results, is here](https://github.com/getlien/lien/blob/main/docs/development/nudge-behavioral-ab.md).

Every response was then dropped into a real copy of the file and scored
with the same complexity check Lien runs automatically on every code
change: did the function cross that risky line, yes or no. All 16
responses were usable. Nothing had to be thrown out.

## What happened

| Group | Crossed the risky line | Rate |
|---|---|---|
| No warning | 8 out of 8 | **100%** |
| Warned first | 3 out of 8 | **37.5%** |

Without the warning, every single attempt made the function worse in
exactly the same way: it added a new block of logic directly inside the
function, which pushed the complexity score over the line every time.

With the warning, five of the eight attempts did something different. They
pulled part of the logic out into a small, separate helper function and
called it instead, which is exactly what the warning suggested. One of
those attempts was clean enough that the function's score didn't move at
all. The other three warned attempts still made the same mistake as the
unwarned group. The warning didn't work every time. It worked most of the
time.

## Did the wording matter, or just the fact that something was said?

Four of the five successful attempts explained their own reasoning, in
their own code comments, without being asked to. One wrote that it had
pulled the logic into a separate function specifically "so the summary
branch doesn't add to formatDeltaText's own complexity budget." Others used
almost the same phrasing. That's a good sign the specific wording of the
warning did real work, not just the fact that a warning was there at all.

## The honest limits of this test

This was small: 16 attempts, one task, one function, one AI model, each a
single isolated response rather than a real editing session with full
access to a codebase and its own judgment about what to even look at. A
warning shown to an agent in the middle of real, multi-step work could
plausibly land harder or softer than it did here. We're not claiming this
proves anything about warnings in general. We're claiming that, for this
one task, telling the agent up front that a function was already too
complicated changed what it wrote, clearly and repeatably.

We also decided on how we'd score this before running a single attempt, so
there was no chance to reinterpret an unhelpful result after the fact. If
the warning had done nothing, that would have been the finding.

[OWNER: your call on whether to add a line here about what this means
next, e.g. whether warning agents before they edit becomes a bigger part
of how Lien works, or what the next test should look at.]

---
title: "The Blind Spot Every Reviewer Has, and the Bug That Proved It"
description: "A popular open-source database toolkit added six new column types. Four companion packages were never updated to handle them. Our automated reviewer read all the right files and still missed it, most of the time."
date: 2026-07-19
author: Alf Henderson
tags: [evidence, review, architecture]
draft: true
---

<!-- DRAFT: awaiting owner voice pass -->

# The Blind Spot Every Reviewer Has, and the Bug That Proved It

Any reviewer, human or automated, has a limited amount of attention for a
single pull request. When a change contains one obvious, dramatic bug and
one quiet, easy-to-miss one, the obvious bug wins. It's the one that gets a
comment. The quiet one slips through, not because anyone decided it wasn't
worth mentioning, but because it never had to compete for attention in the
first place.

Lien Review, the automated tool we built to comment on pull requests, had
exactly this problem. It checks a change against a whole list of things at
once: does this look like a security issue, does it introduce a naming
mismatch, does a change here quietly break something that depends on it,
and so on. All of that runs through one pass, competing for space in one
shared list of things to say. On a pull request with both a boring
documentation typo and a much juicier bug, the juicier bug tends to win.
That holds true even when you swap out the underlying AI model. The problem
was never a specific model. It was the setup: too much competing for one
shared attention span.

We'd already tried one fix, and it worked: pull one specific kind of check
out of the shared pile and give it its own dedicated pass over the pull
request, with nothing else competing for its attention. What we didn't have
yet was a real, live example proving that a dedicated pass actually catches
more than the shared one does. We found one by accident, in someone else's
code.

## A real bug hiding behind four files

We came across a genuine bug in Drizzle, a popular open-source toolkit that
JavaScript and TypeScript developers use to talk to databases. A recent
change to the project added six new kinds of database column. Drizzle also
ships four separate companion packages, each one responsible for turning a
database column's definition into validation rules for incoming data. None
of those four packages had been updated to recognize the six new column
types.

For someone actually using it, that meant a real problem. If you used one
of those new column types in your own project, and relied on one of those
companion packages to validate data before it reached your database, it
would quietly accept anything. No error, no warning, just silent acceptance
of values it should have rejected. [We filed the bug with the
project](https://github.com/drizzle-team/drizzle-orm/issues/6027) so it
could get fixed.

That's precisely the kind of quiet, easy-to-miss bug that loses to louder
ones when everything competes for the same attention. So we used it as a
real test.

## What happened when we gave it a narrower job

We ran the change through Lien Review the normal way, checking everything
at once, three separate times. It caught the bug once out of three, even
though its own internal record showed it had opened and read all four of
the affected files on every run. It was looking at the right code. It just
didn't say anything about it, two times out of three.

Then we gave the same check a narrower job. Instead of one shared pass over
the whole pull request, it got its own dedicated look at a specific list of
suspects (the four files, in this case), and had to give a real verdict on
each one: a real problem, not a problem, or can't tell. We ran that three
times. It caught the bug all three times. To make sure that wasn't luck, we
ran it ten more times after that: ten out of ten.

The whole comparison, both versions, every run included, cost less than a
dollar in AI usage.

## The receipts

The other half of this fix is about what happens when the reviewer
genuinely can't finish a job, whether it runs out of time, hits an error,
or anything else. Before this change, if one of these narrower checks
stalled partway through, the system would report the failure against the
wrong part of the process: technically honest, but pointing at the wrong
place. Now every review comes with a short report attached, naming which
checks ran, which didn't, and exactly why, calling out the specific check
by name if it didn't finish. Nobody has to wonder whether something
silently gave up partway through.

## What's still open

We're rolling this out carefully. The narrower, one-job-at-a-time version
of this check isn't turned on for everyone by default yet. It's proven on
this one real bug, in this one shape. We want more evidence before making
it the default for everyone, not less.

[OWNER: your call on whether to preview a timeline for turning this on
more broadly, or leave this as a pure status update.]

---
title: "Why We Built Lien"
description: "A tool that gives AI coding assistants a real, structural understanding of your codebase: what depends on what, how complicated each piece of code is, and what tests actually cover it. Runs entirely on your own machine."
date: 2026-07-19
author: Alf Henderson
tags: [product, local-first]
draft: true
---

<!-- DRAFT: awaiting owner voice pass -->

# Why We Built Lien

I built Lien initially out of curiosity. Could I get Claude's coding agents
to understand a monorepo, the cross-package dependencies, the "if I
touch this, what else moves" question, instead of just guessing at it? A
smaller, more selfish itch sat right next to that one. I was tired of
manually hunting through a codebase for something like "how is auth handled
here," and I wanted a shortcut. That second itch is what got me building an
index in the first place. The first version of Lien tried to search code by
meaning, the same way a lot of "AI search" tools work.

It didn't stay that way. Building that first version taught me something I
didn't expect. The questions that helped an agent work well in a
codebase weren't questions about what code *means*. They were questions
about how it's *connected*. What depends on this file. How complicated is
this function. What tests actually cover it. An agent doesn't need to guess
what a piece of code is about. It needs to know what breaks if it changes.
That's the story behind the next section: it's not a pivot I made on a
whiteboard, it's a lesson the work itself taught me.

Complexity metrics came next, for a specific reason. I had an idea to build
a tool that would show how complicated code was getting across an entire
team's projects, and nudge people toward writing less of that complexity.
Much later, that idea became the automatic pull-request reviewer I'll
describe below.

Along the way I noticed something else: the same technique that let an
agent understand a codebase's structure, actually parsing the code the way
a compiler does, could power a review process too. Something that reads a
change and points out real problems before a person has to catch them. That
became the reviewer, and it's where I felt like I was onto something real.
Because its signals come from really parsing the code rather than a
model's gut feeling, in my own side-by-side testing it caught real bugs
that slipped past paid competitors, using a noticeably cheaper model
underneath. Not always, though. Further down there's the one time it went
the other way, and we kept that one too.

The last piece closed the loop in the other direction. If a tool already
knows a function is getting too complicated, why wait until a pull request
to say so? That's the idea behind warning an agent before it even makes an
edit, not after it's already made a mess. I've now confirmed that idea
actually changes what an agent writes. We tested it properly, and
[the numbers held up](/blog/posts/complexity-nudges-ab-test).

All of it is in service of the same bet: that agents can be trusted to
write more of our code, without giving up quality or correctness for it, as
long as they have the same understanding of a codebase's structure a
careful human reviewer would insist on.

Lien is what came out of chasing that bet. It gives AI coding assistants a
real, structural understanding of a codebase: what depends on what, how
complicated each piece of code is, what tests cover it, plus fast
search across the code itself. It runs entirely on your own machine.
Nothing gets uploaded anywhere, and there's no server involved at all.

It's open source, has been used on its own codebase since the very first
day, and it's finally in a shape worth writing about properly.

## No AI search, and that's a deliberate choice

A lot of "AI-powered" code tools work by turning your code into a kind of
numeric fingerprint, so the tool can find code that seems related in
meaning even if the words don't match. Lien used to work that way too. We
pulled that out entirely. Building it and living with it kept showing the
same thing: the questions that make an agent better at its job are
about structure, not meaning. "What depends on this file." "How complicated
is this function." "What tests cover this." Meanwhile, that fingerprinting
model was a roughly 100MB download and a heavy install for a capability
that wasn't earning its keep.

So indexing a codebase is just reading the code the way a compiler would,
then writing what it finds to a small local database. Ordinary keyword
search runs on top of that. No AI model to download, no GPU needed, and it
works completely offline. On a laptop with an Apple M3 Pro chip: a small
open-source project (79 files) indexes in 0.7 seconds, a mid-sized project
(370 files) in 1.7 seconds, and Lien's own codebase (517 files, across six
languages) in 1.8 seconds. That scales roughly in a straight line with file
count, so a 10,000-file codebase would land around 25 to 30 seconds by
extrapolation. The part of Lien that actually reads the code is a small,
fast program that comes pre-built for every platform, so there's nothing to
compile when you install it, and it's noticeably faster than the version it
replaced.

The honest tradeoff: plain keyword search can't bridge a real gap in
vocabulary. Searching for "auth" won't surface a function called
`verifyToken()` if neither the code nor its comments ever use the word
"auth," and sparsely-commented code makes plain-language questions perform
worse in general. The fix is simple: search using words that actually
appear in the code. The more structural questions Lien answers (what
depends on this, what tests cover it) don't have this problem at all,
because those aren't searches. They're direct lookups from an index Lien
already built.

## Nudging agents toward simpler code

Most of what Lien knows, an agent has to actively ask for. But Lien also
does two things on its own, without the agent needing to remember to ask:

- Right after an agent opens a file that a lot of other code depends on,
  Lien quietly adds a short note: how many other things depend on it, how
  risky it would be to change, and whether it's covered by tests.
  That happens before the agent makes any edit, while it still matters.
- Right after an agent makes an edit, Lien checks whether that specific
  change made some function meaningfully harder to understand than it was
  before. If so, it says so. If the function was already complicated, or
  the edit made it simpler, it stays quiet. This check takes about 50
  milliseconds, and the whole round trip is around 200 milliseconds warm,
  comfortably inside the time Lien allows itself before giving up.

We didn't want to just assume this changes what an agent writes, so we
tested it properly: the same coding task, given twice, once with a real
warning inserted and once without, nothing else different. [We wrote the
whole experiment up separately](/blog/posts/complexity-nudges-ab-test), but
the short version: the agent that got the warning wrote meaningfully
simpler code far more often than the one that didn't.

## A reviewer that publishes its own misses

Lien also reviews pull requests automatically, as a single line you can add
to any project's GitHub setup. No separate server, no database, and you
bring your own AI provider key:

```yaml
name: Lien Review
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: getlien/lien-review@v1
        with:
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

It doesn't need any special access beyond what that one line already
grants, and by default it only leaves comments. It won't block anything
unless you turn that on yourself. A typical review costs a few cents to
about fifteen cents in AI usage (real bills tend to run a bit higher than
that estimate, so budget accordingly).

What we actually want to talk about is how we know it works. Every check
this tool makes has to prove itself against real bugs that actually shipped
and were later fixed in other open-source projects, not made-up examples.
The most recent full check covered two dozen real historical bugs across
eight different open-source projects in six programming languages, for
about $13 in AI costs. And we publish the misses right alongside the wins.
There are a few recurring ways it fails. Sometimes it reads exactly the
right code and reasons its way to the wrong conclusion anyway. Sometimes
the bug is something that's quietly missing rather than something visibly
wrong, and those are the hardest to catch in any review, human or not.
Sometimes a change looks safe to every caller inside the project but breaks
code outside it that the reviewer simply can't see. And sometimes it just
believes what the pull request says about itself. The single most humbling
result we have: this tool reviewed one of its own changes, missed a real
bug in how an error was being handled, and a paid competitor caught the
exact same bug five minutes later, on the same commit. We kept that as a
permanent example in our own tests, not a footnote.

Most recently, that same habit of publishing our own misses led somewhere
we didn't expect: proof that a fix to how the reviewer handles a busy pull
request actually works, using a real, live bug we found in a popular
open-source project along the way. [There's a whole story about
that](/blog/posts/reviewer-that-cant-skip-candidate-loops).

We think that's a more useful thing to publish than another benchmark
chart.

## The rest of it

It's licensed under the AGPL: self-hosted, bring-your-own-key, no vendor
lock-in, and no telemetry anywhere. Free forever for local use. The license
exists to keep it that way, and to make sure improvements come back to the
project instead of disappearing into someone's private fork.

Install for Claude Code is one command:

```text
/plugin marketplace add getlien/lien
/plugin install lien
```

For other AI coding tools, like Cursor, Windsurf, OpenCode, and Kilo Code:
one install command plus one setup command.

The rest of the docs, the full evidence, and how we test all of this live
elsewhere on this site. The code is at
[github.com/getlien/lien](https://github.com/getlien/lien).

[OWNER: closing line is yours, e.g. an invite to open an issue/discussion
if it falls over on someone's codebase, or whatever you'd want to close on.]

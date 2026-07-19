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
index in the first place.

The first version was built the way a lot of local code tools were built
around then. Parsing ran through tree-sitter's JavaScript bindings, the
same parsing library most code editors use under the hood. Search ran on a
small local embedding model, something like 100MB, running through ONNX
Runtime, a lightweight way to run that kind of model without a GPU or a
network call, with the resulting vectors stored in LanceDB, a local vector
database built for exactly that job. Local-first wasn't a marketing line
even then. It was the actual constraint I designed around from day one:
nothing about someone's code should ever have to leave the machine it
lives on.

From there, the real story splits into two separate threads that ran for
months before they ever met.

The first thread was about getting an agent to use the tools Lien gave
it. The tools existed early on, back in November, and
instructions telling an agent to use them followed within the hour. That
pairing was always the plan, never an afterthought. By February, those
instructions had hardened into hard requirements written directly into
the rules an agent reads before touching a file: call this before
editing, call that before renaming something exported.

Then came an honest admission, in May: those requirements were, in
practice, advisory. The model frequently went straight to editing a file
without calling anything first. [We said so in
public](https://github.com/getlien/lien/issues/560). The first fix was
blunt, a gate that physically blocked an edit until the right tool had
been called, and it shipped and then got pulled again within a day, too
heavy-handed, the kind of friction that makes someone route around a tool
instead of using it. What replaced it was smaller, and it actually
worked: a hook that quietly hands the agent a short note about a file's
impact right after it reads that file. No gate, no blocking, just the
right fact arriving at the right moment. Watching real sessions is what
showed that channel actually reaches the model, more reliably than a rule
ever did. That's really where the idea of nudging was born, not enforcing
compliance, but making sure the right context shows up exactly when it's
useful.

A second, separate thread started roughly seven weeks later and had
nothing to do with any of that. The tool an agent was now required to
call before every edit got measured under real traffic, and it came back
slow, something like 40 milliseconds a call, sitting on top of an install
that pulled in a heavy embedding model. What actually drove the next
decision wasn't hook work at all. It was [a dedicated
benchmark](https://github.com/getlien/lien/pull/645), a plain side-by-side
test of a few different storage engines. The embedding model and the
vector database both came out entirely. In their place: better-sqlite3, a
boring, extremely well-tested embedded database that can answer a keyword
search in milliseconds with no model involved at all. [We wrote up that
whole decision in more detail
here.](https://github.com/getlien/lien/blob/main/docs/architecture/decisions/0011-sqlite-structural-store-fts5-lexical-search.md)
That one change dropped the same pre-edit call by roughly a thousand
times, from about 40 milliseconds down to about 0.04. A few days later,
the parser itself got rewritten too, as a native Rust module using
napi-rs, a way to call Rust code directly from Node, instead of a
JavaScript wrapper around a separately compiled binary. That wasn't only
about speed, although it is faster. The old setup had to compile a native
module on every fresh install, and that compile step was the single most
common reason someone's install of Lien would fail. The Rust version
ships pre-built for every platform, so a fresh install now takes seconds
and compiles nothing at all.

The two threads met on one particular afternoon, the same day the faster
storage landed. It enabled a check that genuinely couldn't have existed
before: a complexity gate that runs at the moment of an edit and answers
in about 30 milliseconds. It exists because of a real incident. [An agent
had shipped a change](https://github.com/getlien/lien/pull/672) that
passed every other gate in place at the time, while pushing one
function's complexity to 29 against an agreed limit of 15. The later
nudges, a warning before an edit even happens, a reminder about test
coverage, all ride on that same fast storage layer underneath.

Looking back, a few things stuck with me. Getting an agent to comply
with the right process, and making the underlying answers fast
enough to act on in real time, turned out to be two separate problems on
two separate timelines, not one. Lien today is really just where those
two problems finally met. The fanciest part of the original stack was
never the valuable part either. A plain, boring database mattered more
than the machine-learning model sitting next to it, and deleting that
whole model and its vector store, not trimming them, is what made the
product better. When the thing using your tool is an agent
inside a loop rather than a person browsing, speed and an exact,
repeatable answer aren't nice extras, they're the actual feature. And
local-first survived every rewrite in both threads, because it was never
a feature bolted on top. It's the thing everything else got rebuilt
around.

A related complexity idea was running on its own track the whole time,
completely separate from the edit-time gate above. I had an idea to build
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

One of those later nudges deserves its own explanation. If a tool already
knows a function is getting too complicated, why wait until a pull request
to say so? That's the idea behind warning an agent before it even makes an
edit, not after it's already made a mess. I've now confirmed that idea
actually changes what an agent writes, and there's a lot more on that a
bit further down.

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

Indexing a codebase today is just reading the code the way a compiler would,
then writing what it finds to a small local database. Ordinary keyword
search runs on top of that. No AI model to download, no GPU needed, and it
works completely offline. On a laptop with an Apple M3 Pro chip: a small
open-source project (79 files) indexes in 0.7 seconds, a mid-sized project
(370 files) in 1.7 seconds, and Lien's own codebase (517 files, across six
languages) in 1.8 seconds. That scales roughly in a straight line with file
count, so a 10,000-file codebase would land around 25 to 30 seconds by
extrapolation. That's the same Rust rewrite described above doing the
work, and it's a large part of why these numbers are as fast as they are.

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
whole experiment up separately](https://github.com/getlien/lien/blob/main/docs/development/nudge-behavioral-ab.md),
but the short version: the agent that got the warning wrote meaningfully
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
that](https://github.com/getlien/lien/blob/main/docs/architecture/decisions/0014-per-rule-candidate-loop-passes.md).

We think that's a more useful thing to publish than another benchmark
chart.

## The rest of it

It's licensed under the AGPL: self-hosted, bring-your-own-key, no vendor
lock-in, and no telemetry anywhere. Free forever for local use. The
license exists to keep it that way: if someone builds on Lien and shares
that publicly, as software they distribute or a service they run over a
network, the AGPL means their improvements have to be shared back too. A
private fork that's never distributed or offered as a service can stay
private.

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

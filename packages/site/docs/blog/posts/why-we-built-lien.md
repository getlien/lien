---
title: "Why We Built Lien"
description: "A code-intelligence layer for AI agents, built local-first: structural analysis and fast lexical search, no embeddings, no server, dogfooded on its own repo since day one."
date: 2026-07-19
author: Alf Henderson
tags: [product, local-first]
draft: true
---

<!-- DRAFT: awaiting owner voice pass -->

# Why We Built Lien

I built Lien initially out of curiosity: could I get Claude's coding agents to
actually understand a monorepo — the cross-package dependencies, the "if I
touch this, what else moves" question — instead of guessing at it? A smaller,
more selfish itch sat right next to that one: I was tired of manually hunting
through a codebase for something like "how is auth handled here," and wanted
a shortcut. That second itch is what got me building an index in the first
place — the first version of Lien was semantic, embeddings and all.

It didn't stay that way. Building that semantic search taught me something I
didn't expect: the questions that actually made an agent better at working in
a codebase weren't semantic-similarity questions at all — they were
structural ones. What depends on this file. How complex is this function.
What tests cover it. The embeddings were answering a question nobody was
really asking. That's the story behind the "no embeddings" section below —
it's not a pivot I made on a whiteboard, it's a lesson dogfooding taught me.

Complexity metrics came next, for a specific reason: I had an idea to build a
cloud app that would surface complexity across an entire GitHub org and nudge
teams toward writing less of it — which, much later, became Lien Review, the
PR review Action.

Along the way I noticed something else: the same Tree-sitter AST parsing that
helped an agent understand a codebase's structure could power a code review
loop too. That became Lien Review — and it's where I felt like I was onto
something real. Because those AST-derived signals are deterministic, not
vibes, in my own head-to-head testing Lien Review caught real bugs that
slipped past paid tools like CodeRabbit, running a noticeably cheaper model
underneath — though not always; the section below has the one time it went
the other way.

The last piece closed the loop in the other direction: if Lien already knows
a function's complexity, why wait for a PR to say so? That's the idea behind
the runtime nudge — surfacing a complexity warning to an agent before it
edits a function, not after. I've now confirmed that idea actually changes
what an agent writes; see [the pre-registered A/B](/blog/posts/complexity-nudges-ab-test)
for the numbers.

All of it is in service of the same bet: that agents can be trusted to write
more of our code, without giving up quality or correctness for it — as long
as they have the same structural understanding of a codebase a careful human
reviewer would insist on.

Lien is a code-intelligence layer for AI coding assistants: structural
analysis (dependencies, blast radius, complexity, test coverage) plus fast
lexical code search — all local, all free, no server anywhere in the loop.

It's open source (AGPL-3.0), dogfooded on its own repo since day one, and in
a shape worth writing about properly. Here's what it does and why.

## No embeddings, and that's a deliberate choice

Lien used to embed code into vectors for semantic search. We pulled that out
entirely. Dogfooding kept showing that the questions that actually make Lien
valuable to an agent are structural — "what depends on this file", "how
complex is this function", "what tests cover this" — not semantic
similarity. Meanwhile the embedding model was a ~100MB download and a heavy
install for a capability that wasn't earning its keep.

So indexing is just Tree-sitter AST parsing plus a SQLite write, and
full-text search runs on FTS5/BM25. No model to download, no GPU, works
fully offline. Measured on an M3 Pro: reqwest (Rust, 79 files) indexes in
0.7s, hono (TypeScript, 370 files) in 1.7s, and Lien's own six-language
monorepo (517 files) in 1.8s. That scales roughly linearly with file count —
a 10k-file repo lands around 25-30s by extrapolation. The native parser (a
small Rust crate, prebuilt for every platform) is 1.8-2.2x faster than the
JS-binding parser it replaced, and the whole native footprint is about 22MB.
Nothing to compile on install.

The honest tradeoff: lexical search can't bridge a genuine synonym gap.
Searching "auth" won't surface `verifyToken()` if the code and comments
never use the word "auth", and sparsely-commented code makes
natural-language queries underperform generally. Query with the vocabulary
actually in the code — and the structural tools (dependents, blast radius,
test coverage) don't have this problem at all, since they're indexed
lookups, not search.

## Hooks that push agents toward simpler code

The MCP tools are pull-based — the agent has to ask. Lien also ships two
Claude Code hooks that push, so the nudge doesn't depend on the agent
remembering to ask:

- **A read hook** injects a short blast-radius summary right after the agent
  reads a file with non-trivial impact — dependent count, risk level, test
  coverage — before it makes an edit.
- **A write hook** runs `lien delta` after every edit: a ~50ms deterministic
  complexity check that only speaks up when *that specific edit* pushed a
  function across a complexity threshold it wasn't over before. It's silent
  for pre-existing violations and for improvements. End-to-end hook latency
  is about 215ms warm, 410ms cold — comfortably under its own 5-second
  timeout.

We didn't want to just assert this changes what an agent writes, so we ran a
small, pre-registered A/B on the plan-time version of this nudge: the same
coding task, with and without the real warning line injected into the
prompt. Control crossed its complexity threshold in 8 of 8 trials; the
warning condition crossed in 3 of 8, and every trial that avoided crossing
did it by extracting a helper function — exactly what the warning's wording
asks for. It's a small (N=8/condition), single-task, single-model
comparison — not a general claim about nudges — but within that scope, the
effect is not subtle. [Full protocol and results](https://github.com/getlien/lien/blob/main/docs/development/nudge-behavioral-ab.md).

## A PR review Action that publishes its own misses

Lien Review is a self-hostable GitHub Action — one `uses:` line, no server,
no database, bring your own OpenRouter or Anthropic key:

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

No `actions/checkout` needed — it self-clones the PR by SHA using the
workflow's own token. It's advisory by default (`fail-on: never`), and a
typical review costs $0.02-$0.15 in tokens (real OpenRouter billing tends to
run 1.5-2x whatever the harness estimates, so budget accordingly).

What we actually want to talk about is how it's validated. Every rule has to
clear a 9-out-of-10 bar on a calibration harness before it ships, using
fixtures mined from real, merged bugs in external repos — not synthetic test
cases. The most recent full sweep covered 24 fixtures across 8 repos and 6
languages, for $13.11 of a $15 budget. And the results page publishes the
misses alongside the wins: four recurring failure shapes (deep-traced-but-
wrong, omission, blindness to external callers, and accepting the PR's own
framing), plus the single most humbling data point we have — Lien Review
reviewed one of its own PRs, missed a real bug in an error-handling
fallback, and CodeRabbit caught the same bug five minutes later on the same
commit. That miss is now a committed fixture in the corpus, not a footnote.

Most recently, that same evidence discipline paid off somewhere we didn't
expect: proving out a structural fix to how Lien Review handles crowded PRs,
using a real, live bug we found in `drizzle-orm` along the way. [More on
that here](/blog/posts/reviewer-that-cant-skip-candidate-loops).

We think that's a more useful thing to publish than another benchmark
chart.

## The rest of it

AGPL-3.0, self-hosted, bring-your-own-key, no lock-in, no telemetry
anywhere. Free forever for local use — the license exists to keep it that
way and make sure improvements come back to the project.

Install for Claude Code is one command:

```
/plugin marketplace add getlien/lien
/plugin install lien
```

For other MCP-compatible editors (Cursor, Windsurf, OpenCode, Kilo Code,
Antigravity): `npm install -g @liendev/lien && lien init`.

The rest of the docs, the full evidence page, and the harness methodology
are all elsewhere on this site. Code's at
[github.com/getlien/lien](https://github.com/getlien/lien).

[OWNER: closing line is yours — e.g. an invite to open an issue/discussion
if it falls over on someone's codebase, or whatever you'd want to close on.]

# How We Know Lien Review Works

[Review Evidence](/guide/review-evidence) publishes the results of validating
Lien Review against real historical bugs. This page is the methodology behind
those results: the test harness that every rule, in this repo and in the
cross-repo study, has to pass before it ships. Fixtures are mined from real
shipped regressions, not written to order; assertions have to survive a
three-verdict smoke test that includes a wrong-but-plausible answer, not just
a right one; and a rule change only ships once it clears a **≥9/10**
calibration bar against the production model, on OpenRouter, not against
Claude Code's own (materially smarter) judgment.

The full mechanics live in
[`packages/review/test/harness/README.md`](https://github.com/getlien/lien/blob/main/packages/review/test/harness/README.md),
and the judgment layer, the traps this process is designed to avoid, is
documented in
[`docs/development/review-harness-judgment.md`](https://github.com/getlien/lien/blob/main/docs/development/review-harness-judgment.md).

## Real-PR fixtures, not synthetic tests

A fixture is a JSON snapshot of a real `ReviewContext` (the diff, the
changed-file chunks, and a full-repo AST index) captured from an actual pull
request at a specific commit. Per the harness's own reliability rule, **the
first non-trivial fixture for any rule must be snapshot-captured from a real
PR**: hand-authored scenarios are too clean and miss the chunk noise a real
repo produces, so they can't anchor a reliability claim on their own.

Two corpora exist:

- **The canary corpus**: one fixture per built-in rule (nine rules:
  `structural-analysis`, `boundary-change`, `edge-case-sweep`,
  `concurrency-race`, `incomplete-handling`, `error-swallowing`,
  `stale-duplicate`, `untrusted-input-validation`, `doc-truth`), each captured
  from a closed planted-regression PR in this repo (e.g. `boundary-change`
  from #520, `error-swallowing` from #411, `doc-truth` from #658).
  Negative-regression fixtures ride alongside: captures of real PRs where the
  rule produced a false positive (#574, #575), asserted with `expectEmpty` so
  calibration covers both "must fire" and "must stay quiet".
- **The cross-repo corpus** (`fixtures/crossrepo/`): fixtures mined from the
  real regression history of external open-source repos, across 8 repos and
  6 languages, to check the rules generalize past codebases they were tuned
  on. See [Review Evidence](/guide/review-evidence) for the full study
  results.

Fixture JSONs are never committed (a captured snapshot is typically 10 MB+, a
full repo's `repoChunks`), but capture is deterministic given the same PR
head SHA and parser version, so every fixture's `.assertions.ts` header
carries the exact `capture-pr.ts` invocation that regenerates it byte-for-byte
on any machine:

```bash
npx tsx packages/review/test/harness/capture-pr.ts 752 \
  packages/review/test/harness/fixtures/error-swallowing/pr752-undiscriminated-catch-salvage.fixture.json \
  --sha 295cc7e
```

Two capture gotchas worth knowing about: the native parser must be built in
the capturing checkout, or every AST-language file silently chunks to zero
and the corpus ends up markdown-only (`capture-pr.ts` now fails loudly on
that signature instead of writing a partial fixture); and if the bug being
pinned was fixed within the PR itself, you capture at the pre-fix SHA, not
`gh`'s reported head; otherwise the fixture no longer contains the bug it's
supposed to reproduce.

## Two-tier assertions, and the verdict that has to fail

An `.assertions.ts` file scores a run on two tiers:

| Tier | Stable at T=0? | Helper | Use for |
|---|---|---|---|
| 1 | Yes | `expectRuleFired`, `expectEmpty`, `expectFindingsCount`, `expectToolCalled` | "the rule fired", "no findings", "the right tool was called" |
| 2 | Mostly | `expectFindingMentions([...])` | did the finding actually name the bug's mechanism, in any of several accepted phrasings |

Before any assertion is trusted, it has to pass a **three-verdict smoke test**
against `assert-cli.ts`: zero LLM spend, three hand-written verdict JSONs:

1. **Perfect**: a finding stating the ground truth → must exit 0.
2. **Empty**: `{findings: [], toolCalls: [], turns: 1}` → must exit non-zero
   (a Tier 1 failure).
3. **Distractor**: a *plausible but wrong* finding, a different real-looking
   issue in the same file or function, not the fixture's actual bug → must
   also exit non-zero (a Tier 2 failure).

The distractor is the step that earns its keep. A keyword list built from
bare domain nouns (the changed function's name, a domain term like `'etag'`
or `'netloc'`) will false-pass *any* finding that merely talks about the
changed code. In the 2026-07 cross-repo Python round, all three first-draft
keyword lists false-passed their distractors and had to be rewritten around
compound phrases naming the bug's specific shape (`'weak etag'` + `'w/
prefix'`, not just `'etag'`) before they were trusted. A distractor that
passes means the assertion measures "mentioned the neighborhood", not "found
the bug", and a false-passing assertion can silently corrupt every
calibration run that uses it.

(One related but separate discipline: since #742, the harness preflights an
entire batch before spending a cent. If a fixture's asserted rule isn't in
the active rule set the trigger logic would actually select for that diff,
the run aborts with every offending fixture named, rather than quietly
wasting a paid vote on an unfireable assertion.)

## Canary vs characterization: the shipping bar

A fixture's `tags` field says what its pass/fail *means*:

- **`canary`**: certified ≥9/10 on a `--calibrate 10` run against the
  production default model (`moonshotai/kimi-k2.7-code`). A red canary fails
  the harness run; it's a drift signal. Touching an existing rule's prompt
  requires ≥9/10 on that rule's own canaries before merging.
- **`characterization`**: measures a known frontier: a bug shape the
  production model handles unreliably, or declines defensibly. It renders as
  a neutral `~ … measured N/M (non-gating)` line and never affects the
  process exit code. Its header records the measured rate and why iteration
  stopped; nobody should spend calibration budget chasing a characterization
  fixture green.

Changes that touch shared scaffolding all rules see (the output format, an
injected signal block, the shared system-prompt template) can't be certified
rule-by-rule; they require a full-corpus **no-regression** sweep instead: run
`--calibrate 10` with no `--rule` filter on both branches and diff which
fixtures flip. Simultaneous canary flips after a model update get re-baselined
under human review, never silently re-pinned.

## Misses get published too

Across the cross-repo study, misses fell into four recurring shapes, stable
across both models tried (Claude Code and Kimi); see
[Review Evidence](/guide/review-evidence#what-it-misses) for the full
taxonomy and the fixtures behind each shape.

That same discipline applies to Lien's own repo. On 2026-07-15, Lien Review
missed a real bug in PR #752 (an error-swallowing catch block that salvages
every failure class, not just the one its fallback was built for), and a
competitor tool caught it minutes later. The gap became a `characterization`
fixture the same way any miss does here: captured at the pre-fix commit,
proofed against a real adjacent distractor, and measured at 0/3 against the
production model, published in the corpus with the catching tool named
alongside rather than left out.

## Evidence without spend

Not every change needs a paid re-calibration. `build-prompts.ts` renders the
exact system prompt and active rule set a fixture would see, deterministically
and with no LLM call, which makes it possible to prove a scaffolding change is
behavior-neutral for free: render every fixture in the corpus on both
branches and diff the output byte-for-byte. Offline re-scoring against saved
vote traces and single-turn trace replay of a captured run are two more
low-spend techniques for narrower changes. See
`packages/review/test/harness/README.md` for the full toolkit and the
cost-discipline guidance behind it.

## Reproducing any of this

- The committed corpus lives at `packages/review/test/harness/fixtures/`
  (canaries under `<rule-id>/`, the cross-repo corpus under `crossrepo/`).
- Every fixture regenerates from its `.assertions.ts` header's `capture-pr.ts`
  recipe; nothing here depends on a fixture JSON that isn't reproducible from
  a public commit.
- The bar is the same everywhere: ≥9/10 on a 10-vote `--calibrate 10` run
  against the production default model, or an explicit `characterization`
  tag with a recorded measured rate for the frontiers that aren't there yet.

See `packages/review/test/harness/README.md` for the full corpus table,
command reference, and failure-mode catalog, and
`docs/development/review-harness-judgment.md` for the judgment layer: what
each golden rule cost to learn, and which battles are already settled.

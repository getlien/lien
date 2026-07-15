# How We Know Lien Review Works

[Review Evidence](/guide/review-evidence) publishes the results of validating
Lien Review against real historical bugs. This page is the methodology behind
those results — the test harness that every rule, in this repo and in the
cross-repo study, has to pass before it ships. The short version: fixtures are
mined from real shipped regressions, not written to order; assertions have to
survive a three-verdict smoke test that includes a wrong-but-plausible answer,
not just a right one; and a rule change only ships once it clears a **≥9/10**
calibration bar against the production model, on OpenRouter, not against
Claude Code's own (materially smarter) judgment.

The full mechanics live in
[`packages/review/test/harness/README.md`](https://github.com/getlien/lien/blob/main/packages/review/test/harness/README.md)
and the trap-avoidance layer in
[`docs/development/review-harness-judgment.md`](https://github.com/getlien/lien/blob/main/docs/development/review-harness-judgment.md).
This page distills both into the story of how a rule goes from "here's a bug
we missed" to "certified".

## Real-PR fixtures, not synthetic tests

A fixture is a JSON snapshot of a real `ReviewContext` — the diff, the
changed-file chunks, and a full-repo AST index — captured from an actual pull
request at a specific commit. Per the harness's own reliability rule, **the
first non-trivial fixture for any rule must be snapshot-captured from a real
PR**: hand-authored scenarios are too clean and miss the chunk noise a real
repo produces, so they can't anchor a reliability claim on their own.

Two corpora exist:

- **The canary corpus** — one fixture per built-in rule (nine rules:
  `structural-analysis`, `boundary-change`, `edge-case-sweep`,
  `concurrency-race`, `incomplete-handling`, `error-swallowing`,
  `stale-duplicate`, `untrusted-input-validation`, `doc-truth`), each captured
  from a closed planted-regression PR in this repo (e.g. `boundary-change`
  from #520, `error-swallowing` from #411, `doc-truth` from #658).
  Negative-regression fixtures ride alongside — captures of real PRs where the
  rule produced a false positive (#574, #575), asserted with `expectEmpty` so
  calibration covers both "must fire" and "must stay quiet".
- **The cross-repo corpus** (`fixtures/crossrepo/`) — fixtures mined from the
  real regression history of external open-source repos, across 8 repos and
  6 languages, to check the rules generalize past codebases they were tuned
  on. See [Review Evidence](/guide/review-evidence) for the full study
  results.

Fixture JSONs are never committed — a captured snapshot is typically 10 MB+
(a full repo's `repoChunks`) — but capture is deterministic given the same PR
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
`gh`'s reported head — otherwise the fixture no longer contains the bug it's
supposed to reproduce.

## Two-tier assertions, and the verdict that has to fail

An `.assertions.ts` file scores a run on two tiers:

| Tier | Stable at T=0? | Helper | Use for |
|---|---|---|---|
| 1 | Yes | `expectRuleFired`, `expectEmpty`, `expectFindingsCount`, `expectToolCalled` | "the rule fired", "no findings", "the right tool was called" |
| 2 | Mostly | `expectFindingMentions([...])` | did the finding actually name the bug's mechanism, in any of several accepted phrasings |

Before any assertion is trusted, it has to pass a **three-verdict smoke test**
against `assert-cli.ts` — zero LLM spend, three hand-written verdict JSONs:

1. **Perfect** — a finding stating the ground truth → must exit 0.
2. **Empty** — `{findings: [], toolCalls: [], turns: 1}` → must exit non-zero
   (a Tier 1 failure).
3. **Distractor** — a *plausible but wrong* finding: a different real-looking
   issue in the same file or function, not the fixture's actual bug → must
   also exit non-zero (a Tier 2 failure).

The distractor is the step that earns its keep. A keyword list built from
bare domain nouns — the changed function's name, a domain term like `'etag'`
or `'netloc'` — will false-pass *any* finding that merely talks about the
changed code. In the 2026-07 cross-repo Python round, all three first-draft
keyword lists false-passed their distractors and had to be rewritten around
compound phrases naming the bug's specific shape (`'weak etag'` + `'w/
prefix'`, not just `'etag'`) before they were trusted. A distractor that
passes means the assertion measures "mentioned the neighborhood", not "found
the bug" — and a false-passing assertion can silently corrupt every
calibration run that uses it.

(One related but separate discipline: since #742, the harness preflights an
entire batch before spending a cent — if a fixture's asserted rule isn't in
the active rule set the trigger logic would actually select for that diff,
the run aborts with every offending fixture named, rather than quietly
wasting a paid vote on an unfireable assertion.)

## Canary vs characterization: the shipping bar

A fixture's `tags` field says what its pass/fail *means*:

- **`canary`** — certified ≥9/10 on a `--calibrate 10` run against the
  production default model (`moonshotai/kimi-k2.7-code`). A red canary fails
  the harness run; it's a drift signal. Touching an existing rule's prompt
  requires ≥9/10 on that rule's own canaries before merging.
- **`characterization`** — measures a known frontier: a bug shape the
  production model handles unreliably, or declines defensibly. It renders as
  a neutral `~ … measured N/M (non-gating)` line and never affects the
  process exit code. Its header records the measured rate and why iteration
  stopped — nobody should spend calibration budget chasing a characterization
  fixture green.

Changes that touch shared scaffolding all rules see (the output format, an
injected signal block, the shared system-prompt template) can't be certified
rule-by-rule — they require a full-corpus **no-regression** sweep instead:
run `--calibrate 10` with no `--rule` filter on both branches and diff which
fixtures flip. Simultaneous canary flips after a model update get re-baselined
under human review, never silently re-pinned.

## Evidence without spend: deterministic no-regression proofs

Not every change needs a paid re-calibration. `build-prompts.ts` renders the
exact system prompt, initial message, and active/skipped rule set the
production agent would see for a given fixture — deterministically, no LLM
call. That makes it possible to *prove* a change is behavior-neutral for
free: render every fixture in the corpus on both branches and diff the
output byte-for-byte.

That's exactly how PR #743 shipped a `boundary-change` trigger-keyword
expansion: rendering all 19 lien-corpus fixtures' active-rule sets
before/after the change came back byte-identical (trigger keywords aren't
part of any prompt), so every existing ≥9/10 certification — including the
`boundary-change/ge-5` canary — carried over unchanged without spending a
cent to re-prove it. Only the genuinely new external fixtures whose
rule-set *did* change got fresh paid votes.

Two more zero- or low-spend techniques round out the toolkit:

- **Offline re-scoring.** Calibration always persists per-vote traces to
  `.wip/traces/` (gitignored). An assertion-only change can be re-scored for
  free against those saved traces via `assert-cli.ts`, instead of paying for
  a fresh run just to check the new keyword list.
- **Single-turn trace replay.** A narrow output-*shape* prompt change (not a
  behavioral one) can be A/B'd by replaying a captured trace's system prompt
  and tool results with "emit your verdict now" appended — about $0.03 a
  sample, versus ~$0.50/fixture for a fresh `--calibrate 10`.

The cost discipline underneath all of this: diagnose from an existing trace
first (free, and always on disk — every run prints its trace directory), and
stop after one non-converging paid iteration rather than chaining
calibration sweeps against the same hypothesis. Real OpenRouter billing also
tends to run 1.5–2× the harness-reported figure, and the repo's CI runs one
paid Lien review per PR push against the same key — both are worth counting
against any budget before starting a calibration round.

## The miss taxonomy — the honest part

Across the cross-repo study, misses fell into four recurring shapes, stable
across both models tried (Claude Code and Kimi) — see
[Review Evidence](/guide/review-evidence) for the fixtures behind each:

- **Deep-traced, wrong conclusion** — the reviewer engages the exact
  question and reasons its way to the wrong answer (`reqwest` #1645, a
  redirect-limit off-by-one both models traced directly and still cleared).
- **Omission** — the bug is what *isn't* there: a silently-skipped code path
  with no local diff to point at (`guzzle` #3740, a callback that silently
  no-ops). The weakest shape the study found.
- **External-usage blindness** — every in-repo caller is fine; the break only
  shows up in downstream consumers the reviewer can't see (`guzzle` #3714).
- **Judgment/framing acceptance** — the reviewer accepts the PR's own framing
  of the change, sometimes because catching the bug needs outside spec
  knowledge the PR body actively contradicts (`reqwest` #1927, an RFC 9110
  violation).

### The worked example: PR #752, a miss on Lien's own repo

The most direct evidence that this isn't a curated demo: Lien Review missed a
real bug in its own repo, and a competitor caught it minutes later.

On 2026-07-15, Lien Review reviewed `getlien/lien` PR #752 at commit
`295cc7e` and produced four findings — none of them the actual bug.
`postPRReview`'s catch block salvages *every* error thrown by
`octokit.pulls.createReview` — an authentication failure, a rate limit, a
5xx, a plain network error — the same way it salvages the one case its
fallback was built for: a 422 anchor-validation failure. Every one of those
unrelated failure classes takes the identical fallback path, and the fallback
itself fails the same way the batch call did, so the function returns
`{posted: 0, dropped: <all>}` instead of throwing. A caller-facing
infrastructure outage gets silently repackaged as a success-shaped "0
posted, all dropped" result — the exact "catch-then-degrade" shape
`error-swallowing` exists to catch, just gated on the wrong condition. Five
minutes later, CodeRabbit reviewed the same commit and caught it precisely,
asking for the retry to be scoped to validation failures only and to rethrow
everything else.

That gap became a fixture the same way any miss does here:

1. **Capture.** `capture-pr.ts` pinned the fixture at `295cc7e` — the
   pre-fix commit — specifically *not* the PR's later, fixed tip, so the
   miss stays reproducible even after the branch moves on. Tagged
   `characterization`, not `canary`: there's no green baseline to protect,
   only a frontier to mark.
2. **Distractor-proof.** The three-verdict smoke test used the PR's own
   *real* adjacent finding — a doc-comment contradiction about the
   fallback's retry — as the distractor: same file, same function, same
   rule label, not this bug. All three verdicts scored exactly as required
   (perfect → exit 0, empty → exit 1, distractor → exit 2).
3. **Measure.** A 3-vote baseline against the production default model
   scored **0/3** — reproducing the live miss, not a one-off fluke. The one
   near-miss finding across all three votes was the doc-truth-labeled twin
   of the scripted distractor, independently corroborating that the
   distractor was the right adjacent-but-wrong answer to guard against.
4. **Convert.** This is precisely the shape the codebase's own design
   principle calls out: "does this catch discriminate on the right error
   class" is a deterministic question about the diff, not a judgment call —
   a candidate for the same precompute-and-inject pattern as
   `stale-literal-signals.ts`, rather than another round of prompt tuning.
   As captured, the fixture is proofed and measured and waiting on that
   conversion; it isn't done yet.

The fixture ships in the corpus exactly as it happened: a real miss on
Lien's own PR, with the tool that caught it named. Publishing that — rather
than only publishing the wins — is the credibility claim this page is
making.

## Signals doctrine: precompute facts, spend the LLM on judgment

The house pattern for making a rule reliable is to precompute the
deterministic part of its detection and inject it as a signal block, the
same way `blast_radius` works: `stale-literal-signals.ts`,
`untrusted-input-signals.ts`, `doc-claims-signals.ts`,
`removed-export-signals.ts`, `rename-sweep-signals.ts` and others each
extract a structural fact — unit-testable, zero LLM spend — instead of
asking the agent to grep-and-reason its way there. `removed-export-signals.ts`
is the pattern at its best: one signal (removed symbols plus their surviving
cross-file references) serves two rules at once, replacing a "MUST grep
every removed symbol" instruction outright.

The pattern has a limit, and the `doc-truth` rule found it. Precomputing the
*question* (a worklist of doc claims to verify) wasn't enough — verification
cost still didn't fit the turn budget. Precomputing the *answer* too (claim
and contradicting evidence side by side) still wasn't enough — with the
evidence right there, the model spent its one findings slot on other, juicier
code bugs instead. The bottleneck was the findings-list competition itself,
not missing information — proven by swapping models entirely (Sonnet 5
failed identically to Kimi on the same input). No amount of input engineering
fixes an output-economy problem; the fix that worked was architectural: since
PR #733, `analyze()` runs a second, claims-only pass when a PR touches
claim-shaped doc prose — doc-truth alone, no competing rules, its own budget
share, findings deduped and merged back in.

Generalize from that: when a calibration run plateaus, ask *which* resource
is actually saturated — discovery, verification budget, or the findings-list
competition — before writing another prompt sentence. Traces answer this
directly: did the model never see the evidence, see it and run out of
budget, or see it and decline to use it?

## Reproducing any of this

- The committed corpus lives at `packages/review/test/harness/fixtures/` —
  canaries under `<rule-id>/`, the cross-repo corpus under `crossrepo/`.
- Every fixture regenerates from its `.assertions.ts` header's `capture-pr.ts`
  recipe; nothing here depends on a fixture JSON that isn't reproducible from
  a public commit.
- The bar is the same everywhere: ≥9/10 on a 10-vote `--calibrate 10` run
  against the production default model, or an explicit `characterization`
  tag with a recorded measured rate for the frontiers that aren't there yet.

See `packages/review/test/harness/README.md` for the full corpus table,
command reference, and failure-mode catalog, and
`docs/development/review-harness-judgment.md` for the judgment layer — what
each golden rule cost to learn, and which battles are already settled.

# ADR-014: Per-Rule Candidate-Loop Passes for Agent Review

**Status**: Accepted
**Date**: 2026-07-16
**Deciders**: Core Team
**Related**: PR #799 (pass-executor generalization + attestation v2), PR #803
(stale-duplicate candidate-loop pilot), PR #804 (incomplete-handling
candidate loop), PR #805 (stale-duplicate FP-guard fix), PR #807 (doc-truth
v2 per-claim verdicts — backports this ADR's per-candidate-verdict contract
into doc-truth's own pass, dark/env-only), `docs/architecture/review-pass-architecture.md`
(the implementation-level companion to this ADR)

## Context and Problem Statement

Lien Review's agent-review plugin (`packages/review/src/plugins/agent/`)
originally ran every active rule through one LLM call sharing one findings
list. The doc-truth arc (PRs #722–#733, see
`docs/development/review-harness-judgment.md`) proved this has a real,
measured failure mode that input engineering cannot fix: on a PR carrying
both documentation drift and juicier code bugs, the model's one findings
list rationally favors the code bugs, and the loss holds even swapping
Sonnet 5 for Kimi — an architectural bottleneck (output-list competition),
not a model gap. The fix that shipped was a dedicated second pass: doc-truth
alone, its own budget, no competing rules (`doc-truth-pass.ts`, since PR
#733).

That precedent raised the obvious next question: which *other* rules should
get the same treatment? Two sub-problems had to be answered before
generalizing:

1. **The plumbing was doc-truth-specific.** `analyze()` hardcoded exactly
   one optional second pass — a single `docResult` variable, gate/prompt/
   budget/merge logic wired in by hand. Adding a second dedicated pass would
   have meant copy-pasting that wiring a second time.
2. **Not every rule fits the same shape.** Doc-truth's `<doc_claims>` is a
   deterministic, boundable candidate worklist — every item enumerable in
   advance, each with a small closed set of dispositions (confirms /
   contradicts). Several other rules are **open investigations** with no
   such worklist: `concurrency-race` needs lock-ordering reasoning with no
   static-pattern signal; `edge-case-sweep` is "which inputs matter for this
   function", a per-function judgment call; `untrusted-input-validation`
   *does* have a candidate signal (`untrusted-input-signals.ts`), but
   judging one candidate requires open multi-hop data-flow tracing through
   arbitrary consumer code, not a bounded verdict. Forcing these into a
   candidate-loop shape would mean either dropping the open-ended
   investigation or silently reinventing it inside a "verdict" the loop
   can't actually bound.

A third question — could gating be signal-only, dropping the rule from the
shared-loop trigger entirely once a dedicated pass exists? — has a concrete
counter-example: `boundary-change`'s own deterministic signal
(`comparison-change-signals.ts`) pairs a REMOVED diff line with an ADDED one
within the same hunk to detect a shifted comparison. A purely *additive*
bug — new code with no removed line to pair against — produces **zero**
candidates by construction, no matter how good the signal gets. `boundary-
change` also carries a 5-step MANDATORY protocol (test-coverage cross-check,
blast-radius cross-check, changeset cross-check —
`packages/review/src/plugins/agent/rules.ts` lines 379–420) that is richer
than a closed real/intentional/false-positive verdict; collapsing it into a
candidate loop would mean either dropping those cross-checks or reinventing
the whole rule inside the loop, losing the "own budget, no competition"
benefit either way.

## Decision

Generalize the doc-truth precedent into a reusable executor, and apply it
**hybrid, per rule** — never as a blanket policy.

**1. Generalize the plumbing.** `packages/review/src/plugins/agent/review-pass.ts`
(new, PR #799) factors doc-truth's gate/prompt/budget/run/failure-isolation/
trace-append shape into a `ReviewPassSpec` interface (name, `gateReason`,
`buildPrompts`, `budget`, `maxTurns`, `mergeFindings`, `mergeResultState`,
optional `postProcessResult`) plus a `runExtraPasses` orchestrator.
`index.ts`'s `analyze()`/`analyzeSummaryOnly()` now run an ordered
`EXTRA_PASSES: ReviewPassSpec[]` list instead of one hardcoded second-pass
variable. Execution is **serial for v1** — no pass beyond doc-truth existed
yet to justify concurrent execution's added complexity (trace-offset races,
interleaved budget reporting), and doc-truth's own pass has a real data
dependency on the main pass having completed at all (`runExtraPasses` skips
every extra pass without evaluating its gate when the main pass never ran).
See `docs/architecture/review-pass-architecture.md` for the full contract
and file-level detail.

**2. Give worklist-shaped rules a dedicated candidate-loop pass; leave
open-investigation rules in the shared loop.** A rule qualifies for a
dedicated pass when its signal produces an **enumerable, boundable
candidate list** with a **closed verdict vocabulary** per candidate — the
same shape doc-truth already had. Two such passes shipped as real
consumers of the new executor:

- **`stale-duplicate-pass.ts`** (PR #803) — the pilot. `stale-duplicate`'s
  `always: true` trigger and `stale-literal-signals.ts`'s unconditional
  signal made it the cleanest first case. Verdict vocabulary: `stale |
  intentional-reuse | unverifiable`.
- **`incomplete-handling-pass.ts`** (PR #804) — the second build. Unifies
  THREE existing signals (`variant-sweep-signals.ts`, `sibling-surface-
  signals.ts`, `unread-field-signals.ts`) that all feed the same rule into
  ONE candidate loop under one `ruleId`, rather than three separate loops
  for one rule. Verdict vocabulary: `incomplete | handled | intentional |
  unverifiable` — a fourth value (`handled`) that the pilot's three-value
  set didn't need, because this rule's candidates can turn out to be
  covered by a mechanism the signal's textual scan couldn't see (a dispatch
  table, a wrapper).

Both new loops replace an open findings-list contract with a **per-
candidate-ID-required verdict array**: the pass assigns each candidate a
stable id and the model must return exactly one verdict per id. A missing
or malformed id makes the pass's own result honestly incomplete
(`AgentStopReason: 'incomplete_verdict'`) rather than silently under-
reporting — turning the doc-truth arc's own pr658 Finding-A omission (a
candidate silently dropped from a long open worklist, even inside a
dedicated single-rule pass) into a machine-checkable completeness failure
instead of a semantic judgment call.

`concurrency-race`, `edge-case-sweep`, and `untrusted-input-validation`
**stay in the shared loop** — no dedicated pass — because each is an open
investigation, not a candidate-verdict task, per the reasoning in Context.
`boundary-change` likewise stays in the shared loop for the reason above.
`error-swallowing` has a working signal
(`catch-discrimination-signals.ts`) that already measurably lifts recall
*inside* the shared loop without a dedicated pass; building one now would
be ahead of the evidence bar the other two loops needed to clear (see
Evidence below), so it is explicitly deferred, not rejected.

**3. Hybrid gating (trigger OR signal), never signal-only, for every new
pass.** Each dedicated pass ships behind its own opt-in flag (config
boolean, default `false`, or an env var) **AND** requires at least one
real candidate before it fires — `staleDuplicateSkipReason`/
`incompleteHandlingSkipReason` mirror `docTruthSkipReason`'s "name the real
reason" pattern. The rule's own prompt text and signal block are **kept in
the shared main pass** as a backstop in every case — a second, independent
flag (`LIEN_STALE_DUP_MAIN=off` / `LIEN_INCOMPLETE_MAIN=off`) exists for a
*future* A/B arm that would strip the rule from the main pass entirely, but
that arm has not been run; today, merging either pass changes zero
production behavior on its own (see Evidence). A **signal-only** gate
(dropping the rule from the shared-loop trigger the moment a dedicated pass
exists, relying purely on signal presence to decide whether the rule runs
at all) was considered and rejected as a *general* policy: it only holds
today for doc-truth's own dedicated pass, and doc-truth's signal
(`doc-claims-signals.ts`) earns that by being deliberately over-inclusive —
broad recall, relevance judgment left to the LLM — not by a proven 100%-
recall corpus. No other rule's signal has that proof yet, and
`boundary-change` is the concrete case where signal-only gating can
*never* reach full recall, by construction (see Context). Every new
dedicated pass therefore stays hybrid (trigger OR signal) for v1; graduating
a specific rule to signal-only gating is a decision to make per-rule, later,
once that rule's own candidate corpus proves the recall claim — not a
default this ADR grants up front.

**4. Generalize attestation alongside the executor, not as an afterthought.**
Before PR #799, `provider.passes[]` and `BudgetAttestation` were hardcoded to
a single main-pass entry — a real, already-shipping bug: an unfinished
doc-truth pass folded its `stopReason` into the *main* pass's own state
(`mergeDocPassIntoResult`), so a doc-truth-only budget starvation attested
as `mainPass.stopReason === 'budget'` — correctly non-silent, but
misattributed, and `budget.allocatedTokens` undercounted the real ceiling
whenever doc-truth fired (it only ever reported the main pass's own
allocation). `attestation.ts` generalizes `provider.passes[]` and
`BudgetAttestation.passes[]` to one entry per pass that actually ran, and
`computeVerdict` now attributes `degraded:budget_starved` to whichever pass
actually stopped. `ATTESTATION_VERSION` bumps **1 → 2** — a deliberate,
owner-reviewable call rather than the project's usual "additive fields
don't bump it" convention, because this is the first time `passes`/`budget`
carry more than one pass's worth of data; a consumer that assumed
`passes.length <= 1` would have silently ignored real data before this
bump. `packages/action/action.yml`'s attestation output description and
`packages/action/test/finish-run.test.ts`'s version assertion were updated
in the same PR.

## Consequences

### Positive

- **The mechanism is proven end-to-end, not just designed.** PR #799's
  byte-diff census re-ran `build-prompts.ts` against all 4 on-disk fixtures
  before/after the refactor — byte-identical on both the main pass's and
  doc-truth's own prompts — and a mocked-fetch dogfood run produced a
  verbatim two-pass `attestationVersion: 2` JSON with independent
  `main`/`doc-truth` entries in `provider.passes[]` and
  `budget.passes[]`. PRs #803 and #804 repeated the same byte-diff-
  neutrality proof for their own flags (off = zero behavior change).
- **A long-worklist omission is now a machine-checkable bug, not a semantic
  judgment call.** `incomplete_verdict` plus `hasCompleteVerdictCoverage`
  (both `stale-duplicate-pass.ts` and `incomplete-handling-pass.ts`) treat
  "one recognized verdict per expected candidate id" as a hard contract —
  a gap surfaces as the pass's own incompleteness, never silently.
- **Architecture risk and calibration risk are decoupled.** Both new loops
  ship dark (config/env default off), so this ADR's mechanism can be
  reviewed and merged independently of the separate, owner-priced decision
  to turn either on in production.
- **A live misattribution bug got fixed as a side effect**, not a follow-up:
  budget-starvation attribution and `budget.allocatedTokens` were both
  wrong for the *already-shipping* two-pass case (main + doc-truth) before
  this generalization, not just a hypothetical future problem.
- **The per-candidate-verdict contract generalized a third time, back onto
  the pass that inspired it — and this one didn't stay dark.** PR #807
  (merged the same night, after this ADR's initial evidence was gathered)
  backports the identical contract — a stable id per worklist entry, an
  appended output-format override, the same `postProcessResult`/
  `incomplete_verdict` honesty mechanism — into doc-truth's own pass as a
  v2 mode, entirely inside `doc-truth-pass.ts` with zero changes to this
  ADR's executor/attestation plumbing. That it ported cleanly onto the
  ORIGINAL pass the two new loops were modeled on, without touching
  `review-pass.ts` or `attestation.ts`, is independent evidence the
  contract is a property of the *pass*, not an artifact specific to either
  loop's build. Unlike `stale-duplicate`/`incomplete-handling` (still dark
  as of this writing), v2 shipped opt-in, HELD once its mechanism was proven
  (48/48 verdict coverage) but its negative baseline (`accurate-doc`) wasn't
  yet trustworthy, then — once #828 fixed that baseline (3/3 clean under
  both configs) — was promoted to the DEFAULT by owner order (2026-07-23):
  `isDocTruthV2Enabled` now defaults true, opt-out via `config.docTruthV2:
  false` or `LIEN_DOC_TRUTH_V2=off`/`0`/`false`. This is the first of the
  candidate-loop-pattern passes to graduate from dark to production-on.

### Negative / Risks

- **Lift is now measured for `incomplete-handling`, on one fixture and one
  of its three candidate shapes; `stale-duplicate`'s dedicated-loop-vs-
  shared-loop lift remains unmeasured.** A same-day A/B against a real,
  ground-truthed external bug — drizzle-team/drizzle-orm#4172, which added
  6 Gel `ColumnDataType` variants (`dateDuration`, `duration`,
  `relDuration`, `localTime`, `localDate`, `localDateTime`) that all four
  downstream schema-integration packages' `columnToSchema` if-chains still
  don't handle — measured the shared main pass converting the candidate to
  a real finding on only 1/3 screened votes (the other 2/3 read all four
  affected files, per their own tool-call trace, and still emitted nothing
  of any rule), against the dedicated `incomplete-handling` loop converting
  3/3, then holding 10/10 on `--calibrate 10` (one legitimate keyword-gate
  widening was needed along the way; both re-verified against a
  perfect/empty/distractor smoke test that never false-passed). Fixture:
  `packages/review/test/harness/fixtures/crossrepo/
  pr4172-columndatatype-gel-gap.assertions.ts` (promoted 2026-07-17; full
  result history in its own header). This is the first controlled,
  same-fixture comparison of a dedicated candidate loop against the shared
  loop's own signal-augmented findings list — the gap #803 and #804
  explicitly left open (both were $0-paid-LLM-spend build tasks, "do NOT
  run calibrations" per their briefs). It is deliberately narrow evidence,
  not a corpus-wide lift claim: one fixture, one candidate shape
  (`variant-sweep`; the rule's other two shapes, `sibling-surface` and
  `unread-field`, are untested by it), on the prod default model only.
  `stale-duplicate`'s own dedicated-loop-vs-shared-loop lift is still
  unmeasured — PR #805's stale-duplicate recalibration priced a *wording*
  fix's effect (`calibrate-10` held 10/10 on the canonical true-positive
  fixture at $0.3471, and a 3-vote FP probe against captured PR #770
  dropped from 2 wrongful `stale` verdicts of 51 to 0 after the fix), not a
  shared-vs-loop comparison. The pilot's own success criteria still call
  for mining 2–3 more stale-duplicate fixtures (cross-repo candidates were
  named but not yet captured) before a statistically meaningful lift
  comparison is possible for that rule; that mining has not happened as of
  this ADR.
- **The FP guard shipped in both loops' prompts from day one (see Decision
  point 2) has now been probed on both sides, clean on both.**
  `stale-duplicate`'s guard (PR #805, above) dropped a real, observed
  2-of-51 wrongful-`stale` rate against test-double literals to 0 after a
  wording fix. `incomplete-handling`'s otherwise-identical guard was
  separately probed the same day against two real, unrelated, loop-eligible
  lien PRs (#772, #773 — chosen because their sibling-surface candidates
  were judged benign in advance: deliberately-different modules sharing a
  filename/directory pattern, not forgotten mirrors) and recorded **zero**
  wrongful `incomplete` verdicts across 81 total candidate verdicts (3
  votes × (15 + 12) candidates). That probe is an in-session measurement,
  not yet landed as its own tracked artifact in this repository — cited
  here for the same reason this ADR already cites an unpublished design
  memo in References: an honest record of what was actually measured,
  pending its own write-up.
- **Per-PR firing-rate economics required real-PR census work, not
  assumption, and produced a genuine surprise.** The raw `<stale_literal_
  candidates>` block (unconditional signal, no loop-eligibility filter)
  renders on the large majority of real PRs — unusable as a dedicated-pass
  gate on its own. The shipped threshold (a high-confidence candidate with
  a same-file production survivor) fires on 14/40 (35.0%) of this repo's
  last 40 merged PRs, chosen from five candidate thresholds specifically to
  land inside a "genuinely selective" 15–40% band (PR #803 body). For
  `incomplete-handling`, a same-day re-census (PR #804 body) measured the
  union of all three signals firing on 20/40 (50%) — markedly higher than
  an earlier same-day estimate of 9/40 (22.5%) that the shipped code's own
  comment (`incomplete-handling-pass.ts`) still cites, with an explicit
  note pointing readers to the PR body for the up-to-date number. Firing
  rate is not a constant property of a rule; it needs re-measuring per
  signal change, and a stale inline estimate can outlive the PR that
  superseded it.
- **Concurrent pass execution is deliberately deferred**, so a PR that
  fires every gated pass at once pays their token/latency cost serially.
  Acceptable today (bounded added latency, no measured complaint) but
  revisit once ≥3 dedicated passes are live and latency becomes a real
  issue (YAGNI, per CLAUDE.md) — not before.

### Neutral

- `ATTESTATION_VERSION: 2` is additive-only in shape (a v1 attestation with
  `passes: [mainPass]` remains a valid v2 shape); the version bump is a
  signal to consumers that `passes`/`budget.passes` can now legitimately
  exceed length 1, not a breaking schema change.
- The rule's own prompt fragment and signal block are never removed from
  the shared main pass by a dedicated loop shipping — only the (unused,
  opt-out) `*_MAIN=off` flag can do that, and only for a future,
  explicitly-run A/B arm.

## Alternatives Considered

- **Signal-only gating for every candidate-loop rule** (drop the rule from
  the shared-loop trigger the moment its dedicated pass exists) — rejected
  as a general policy. See Decision point 3: `boundary-change`'s additive-
  only-bug blind spot is a structural counter-example, and no other rule's
  signal has doc-truth's proven-over-inclusive-recall property. Left open
  as a per-rule graduation path once a specific rule's corpus earns it.
- **Concurrent (parallel) extra-pass execution** — rejected for v1. No
  second pass existed when the executor was designed, so there was nothing
  to parallelize against yet; building the concurrency-safe trace-offset
  and budget-reporting machinery ahead of a real need would be speculative
  complexity (YAGNI). Revisit once ≥3 dedicated passes are live and latency
  is a measured complaint.
- **A separate output key for candidate-loop verdicts** (instead of
  carrying `candidateId`/`verdict` as extra fields inside the standard
  `findings` array) — rejected. Reusing the existing `findings` JSON key
  means the shared client's parse/validate pipeline (`readVerdict`,
  `isValidFinding`) needs zero changes for a candidate-loop pass; the loop-
  specific fields are stripped by each pass's own `postProcessResult` before
  the findings re-enter the merged result.

## References

- `packages/review/src/plugins/agent/review-pass.ts` — the `ReviewPassSpec`
  contract and `runExtraPasses` executor
- `packages/review/src/plugins/agent/doc-truth-pass.ts`,
  `stale-duplicate-pass.ts`, `incomplete-handling-pass.ts` — the three
  shipped passes
- `packages/review/src/attestation.ts` — attestation v2 schema and
  derivation
- `docs/architecture/review-pass-architecture.md` — implementation-level
  companion doc (contract fields, gating flags, budget formulas, which
  passes are production-on vs. dark)
- `docs/development/review-harness-judgment.md` — the doc-truth arc's
  competition-bottleneck evidence that motivated the original dedicated
  pass
- PR #799, #803, #804, #805, #807 — the shipped implementation and its
  dogfood/census evidence cited throughout this ADR
- `packages/review/test/harness/fixtures/crossrepo/
  pr4172-columndatatype-gel-gap.assertions.ts` — the shared-vs-loop lift
  fixture cited under Consequences/Negative (drizzle-team/drizzle-orm#4172,
  promoted 2026-07-17); full result history in its own header
- An unpublished, owner-approved per-rule-loops design memo prepared in a
  parallel working session (not part of this repository's tracked history)
  supplied the initial architecture proposal this ADR records the team's
  decision on; this ADR — not that memo — is the durable, repo-tracked
  record of what shipped and why.

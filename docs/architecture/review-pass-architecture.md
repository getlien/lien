# Agent-review pass architecture — `ReviewPassSpec` and the extra-pass executor

Status: generalized executor + attestation v2 shipped (PR #799, merged).
Three passes plug into it today — **doc-truth is production-on by default**
(v1); the **stale-duplicate** and **incomplete-handling** candidate loops
are built, merged, and dark (default-off), and doc-truth itself gained a
dark, env-only v2 mode (PR #807) that backports the same per-candidate-
verdict contract into its own pass — see "Which passes are live" below.
See [ADR-014](decisions/0014-per-rule-candidate-loop-passes.md) for the
decision this doc implements and its evidence/economics.

## Motivation

`AgentReviewPlugin.analyze()` (`packages/review/src/plugins/agent/index.ts`)
runs one LLM agent over a PR with up to nine rules
(`packages/review/src/plugins/agent/rules.ts`) sharing one findings list.
The doc-truth arc (PRs #722–#733) found a real, measured failure mode: on a
PR with both doc drift and code bugs, the shared list rationally favors the
code bugs, and swapping models didn't fix it — the bottleneck is the output
list itself, not the prompt. The fix was a **dedicated second pass**: run
doc-truth alone, on its own budget, with no competing rules. That shipped as
a single hardcoded pass (`doc-truth-pass.ts`). This doc describes the
generalization of that one pass into an ordered list of passes any rule with
a suitable shape can plug into, and the two additional passes that have
since been built against it.

## The `ReviewPassSpec` contract

`packages/review/src/plugins/agent/review-pass.ts` defines the interface
every extra pass implements:

```ts
export interface ReviewPassSpec {
  name: string;
  skipPlugin: string;
  gateReason(context: ReviewContext, config: AgentConfig): string | null;
  buildPrompts(context: ReviewContext): { systemPrompt: string; initialMessage: string };
  budget(baseBudget: number, context: ReviewContext): number;
  maxTurns: number;
  mergeFindings(mergedFindings: AgentFinding[], passFindings: AgentFinding[]): AgentFinding[];
  mergeResultState(main: AgentResult, passResult: AgentResult | null, mergedFindings: AgentFinding[]): void;
  postProcessResult?(result: AgentResult, context: ReviewContext): AgentResult;
}
```

- **`gateReason`** returns *why* the pass would not run right now, or `null`
  to run it — never a bare boolean, so the delivery attestation can record
  the real reason (config-disabled, env-disabled, no eligible candidate).
- **`budget`** takes the main pass's base budget *and* the `ReviewContext` —
  doc-truth ignores the context (a flat fraction of base is enough for its
  shape); both candidate loops use the context to scale budget by their own
  candidate count (see "Budget scaling" below). A function that declares
  fewer parameters than the interface's function type still satisfies it —
  no ceremony needed for doc-truth's simpler case.
- **`postProcessResult`** is optional and unused by doc-truth; both
  candidate loops use it to reduce a raw per-candidate verdict array down
  to real findings and mark the result honestly incomplete when the
  worklist wasn't fully covered (see "Per-candidate verdict contract"
  below).

## Execution: `runExtraPasses`, serial, in `index.ts`'s `EXTRA_PASSES`

```ts
// packages/review/src/plugins/agent/index.ts
const EXTRA_PASSES: ReviewPassSpec[] = [
  DOC_TRUTH_PASS_SPEC,
  STALE_DUPLICATE_PASS_SPEC,
  INCOMPLETE_HANDLING_PASS_SPEC,
];
```

`runExtraPasses` (`review-pass.ts`) iterates this list **in array order,
serially** — each pass is fully awaited (gate check → build prompts → run
client → fold findings/result-state into the running total) before the next
one starts. Two things are true regardless of how many passes exist:

- **If the main pass never ran** (every provider request failed), every
  extra pass is skipped without even evaluating its own gate — a second
  request would only fire more doomed calls, and a failure-isolated pass's
  own incomplete state must never overwrite the main pass's `neverRan`
  marker.
- **A single pass's failure never fails the whole review.** `runReviewPass`
  catches and reports (`context.reportSkip`) any thrown error from a pass's
  client run; the main pass's own output is untouched.

None of the three passes has a data dependency on either of the *other two*
(only doc-truth's original dependency on the *main* pass completing at all
survives the generalization), so declaration order among them doesn't
affect correctness — doc-truth stays first as the longest-proven pass.
Concurrent (parallel) execution was deliberately not built: no second pass
existed when the executor was designed, and building the concurrency-safe
machinery (trace-offset arithmetic that currently assumes the main trace is
already complete; per-pass budget reporting that would need to interleave)
ahead of a real latency complaint would be speculative (YAGNI per
CLAUDE.md) — revisit once ≥3 dedicated passes are live and latency is
measured as a problem.

## The three passes

| Pass | File | Gate (opt-in AND eligibility) | Budget formula | Toolset | Verdict vocabulary | Production status |
|---|---|---|---|---|---|---|
| doc-truth | `doc-truth-pass.ts` | `docTruthPass !== false` AND `LIEN_REVIEW_DOC_PASS` not disabling AND ≥1 doc claim | `round(base × 0.4)` | full 6-tool set (same as main pass) | v1 (default): open findings list. v2 (`LIEN_DOC_TRUTH_V2=on`, dark): `accurate \| contradicted \| unverifiable` per claim id | **Production-on** (v1 default true; v2 dark, env-only) |
| stale-duplicate loop | `stale-duplicate-pass.ts` | `config.staleDuplicatePass` or `LIEN_STALE_DUP_PASS=on` AND ≥1 high-confidence, same-file candidate | `clamp(2000 + 800×min(n,8), 4000, 30000)` | `read_file`, `grep_codebase` only | `stale \| intentional-reuse \| unverifiable` | **Dark** (default false) |
| incomplete-handling loop | `incomplete-handling-pass.ts` | `config.incompleteHandlingPass` or `LIEN_INCOMPLETE_PASS=on` AND ≥1 candidate (any of 3 shapes) | `clamp(2500 + 900×min(n,20), 5000, 35000)` | `read_file`, `get_files_context`, `grep_codebase` | `incomplete \| handled \| intentional \| unverifiable` | **Dark** (default false) |

Every pass keeps its rule's prompt fragment and signal block in the shared
main pass regardless of the dedicated pass's on/off state — a second,
independent env flag per candidate loop (`LIEN_STALE_DUP_MAIN=off`,
`LIEN_INCOMPLETE_MAIN=off`) exists to strip the rule from the main pass
entirely for a *future* A/B arm, but that arm has not been run. Today,
merging or enabling a candidate loop never removes its rule's shared-loop
coverage.

### doc-truth

`buildDocTruthPassPrompts` builds a system prompt with **only** the
doc-truth rule active (`DOC_TRUTH_ONLY_RULES`) and an initial message
carrying the `<doc_claims>` worklist (with pre-fetched evidence),
`<rename_sweep>` (a mechanical identifier-rename sweep, when present — this
wiring was itself a bugfix, PR #796: the rule's own prompt text told the
model to look for this block, but the pass didn't render it until then),
and `<guidance_surface_changes>`. Merge: a doc-truth finding is dropped only
when the main pass already reported one at the same location (same file,
within 2 lines) *at least as severe* — main pass wins on a tie
(`mergeDocTruthFindings`, `doc-truth-pass.ts:215`). Result-state merge lifts
a low/absent risk level to `medium` when doc-truth found `error`-severity
contradictions (`mergeDocPassIntoResult`).

**v2 (PR #807, merged same night as the two candidate loops above): doc-truth
backports the per-candidate-verdict contract into its own pass.** Env-only
opt-in (`LIEN_DOC_TRUTH_V2=on`, no config field — `isDocTruthV2Enabled`,
default off), entirely inside `doc-truth-pass.ts` with zero changes to
`review-pass.ts`, `attestation.ts`, or `index.ts`'s `EXTRA_PASSES`. Every
`<doc_claims>` entry and `<rename_sweep>` item gets a stable `claim-N` id
(`buildClaimWorklist`), and the model must emit exactly one verdict
(`accurate | contradicted | unverifiable`) per id via an appended
`<output_format_v2_override>` system-prompt section — same
`postProcessResult` mechanism the two candidate loops use
(`postProcessDocTruthResult`, wired into `DOC_TRUTH_PASS_SPEC`), including
the same `incomplete_verdict` honesty rigor for a missing/duplicate/
unrecognized-id or invalid-verdict claim entry. One deliberate difference:
unlike the two loops, v2's contract stays **open beyond the worklist** — an
extra finding for a claim the model spots itself (no `claimId`) still passes
through as an ordinary finding, matching the rule's existing "also skim for
any claim not listed" allowance. With the flag off, every v2 function is
verified byte-identical to v1's own output (PR #807's byte-diff census). This
is now the third pass built on the per-candidate-verdict pattern — evidence
the pattern generalizes beyond the two purpose-built loops it was designed
for, back onto the original pass that inspired it.

### stale-duplicate candidate loop

`stale-literal-signals.ts`'s `<stale_literal_candidates>` block is
unconditional (`stale-duplicate`'s trigger is `always: true`) and renders on
the large majority of real PRs — too broad to gate a *dedicated* LLM call on
directly. `hasEligibleCandidate` (`stale-duplicate-pass.ts:153`) applies a
stricter threshold: at least one `confidence: 'high'` candidate with a
production (non-comment/non-test/non-config) surviving site in the **same
file** as the changed site. A real-PR census (this repo's last 40 merged
PRs) measured this threshold firing on 14/40 (35.0%) — see
[ADR-014](decisions/0014-per-rule-candidate-loop-passes.md) for the full
five-threshold comparison and why this one was chosen.

The worklist reuses the shared `<stale_literal_candidates>` tag name (the
`STALE_DUPLICATE` rule's own prompt text references it) and renders each
candidate's literal, changed-site diff hunk, and every surviving site with
its comment/test/config tags. The prompt's `<verdict_guidance>` block
(added in PR #805, a targeted fix — not present in the original #803 pilot)
distinguishes literals that drive real runtime behavior from inert
duplication in test doubles/mocks/fixtures, after a measured false-positive
class (2 wrongful `stale` verdicts of 51 judged, on a captured real PR) was
found verdicting a test-helper mock that merely hardcoded a production
rule's display strings. Merge: unlike doc-truth, **the loop wins** on a
location collision — it carries per-candidate evidence the shared loop's
freeform grep pass doesn't — but only against a main-pass finding whose own
`ruleId` is also `stale-duplicate`, never an unrelated rule's finding that
happens to land nearby (`mergeStaleDuplicateFindings`).

### incomplete-handling candidate loop

Unifies three previously-separate signals under one pass and one `ruleId`:
`variant-sweep-signals.ts` (an added enum/union/const-object member whose
consumer sites weren't updated), `sibling-surface-signals.ts` (a
same-directory or mirror-directory sibling missing a matching change), and
`unread-field-signals.ts` (an added interface/type-literal/class field with
no read site anywhere in the indexed corpus).
`computeIncompleteHandlingCandidates` (`incomplete-handling-pass.ts:281`)
builds one combined, id-stable worklist in a fixed order (variant-sweep →
sibling-surface → unread-field), each shape capped locally, the combined
list capped at 20. Real-PR eligibility (union of all three signals) was
measured at 20/40 (50%) — sibling-surface is this repo's dominant real-world
producer (20/40 alone); variant-sweep and unread-field measured 0/40 each on
this corpus. (The module's own inline comment still cites an earlier
same-day estimate of 9/40 (22.5%) and explicitly defers to the PR body for
the up-to-date number — see ADR-014's Negative/Risks section.)

Toolset is `read_file` + `get_files_context` + `grep_codebase` — a superset
of the pilot's two tools, because none of the three signals attach an
inline code snippet the way `stale-literal-signals.ts` does; judging a
candidate here always requires reading the referenced site, and
`get_files_context` supplies the cross-file structural view needed to tell
whether an omission is actually handled via a mechanism (a dispatch table,
a wrapper) the signal's token-level scan couldn't see — the reason this
loop's verdict vocabulary has a fourth value, `handled`, distinct from
`intentional` (a deliberate design choice). An `FP_GUARD` prompt paragraph
warns against verdicting test-double/mock/fixture omissions `incomplete`,
baked in from the loop's first version rather than discovered post-hoc the
way the stale-duplicate pilot's equivalent guard was.

## Per-candidate verdict contract and `incomplete_verdict` honesty semantics

All three passes now use variants of the same contract: **one verdict
object required per candidate/claim id**, carried as extra fields
(`candidateId`/`claimId`, `verdict`) inside the standard `findings` JSON
array — so the shared client's existing parse/validate pipeline needs zero
changes. The two candidate loops closed the contract to the worklist
entirely; doc-truth's v2 mode (above) keeps it open to ad hoc findings
beyond the worklist, a deliberate difference reflecting that rule's own
"also skim for anything not listed" allowance. Each pass's own
`postProcessResult` hook (`postProcessStaleDuplicateResult`,
`postProcessIncompleteHandlingResult`, `postProcessDocTruthResult`):

1. Checks `hasCompleteVerdictCoverage`: every expected candidate id appears
   **exactly once**, each with a recognized verdict value. A duplicate id,
   an unrecognized verdict, or a missing id all fail this check — a
   candidateId-presence-only check would let a malformed entry (valid id,
   garbage verdict) silently vanish from both the coverage check *and* the
   findings array, exactly the "quiet gap" this contract exists to prevent.
2. Filters to only the "real finding" verdict(s) (`stale` for the pilot;
   `incomplete` for the unified loop — and, for the latter, only when
   `candidateId` also names a real worklist entry, closing a hallucinated-id
   loophole a code reviewer caught during PR #804; `contradicted`/
   `unverifiable` for doc-truth v2, dropping `accurate` ones and passing
   any ad hoc no-`claimId` finding through unchanged), stripping the
   loop-only fields via `toCleanFinding`/`toCleanDocTruthFinding`.
3. Marks the pass's own result `incomplete` (stop reason
   `'incomplete_verdict'`, a new `AgentStopReason` value,
   `packages/review/src/plugins/agent/types.ts`) when coverage failed — but
   only when the underlying client result wasn't *already* incomplete for a
   more specific reason (budget/max_turns/error), which takes precedence.

This is the mechanism-level fix for the doc-truth arc's own pr658
Finding-A lesson: a single open findings list, even scoped to one rule, can
still under-report unevenly across a long worklist. A per-candidate-ID-
required contract turns that failure mode into a machine-checkable
completeness assertion instead of a semantic judgment call the test harness
would otherwise have to infer from prose.

An incomplete extra pass (any reason) sets `AgentResult.incompleteFromPass`
to the pass's own name (`'stale-duplicate'` / `'incomplete-handling'`) —
doc-truth keeps its own dedicated `incompleteFromDocPass` boolean rather
than using the generic field, since it predates it. `appendIncompleteNotice`
(`index.ts`) reads whichever field is set to render a notice naming the
*specific* pass that didn't finish, rather than implying the whole review
is partial when only an extra pass was cut short.

## Attestation v2

`packages/review/src/attestation.ts`, `ATTESTATION_VERSION = 2`. Before this
generalization, `provider.passes[]` and `BudgetAttestation` were hardcoded
to exactly one entry (the main pass) — a real bug already live with zero
candidate loops added: an unfinished doc-truth pass folded its `stopReason`
into the *main* pass's own state, so a doc-truth-only budget starvation
attested as `mainPass.stopReason === 'budget'` (correctly non-silent, but
misattributed), and `budget.allocatedTokens` only ever reported the main
pass's own ceiling even though `spentTokens` already summed every pass.

- **`ProviderPassAttestation`** — `{ name, ran, stopReason, neverRan }`, one
  entry per pass that was gated on (main always present; each extra pass
  present iff it ran — a gated-off or failed pass is covered by
  `passesSkipped` instead, not duplicated here).
- **`PassBudgetAttestation`** — `{ name, allocatedTokens, spentTokens,
  starved }`, one per pass; `BudgetAttestation.passes[]` is the breakdown,
  `allocatedTokens`/`spentTokens`/`starved` at the top level are the sums/OR
  across all passes.
- **`computeVerdict`** finds the first pass (main first, then extras in
  declaration order) whose `stopReason !== 'completed'` and attributes
  `degraded:budget_starved` (if that pass stopped on `'budget'`) or
  `degraded:provider_partial` (anything else) to it specifically — no
  longer hardcoded to the main pass.

Wiring: `plugins/agent/index.ts`'s `reportPassOutcomes` forwards each extra
pass's `PassOutcome` (`{ name, stopReason, neverRan, allocatedTokens,
spentTokens }`, computed by `runExtraPasses`) through
`context.reportPassResult`, which `review-pr.ts`'s `runEngineForReview`
collects into `RunTelemetry.extraPasses`. `buildRunAttestation` passes that
array straight into `assembleAttestation`'s `extraPasses` input; the main
pass's own spent tokens are derived by subtracting every extra pass's
reported spend from the aggregate (`deriveMainSpentTokens`,
`review-pr.ts:418`) rather than tracked separately, since `reportUsage`
fires exactly once per pass that ran.

## Budget scaling

- **doc-truth**: flat fraction of the main pass's base budget —
  `docTruthPassBudget = round(baseBudget × 0.4)`. Adequate because the
  claims-only pass's input (pre-fetched evidence) rarely needs the tool
  loop.
- **stale-duplicate loop**: `clamp(2_000 + 800 × min(candidateCount, 8),
  4_000, 30_000)` — scaled by this pass's own candidate count (mirroring
  `summary-only-pass.ts`'s clamp pattern), not a flat fraction, so a
  1-candidate run doesn't pay for an 8-candidate ceiling.
- **incomplete-handling loop**: `clamp(2_500 + 900 × min(candidateCount,
  20), 5_000, 35_000)` — same shape, higher per-candidate cost and turn cap
  (8 vs. the pilot's 6) since every candidate here needs at least one
  `read_file`/`get_files_context` round trip before it can be judged (none
  of the three signals attach an inline snippet).

## Which passes are live today

- **doc-truth** — production-on, has been since PR #733. Kill-switches:
  `config.docTruthPass: false` or `LIEN_REVIEW_DOC_PASS=0` (documented in
  `packages/action/README.md` as the one Action-level tunable env var). Its
  v2 per-claim-verdict contract (PR #807, `LIEN_DOC_TRUTH_V2=on`, env-only,
  no config field) is a separate, **dark** opt-in layered on top — v1's
  open-findings-list behavior is unchanged when v2 is off.
- **stale-duplicate loop** — merged (PR #803, guard-fixed in PR #805) but
  **dark**: `config.staleDuplicatePass` defaults `false`; opt in via that
  config key or `LIEN_STALE_DUP_PASS=on`. Not exposed through
  `packages/action`'s `action.yml` inputs — reachable only by setting the
  env var directly on the Action step, same undocumented-by-design
  mechanism as any other internal flag.
- **incomplete-handling loop** — merged (PR #804) but **dark**:
  `config.incompleteHandlingPass` defaults `false`; opt in via that config
  key or `LIEN_INCOMPLETE_PASS=on`. Same non-exposure via `action.yml`.

Both dark passes have proven mechanism (gate/prompt/budget/merge/attestation
wiring, verified via unit tests and byte-diff-neutrality-when-off proofs)
but **unproven lift** — no priced A/B has yet shown either dedicated loop
finds more true positives or fewer false negatives than the shared loop's
own signal-augmented prompt on the same fixtures. See
[ADR-014](decisions/0014-per-rule-candidate-loop-passes.md) for the full
evidence state, the real-PR firing-rate census, and per-pass cost data.

## Related

- [ADR-014](decisions/0014-per-rule-candidate-loop-passes.md) — the
  decision this doc implements, its rejected alternatives, and its
  evidence/economics
- `docs/development/review-harness-judgment.md` — the doc-truth arc's
  competition-bottleneck evidence and harness judgment rules
- `packages/review/test/harness/README.md` — harness mechanics for
  calibrating any of these passes' rules

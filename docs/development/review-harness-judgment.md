# Review Harness — Judgment Guide

What you need to know to work on the agent-review rules and their test
harness without burning money or misreading results. Distilled from the
2026-07 hardening campaign (PRs #722–#733); the full mechanics live in
`packages/review/test/harness/README.md` — this guide is the judgment layer
on top: how to read results, where the traps are, and which battles have
already been fought.

## The one-paragraph mental model

Lien Review runs an LLM agent (prod default `moonshotai/kimi-k2.7-code` via
OpenRouter) over a PR with nine rules. The harness replays captured
real-PR fixtures against that agent and scores the output with tiered
assertions. **Every claim about rule behavior must come from a calibration
run** (`--calibrate 10`, ≥9/10 bar), never from a single run or from
reasoning about the prompt. Claude-subagent mode (`/test-harness`) is for
free iteration only — Claude is much smarter than the prod model, so a
passing CC run certifies nothing.

## Golden rules (each one cost real money to learn)

1. **Trust nothing red until you've verified the fixture and the account.**
   The two "known-red on Kimi" canaries that stood for weeks were (a) an
   assertion stricter than the rule prompt and (b) a silently-broken capture.
   Zero model gap. Before diagnosing any red: is the fixture a healthy
   capture, and did every vote actually run?
2. **Check per-vote cost/turns before reading a red batch as behavioral.**
   Calibration votes run in parallel; if the OpenRouter account dies
   mid-batch, votes fail non-uniformly as 1–2-turn runs with empty responses
   and near-zero cost. A `0/10 @ $0.00` result is starvation, not behavior.
   (The PROD side of this trap is closed: since #738 a CI review whose main
   pass never ran fails the check loudly with the cause named — but harness
   batches still need the per-vote autopsy.)
3. **Real billing ≈ 1.5–2× harness-reported cost**, and the repo's CI runs a
   paid Lien review on *every PR push with the same key*. Track spend via
   the credits API delta, and count ~1 CI review per push in any budget.
4. **Stop after one non-converging paid iteration.** Diagnose from traces
   (free) before every paid run — since #739 calibration ALWAYS persists
   per-vote traces (`.wip/traces/<stamp>-<scope>/`, printed in the run
   output), so there is never a reason to pay for a re-run just to see what
   happened. The traces almost always contain the answer: what the model
   actually said, which tools it called, what it declined. Use `--bail N`
   on fixtures you expect to be red — no need to burn all 10 votes.
5. **Prefer zero-LLM fixes.** Assertion changes can be validated for free by
   re-scoring saved trace votes through `assert-cli.ts`. Output-shape prompt
   changes can be A/B'd cheaply by single-turn replay of a captured trace
   (system prompt + inlined tool results + "emit your verdict now") — ~$0.03
   per sample. Only genuine behavior changes need fresh calibration.

## The capture pipeline

Fixtures are ~13 MB JSON snapshots of a real PR (diff + a full repo index),
gitignored, regenerated per-machine via `capture-pr.ts <pr> <out> [--sha]`.

- **The native parser must be built** in the capturing checkout
  (`npm run build:native -w @liendev/parser-native`). Without it every AST
  file silently chunks to zero and the corpus is markdown-only. The capture
  now fails loudly on that signature (corpus-wide zero source chunks); a
  *warning* about individual zero-chunk files is usually a declaration-free
  file (e.g. a VitePress config) and is fine.
- **Capture at the right SHA.** If the drift/bug you're pinning was fixed
  *within* the PR, `gh`'s head SHA is post-fix — capture at the pre-fix
  commit. Also: `gh`'s `baseRefOid` can be a stale main tip that isn't an
  ancestor of the head; the capture needs the true merge-base then.
- Fixture health check: ~5,000+ repoChunks, and the changed files' claims
  AND their contradicting code must both be findable in the fixture (grep
  the JSON). A fixture that can't carry both sides of its own bug is
  unfireable no matter what the model does.

## Fixture taxonomy — canary vs characterization

- **Canary** (`tags: ['canary']`): certified ≥9/10 on the prod model; a flip
  is a drift signal. The bar for touching a rule's prompt is ≥9/10 on that
  rule's canaries; shared scaffolding (output format, injected sections all
  rules see) needs a full-corpus no-regression sweep.
- **Characterization fixtures** (`tags: ['characterization']`): measure a known
  frontier and don't gate. The harness renders them as a neutral `~ … measured
  N/M (non-gating, see fixture header)` line rather than a red `✗`, and their
  result is excluded from the process exit code — so a run where only
  characterization fixtures miss their historical rate still exits 0. Their
  headers record the measured rate, the trace-verified failure mode, and why
  iteration stopped. Never spend calibration budget pushing a characterization
  fixture "green as a side effect" — read its header first; some (e.g.
  disclosed-removal changeset claims) are *correctly* declined by the model.

## The deterministic-signal pattern — and its limit

The house pattern for making a rule reliable: pre-compute the deterministic
part and inject it (`<stale_literal_candidates>`, `<untrusted_input_sites>`,
`<doc_claims>`, `<removed_exports>`). Zero-LLM, unit-testable, no
calibration spend for the extraction logic itself. `<removed_exports>` is
the pattern at its best — one signal serving two rules (structural-analysis
gets the removed symbols AND their surviving cross-file references
pre-swept; boundary-change gets the changeset cross-check), replacing a
"MUST grep every removed symbol" instruction outright.

The doc-truth arc mapped the pattern's limits precisely:

1. **Pre-computing the QUESTION isn't enough** (a claims worklist engaged
   the model but verification cost still didn't fit the budget).
2. **Pre-computing the ANSWER isn't enough either** when the finding must
   compete: with claim + contradicting evidence side by side, the model
   still spent its one findings list on juicier code bugs.
3. **The competition itself was the bottleneck** — proven by model swap
   (Sonnet 5 failed identically to Kimi). No amount of input engineering
   fixes an output-economy behavior; the fix was architectural (below).

Generalize this: when calibration plateaus, ask *which* resource is
saturated — discovery, verification budget, or the findings list — before
writing another prompt line. Traces answer this: does the model never see
it, see it and run out of budget, or see it and decline?

## The extra-pass architecture

Since PR #733, `analyze()` runs a second, claims-only pass when a PR's touched
doc surfaces carry claim-shaped prose: doc-truth rule alone, evidence-carrying
worklist, no competing rules, ~40% budget, findings deduped and merged,
failure-isolated (an incomplete doc pass surfaces its own notice rather than
reading as "no doc issues"). Kill-switches: config `docTruthPass: false` or
`LIEN_REVIEW_DOC_PASS=0`.

PR #799 generalized that one hardcoded pass into a `ReviewPassSpec` contract
plus a serial `runExtraPasses` executor, so any rule with a boundable,
enumerable candidate worklist can get its own dedicated pass the same way.
Two more have since been built this way — `stale-duplicate-pass.ts` (PR
#803) and `incomplete-handling-pass.ts` (PR #804) — each replacing doc-truth's
open findings list with a **per-candidate-ID-required verdict contract**: the
model must return exactly one verdict per candidate id, so a candidate
silently dropped from a long worklist (the `doc-truth/pr658-search-code-rename`
canary showed this can still happen even inside a dedicated, single-rule
pass) becomes a machine-checkable completeness failure instead of a semantic
judgment call the harness's assertions would otherwise have to infer. Both
ship dark (default-off config/env flags) —
mechanism proven, lift not yet calibrated. The same contract has since been
backported into doc-truth's own pass as a v2 mode (PR #807) — early paid
screening there (3 votes) held the certified doc-truth canary and hit zero
verdict-coverage gaps across a 48-id worklist. Unlike the two dark loops
above, v2 did NOT stay dark: it shipped opt-in (`LIEN_DOC_TRUTH_V2=on`), held
while the negative baseline (`accurate-doc`) wasn't yet trustworthy under it,
and — once #828 closed that gap (3/3 clean under both configs) — was
promoted to the DEFAULT by owner order (2026-07-23; opt out via
`config.docTruthV2: false` or `LIEN_DOC_TRUTH_V2=off`). If you add a rule that keeps
losing the findings competition and its candidates are enumerable with a
closed verdict set, a dedicated pass is the precedent to reach for — but
only after proving competition is the bottleneck, and only for a rule that
actually fits the candidate-loop shape (an open-investigation rule like
`concurrency-race` or `boundary-change` does not — see
[ADR-014](../architecture/decisions/0014-per-rule-candidate-loop-passes.md)
for the full reasoning and evidence, and
[Agent-Review Pass Architecture](../architecture/review-pass-architecture.md)
for the contract-level detail).

## Known frontiers (don't re-litigate without new evidence)

- **Lenient equivalence**: the model judges an under-enumerated doc claim
  ("has an index" vs a two-condition gate) as "close enough" ~30–40% even
  when instructed to compare strictly. pr667 plateaus at 6–7/10.
- **Omission-shaped claims** (a doc that omits what a sibling doc enumerates)
  are the weakest doc-truth shape: pr687 sits at 2/10 even with the sibling
  evidence attached.
- **Judgment-bounded fixtures**: pr711 (disclosed removal + "otherwise
  unchanged") is declined consistently and defensibly — a signal can't fix a
  judgment call.

## Where things live

- Harness mechanics + runbooks: `packages/review/test/harness/README.md`
- Rules + trigger logic: `packages/review/src/plugins/agent/rules.ts`
- Deterministic signals: `packages/review/src/*-signals.ts`
- The extra-pass executor: `packages/review/src/plugins/agent/review-pass.ts`
- The three shipped passes: `doc-truth-pass.ts`, `stale-duplicate-pass.ts`,
  `incomplete-handling-pass.ts` (same directory)
- Calibration driver: `packages/review/test/harness/run.ts` (`--calibrate`,
  `--trace`, `--fixture`, `--rule`, `--model`, `--bail`; traces persist to
  `.wip/traces/` by default)
- Offline re-scoring: `packages/review/test/harness/assert-cli.ts`
- Prompt rendering without an LLM: `packages/review/test/harness/build-prompts.ts`

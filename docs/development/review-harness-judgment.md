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
3. **Real billing ≈ 1.5–2× harness-reported cost**, and the repo's CI runs a
   paid Lien review on *every PR push with the same key*. Track spend via
   the credits API delta, and count ~1 CI review per push in any budget.
4. **Stop after one non-converging paid iteration.** Diagnose from saved
   `--trace` output (free) before every paid run. The traces almost always
   contain the answer: what the model actually said, which tools it called,
   what it declined.
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
- **Characterization fixtures** (no tag): measure a known frontier and don't
  gate. Their headers record the measured rate, the trace-verified failure
  mode, and why iteration stopped. Never spend calibration budget pushing a
  characterization fixture "green as a side effect" — read its header first;
  some (e.g. disclosed-removal changeset claims) are *correctly* declined by
  the model.

## The deterministic-signal pattern — and its limit

The house pattern for making a rule reliable: pre-compute the deterministic
part and inject it (`<stale_literal_candidates>`, `<untrusted_input_sites>`,
`<doc_claims>`). Zero-LLM, unit-testable, no calibration spend for the
extraction logic itself.

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

## The two-pass architecture

Since PR #733, `analyze()` runs a second, claims-only pass when a PR's touched
doc surfaces carry claim-shaped prose: doc-truth rule alone, evidence-carrying
worklist, no competing rules, ~40% budget, findings deduped and merged,
failure-isolated (an incomplete doc pass surfaces its own notice rather than
reading as "no doc issues"). Kill-switches: config `docTruthPass: false` or
`LIEN_REVIEW_DOC_PASS=0`. If you add a rule that keeps losing the findings
competition, this is the precedent to reach for — but only after proving
competition is the bottleneck.

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
- The doc-truth second pass: `packages/review/src/plugins/agent/doc-truth-pass.ts`
- Calibration driver: `packages/review/test/harness/run.ts` (`--calibrate`,
  `--trace`, `--fixture`, `--rule`, `--model`)
- Offline re-scoring: `packages/review/test/harness/assert-cli.ts`
- Prompt rendering without an LLM: `packages/review/test/harness/build-prompts.ts`

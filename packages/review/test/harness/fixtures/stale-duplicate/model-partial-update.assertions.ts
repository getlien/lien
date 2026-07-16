/**
 * Snapshot from PR #539 at SHA f780541 — the model-bump-only state, before
 * CodeRabbit caught the stale hardcoded `'claude-sonnet-4-6'` on
 * adapterContext.model (pr-review.ts:300) that the line-272 conditional
 * missed. The fix landed in the next commit (`dd3b82c`), hoisting both
 * sites into a shared `selectedModel` const.
 *
 * Capture command:
 *   npx tsx packages/review/test/harness/capture-pr.ts 539 \
 *     packages/review/test/harness/fixtures/stale-duplicate/model-partial-update.fixture.json \
 *     --sha f780541
 *
 * Tier 1: rule fires. (We no longer assert grep_codebase: the deterministic
 * <stale_literal_candidates> signal now pre-computes the surviving copy and
 * injects it, so a correct agent confirms the candidate instead of grepping —
 * and in fixture replay grep_codebase is blind against the dead repoRootDir
 * anyway. See packages/review/src/stale-literal-signals.ts and memory
 * project_harness_grep_read_replay_blindness.)
 * Tier 2: the finding cites adapterContext / line 300 / claude-sonnet-4-6
 * or proposes a hoist to a shared const. Keyword set is deliberately wide
 * to cover the phrasings any correct rendering will use.
 *
 * Calibration status: 10/10 on `moonshotai/kimi-k2.7-code` (2026-07-10,
 * --calibrate 10). The earlier "known-red on Kimi" label was stale: red
 * runs traced to a broken capture (native parser unbuilt → markdown-only
 * corpus → <stale_literal_candidates> rendered "None" and suppressed the
 * finding). capture-pr.ts now rejects such partial captures loudly.
 *
 * KEYWORD-INTEGRITY SWEEP (2026-07-16): the widening list was bare-noun-heavy
 * ('sonnet', 'stale', 'hardcoded', 'attribution', 'metadata', 'outside the
 * diff', 'single source', 'one source of truth' — all generic
 * stale-duplicate vocabulary) and false-passed a hand-written distractor via
 * assert-cli.ts: a finding about a *different* hardcoded literal in the same
 * file (a separately-duplicated default-model fallback string) matched via
 * hardcoded/stale/outside the diff/single source, without ever naming
 * adapterContext, line 300, or the claude-sonnet-4-6 literal. Tightened to
 * the site anchor plus narrower model-string variants and compound hoist
 * phrasing. This canary's 10/10 PREDATES this tightening; no stored vote
 * traces exist in this worktree to offline re-score — the upcoming corpus
 * recalibration sweep re-measures it.
 *
 * 3-vote screen 2026-07-16 post-#787 state: 2/3 [SCREEN ONLY — calibrate-10
 * certification pending]. Failed vote (same shape pre- and post-#787, 2/3
 * both): healthy tool turns then a stop-turn emitting ~28 chars of
 * corrupted JSON ({"findings":":[{",": ":", "}) -> zero findings. Not a
 * budget shape — #787 did not move it; this is the corrupted-key verdict
 * family (#723's recovery does not catch it).
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #539 f780541 — model bump missed adapterContext.model on line 300',
  rule: 'stale-duplicate',
  expect: (result, h) => {
    h.expectRuleFired('stale-duplicate', result);
    // Kept to the specific site anchor (adapterContext / line 300 / the
    // literal model string) and compound hoist phrasing — not bare
    // 'sonnet'/'stale'/'hardcoded'/'attribution'/'metadata'/'outside the
    // diff'/'single source'/'one source of truth', each generic enough that
    // an unrelated stale-duplicate finding about a *different* hardcoded
    // literal elsewhere in the same file (e.g. a separately-hardcoded
    // default-model fallback string) also satisfies (verified via
    // assert-cli.ts: exactly that distractor false-passed the original list
    // via hardcoded/stale/outside the diff/single source, without ever
    // naming adapterContext, line 300, or the claude-sonnet-4-6 literal).
    h.expectFindingMentions(
      [
        'adaptercontext',
        'line 300',
        'claude-sonnet-4-6',
        'claude-sonnet',
        'sonnet-4-6',
        'selectedmodel',
        'hoist',
        'single source of truth for the model',
        'one source of truth for the model',
        'shared const for the model',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

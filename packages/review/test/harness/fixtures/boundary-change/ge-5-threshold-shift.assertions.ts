/**
 * Snapshot from PR #520 (planted regression):
 *   classifyLevel input BlastRadiusRiskInput, change `> 5` -> `>= 5`.
 *
 * Reclassifies dependentCount === 5 from 'low' to 'medium', cascading
 * into every review's global risk score per the retro doc §2.3 / §3.
 *
 * Tier 1: rule fires, mandatory get_files_context call happens.
 * Tier 2: the finding must articulate the boundary-value reclassification —
 * that dependentCount === 5 flips from 'low' to 'medium' and is untested.
 *
 * Recalibrated 2026-06-27 (model A/B eval): the prior "test pair / both sides"
 * vocabulary only ever matched on the word "divergence". Tracing both
 * google/gemini-3-flash-preview and moonshotai/kimi-k2.7-code showed neither
 * actually recommends testing *both* sides — both emit the same correct
 * single-sided rec (add a test for dependentCount: 5 -> 'medium'). gemini hit
 * 10/10 only because it says "divergence" every run; kimi says it in ~40% of
 * runs, so it failed the brittle check despite an equivalent finding.
 *
 * The check asserts the real shared substance as a conjunction (separate
 * expectFindingMentions calls => AND; each any-of for phrasing robustness):
 * (1) names the boundary value (=== 5), (2) states the low->medium flip, and
 * (3) recommends a TEST PAIR pinning both sides of the boundary.
 *
 * On gate (3): #591 had REMOVED a "both sides" check because it only ever
 * matched the word "divergence" — neither model actually recommended both
 * sides (gemini passed 10/10 on vocabulary; kimi failed ~60% despite an
 * equivalent single-sided finding). The boundary-change rule was then updated
 * to explicitly ask for a test pair; after that, gemini-3-flash and
 * kimi-k2.7-code both emit "test pair" in 12/12 traced runs, so gate (3) is a
 * real, achievable substance check that locks the improvement in. See PR #591
 * (recalibration) plus the boundary-rule improvement that added gate (3).
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #520 — > 5 → >= 5 in classifyLevel (blast-radius-risk.ts)',
  rule: 'boundary-change',
  expect: (result, h) => {
    h.expectRuleFired('boundary-change', result);
    h.expectToolCalled('get_files_context', result);
    // (1) names the boundary value, AND (2) states the low->medium flip.
    // Both required (two calls = AND). Quote-tolerant variants so a model that
    // omits or changes quotes still matches. Verified present in 100% of
    // gemini-3-flash and kimi-k2.7-code runs (calibrate-10 + per-vote traces).
    h.expectFindingMentions(['dependentCount === 5', 'dependentCount: 5', 'exactly 5'], result);
    h.expectFindingMentions(["low' to 'medium'", '"low" to "medium"', 'low to medium'], result);
    // (3) recommends a TEST PAIR — pin BOTH sides of the boundary, not just the
    // value that crosses. Accept either an explicit pair phrase OR a reference
    // to the adjacent value (4): since gate (1) already requires the boundary
    // value (5), a finding that also names 4 is recommending both sides — the
    // real substance, independent of wording. The generic words "pin"/"adjacent"
    // are deliberately NOT gated on (they can appear in a single-sided finding —
    // PR #594 review). Now achievable after the boundary-change rule was updated
    // to ask for a test pair; this list matches 22/22 traced gemini-3-flash +
    // kimi-k2.7-code runs (was 0 before the rule change).
    h.expectFindingMentions(
      [
        'test pair',
        'both sides',
        'either side',
        'dependentCount: 4',
        'dependentCount === 4',
        'value 4',
        'input 4',
        '4 (low',
        'and 4',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

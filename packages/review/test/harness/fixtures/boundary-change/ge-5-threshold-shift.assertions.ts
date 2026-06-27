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
 * The check now asserts the real shared substance as a conjunction: the finding
 * must name the boundary value (=== 5) AND state the low->medium flip. Two
 * separate expectFindingMentions calls => AND; each is any-of for phrasing
 * robustness. The aspirational "both sides" terms are deliberately NOT in the
 * gating lists — expectFindingMentions is an any-substring matcher, so mixing
 * them in would let a finding pass on vocabulary alone (the very brittleness
 * this recalibration removes). See PR #591 review (CodeRabbit + Lien self-review).
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
    h.expectFindingMentions(["low' to 'medium'", 'low to medium'], result);
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

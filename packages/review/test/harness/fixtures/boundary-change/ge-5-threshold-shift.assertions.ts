/**
 * Snapshot from PR #520 (planted regression):
 *   classifyLevel input BlastRadiusRiskInput, change `> 5` -> `>= 5`.
 *
 * Reclassifies dependentCount === 5 from 'low' to 'medium', cascading
 * into every review's global risk score per the retro doc §2.3 / §3.
 *
 * Tier 1: rule fires, mandatory get_files_context call happens.
 * Tier 2: §4.3 test-pair vocabulary check — the suggestion mentions
 * tests for both sides of the divergence, not just the new boundary.
 * Production model (google/gemini-3-flash-preview, bumped in #539) hits
 * this 10/10; the previous gemini-2.5-flash hit 0/10. See
 * .wip/multi-model-eval.md.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #520 — > 5 → >= 5 in classifyLevel (blast-radius-risk.ts)',
  rule: 'boundary-change',
  expect: (result, h) => {
    h.expectRuleFired('boundary-change', result);
    h.expectToolCalled('get_files_context', result);
    h.expectFindingMentions(
      [
        'test pair',
        'both sides',
        'divergence',
        'both inputs',
        'input 4',
        'adjacent',
        'pins',
        'either side',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

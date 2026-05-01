/**
 * Placeholder assertions for the boundary-change harness wiring test.
 *
 * Synthetic scenario — modeled after PR #520 (the > 5 → >= 5 threshold
 * shift) but minimal. Used to verify the harness pipeline end-to-end
 * before the snapshot fixture (M3) replaces it.
 *
 * Tier 1 only — the snapshot fixture in M3 will add Tier 2 keyword checks
 * for §4.3 once we have a real captured ctx.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'Placeholder boundary-change scenario (>5 → >=5 in classifyLevel)',
  rule: 'boundary-change',
  expect: (result, h) => {
    h.expectRuleFired('boundary-change', result);
  },
  votes: 1,
  passThreshold: 1,
  tags: ['placeholder'],
};

export default assertions;

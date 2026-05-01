/**
 * PR #509 — formatPercentChange uses (after - before) / before without
 * Math.abs on the denominator. For negative `before`, the sign flips:
 * percentChange(-100, -50) returns '-50%' even though the value improved.
 * Classic edge-case-sweep target (negative-input branch).
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #509 — formatPercentChange sign-flip on negative before',
  rule: 'edge-case-sweep',
  expect: (result, h) => {
    h.expectRuleFired('edge-case-sweep', result);
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

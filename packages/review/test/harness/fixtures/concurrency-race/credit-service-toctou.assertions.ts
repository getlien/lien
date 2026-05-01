/**
 * PR #511 — CreditService introduces three DB::transaction blocks each
 * using Organization::lockForUpdate()->find($org->id). Hits keywords
 * `transaction`, `lockForUpdate`, `DB::transaction`. Real check-then-act
 * on credit balance — ripe for TOCTOU analysis.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #511 — CreditService check-then-act with lockForUpdate',
  rule: 'concurrency-race',
  expect: (result, h) => {
    h.expectRuleFired('concurrency-race', result);
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

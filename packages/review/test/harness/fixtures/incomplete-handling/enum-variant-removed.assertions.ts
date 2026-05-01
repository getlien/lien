/**
 * PR #437 — UserRole enum no longer includes Guest. getPermissionsForRole
 * switch falls through to default: [] for any unhandled variant. Rule
 * should flag the missing-case / partial-iteration pattern.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #437 — UserRole switch falls through on missing variant',
  rule: 'incomplete-handling',
  expect: (result, h) => {
    h.expectRuleFired('incomplete-handling', result);
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

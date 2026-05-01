/**
 * PR #411 — PaymentService::charge wrapped in try { ... } catch { return
 * false; }. Throws are silently converted to a `false` result. Textbook
 * error-swallowing: the caller cannot distinguish "charge declined" from
 * "charge crashed".
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #411 — PaymentService charge wraps throw in catch → false',
  rule: 'error-swallowing',
  expect: (result, h) => {
    h.expectRuleFired('error-swallowing', result);
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

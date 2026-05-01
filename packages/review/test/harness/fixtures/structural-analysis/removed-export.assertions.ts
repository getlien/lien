/**
 * PR #399 — `parse_input` (Rust exported function) entirely removed.
 * Classic structural breakage: any caller of `parse_input` is now broken.
 *
 * Per structural-analysis prompt, the agent MUST call grep_codebase for
 * each removed symbol name to check if any file still imports it. The
 * Tier 1 assertion enforces both: rule fires + investigation happened.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #399 — removed parse_input export (Rust)',
  rule: 'structural-analysis',
  expect: (result, h) => {
    h.expectRuleFired('structural-analysis', result);
    h.expectToolCalled('grep_codebase', result);
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

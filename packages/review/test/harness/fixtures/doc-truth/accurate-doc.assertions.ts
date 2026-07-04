/**
 * Hand-authored precision guard for the doc-truth rule — the no-finding case.
 *
 * The touched doc comment ("Search is disabled when the index is missing or
 * empty") makes a behavioral claim of exactly the shape doc-truth targets
 * ("disabled when …"), so the rule ACTIVATES — but the claim is TRUE: the code
 * in the same hunk returns `{ mode: 'disabled' }` when `!index || index.size ===
 * 0`. A correct reviewer verifies the claim against the visible code and stays
 * silent. This guards against the rule flagging accurate prose (precision), the
 * failure mode that makes a doc rule noisy.
 *
 * The diff touches only comment lines (no changed logic, no changed string
 * literals, no removed exports), so the always-on rules — edge-case-sweep,
 * structural-analysis, stale-duplicate — have nothing to fire on either.
 * `expectEmpty` therefore holds for the whole result, not just doc-truth.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'Accurate doc comment ("disabled when the index is missing or empty") that matches ' +
    'the code — doc-truth activates but must stay silent',
  rule: 'doc-truth',
  expect: (result, h) => {
    h.expectEmpty(result);
  },
  votes: 3,
  passThreshold: 9,
  tags: ['doc-truth', 'hand-authored', 'precision'],
};

export default assertions;

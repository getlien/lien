/**
 * PR #574 — negative regression: `scanAll` has an explicit `if (!table)`
 * guard immediately before its try/catch. After the throw, TypeScript
 * narrows `table` to non-null for the rest of the function, so
 * `table.countRows()` inside the try cannot deref null. The rule fired a
 * false positive against `packages/core/src/vectordb/query.ts:652`
 * claiming the deref was unguarded — see
 * https://github.com/getlien/lien/pull/574#discussion_r3252525960.
 *
 * The same shape appears across `query.ts`, `lancedb.ts`,
 * `maintenance.ts`, and other VectorDB code (every method taking
 * `table: LanceDBTable | null` does this guard), so silencing this FP
 * shape is a high-leverage prompt fix.
 *
 * Calibration status (recorded 2026-05-16, against the unmodified prompt):
 *   pending — fixture authored, calibration run not yet executed. Will
 *   fail on the current prompt; that's the documented gap.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #574 — early `if (!table) throw` guard before try/catch should NOT fire error-swallowing',
  rule: 'error-swallowing',
  expect: (result, h) => {
    // Tier 1: the rule must produce zero findings against this PR. The
    // diff is a perf fix (single-shot scanAll); it changes no error-handling
    // shape, so any error-swallowing finding is by definition a regression.
    h.expectEmpty(result);
  },
  votes: 3,
  passThreshold: 9,
};

export default assertions;

/**
 * PR #575 — second negative regression on the `error-swallowing` rule.
 *
 * The PR added a `.assertions.ts` for a new harness fixture but
 * intentionally did NOT commit the corresponding `.fixture.json` — that's
 * the project-wide convention for this harness:
 *
 *   - `.gitignore:87` excludes
 *     `packages/review/test/harness/fixtures/** /*.fixture.json` for every
 *     fixture (10MB+ each).
 *   - The `packages/review/test/harness/README.md` documents the pattern:
 *     "Captured fixtures aren't committed (size). They're gitignored —
 *     regenerate locally via `capture-pr.ts`."
 *   - All 8 existing canary fixtures follow the same pattern.
 *
 * The `error-swallowing` rule flagged this as a 🟡 risk: "Without the
 * fixture JSON, the test harness cannot execute these assertions in CI or
 * for other developers, defeating the purpose of a regression test." That
 * conclusion is locally plausible but globally wrong — the rule didn't
 * recognize the surrounding convention (8 sibling `.assertions.ts` files
 * paired with already-gitignored `.fixture.json` blobs).
 *
 * Comment thread: https://github.com/getlien/lien/pull/575#discussion_r3252554373
 *
 * Sister fixture: `scanall-null-guard-fp.assertions.ts` captures a
 * different `error-swallowing` FP shape (early null-guard before try/catch
 * read as unguarded deref). Both rules-iteration targets should be checked
 * before any `error-swallowing` prompt change ships.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #575 — `.fixture.json` gitignored per harness convention should NOT fire error-swallowing as risk',
  rule: 'error-swallowing',
  expect: (result, h) => {
    // Tier 1: the rule must produce zero findings. The PR's diff adds a
    // documented harness fixture; gitignoring the captured JSON is
    // project-standard. Any error-swallowing finding here is a regression.
    h.expectEmpty(result);
  },
  votes: 3,
  passThreshold: 9,
};

export default assertions;

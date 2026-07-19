/**
 * Boundary fixture (docs-drift design doc §0.2, §5.B, `.wip/docs-drift-design.md`).
 *
 * Captured PR #799 ("refactor(review): generalize doc-truth's second pass
 * into a ReviewPass executor") at its own branch head SHA
 * `028ebca4bd57ed5572ab29a3643d9786c83227ea` — the commit `3e4af932` the
 * design doc cites is the SQUASH-MERGE commit on `main`, which is not an
 * ancestor of the PR's own branch lineage that `capture-pr.ts`'s
 * `assertShaInPrRange` validates against; both commits carry the identical
 * tree, so this SHA is the equivalent, capturable one.
 *
 * Capture command:
 *   npx tsx packages/review/test/harness/capture-pr.ts 799 \
 *     packages/review/test/harness/fixtures/docs-drift/pr799-two-pass-boundary.fixture.json \
 *     --sha 028ebca4bd57ed5572ab29a3643d9786c83227ea
 * The fixture's `config` was then hand-edited to add `docsDriftPass: true`
 * (capture-pr.ts never sets pass-specific config; the pass is dark by
 * default and this loop is genuinely enabled for this fixture's proof).
 *
 * THE SCOPE-CEILING CASE this fixture locks in: at this SHA,
 * `docs/development/review-harness-judgment.md` still reads (verified via
 * `git show 028ebca4:docs/development/review-harness-judgment.md`):
 *
 *   ## The two-pass architecture
 *   Since PR #733, `analyze()` runs a second, claims-only pass when a PR's
 *   touched doc surfaces carry claim-shaped prose: ...
 *   ...
 *   - The doc-truth second pass: `packages/review/src/plugins/agent/doc-truth-pass.ts`
 *
 * PR #799 (`3e4af932`) generalized two-pass -> N-pass in CODE and renamed
 * `runDocTruthPass` -> `runReviewPass`, `appendDocTruthTurns` -> `appendPassTurns`
 * — but the stale doc references the FILE `doc-truth-pass.ts` (which still
 * exists — the module wasn't deleted, only two of its internal functions were
 * renamed/generalized) and the CONCEPT "two-pass architecture" (now
 * conceptually stale — it's N-pass), not either renamed function by name.
 *
 * docs-drift is a deterministic identifier/path referand sweep
 * (removed-export-signals.ts / rename-sweep-signals.ts / this module's own
 * isFullFileDeletion) — it has no token to anchor on here: `doc-truth-pass.ts`
 * was never deleted (isFullFileDeletion is false for it), and neither
 * `runDocTruthPass` nor `appendDocTruthTurns` is named anywhere in the stale
 * prose for the rename-sweep referand to match against. A reader-visible
 * concept going stale with no removed/renamed/deleted TOKEN present in the
 * prose is structurally invisible to this signal — the permanent scope
 * ceiling design §0.2/§5.B accepts (a prose-behavioral-claim tier over
 * untouched docs is explicitly deferred, design §6.5 — the "input engineering
 * can't fix output economy" trap).
 *
 * Independently reproduced by the zero-LLM 40-PR census (.wip/docs-drift-census/
 * SUMMARY.txt): PR #799 is one of only 2/40 PRs with ANY removed-export/
 * renamed-identifier/deleted-path referand at all (three renamed functions:
 * `DocTruthClientRunner`, `runDocTruthPass`, `appendDocTruthTurns`), yet its
 * raw reference count against the untouched doc/config corpus is 0 — no doc
 * anywhere names those three tokens. This fixture is the offline (zero-LLM)
 * lock-in of that same finding: the pass must gate OFF entirely (skipReason
 * non-null, zero candidates), so no `docs-drift` finding is even POSSIBLE,
 * paid or not.
 *
 * OFFLINE PROOF (zero-LLM, no OpenRouter spend — see PR body for the
 * verbatim run): `LIEN_DOCS_DRIFT_PASS=on npx tsx
 * packages/review/test/harness/build-prompts.ts <this fixture>` ->
 * `docsDriftPass: {"fires":false}`; `docsDriftSkipReason(ctx, config)` ->
 * "no untouched-doc reference to a removed/renamed/deleted referand in this
 * PR"; `computeDocsDriftPassCandidates(ctx)` -> `[]`.
 *
 * This fixture is `tags: ['boundary']`, not `canary` — it locks in a NEGATIVE
 * (docs-drift correctly does not fire), marking the permanent scope ceiling
 * rather than certifying a positive detection.
 */

import { HarnessAssertionError } from '../../assertions.js';
import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #799 028ebca4 — two-pass->N-pass generalization; review-harness-judgment.md still says ' +
    '"## The two-pass architecture" and names the still-existing doc-truth-pass.ts file (not the ' +
    'renamed runDocTruthPass/appendDocTruthTurns functions) — docs-drift correctly finds ZERO ' +
    'candidates (conceptual/architectural drift is the permanent scope ceiling, design §0.2/§5.B)',
  rule: 'docs-drift',
  expect: result => {
    const docsDriftFinding = result.findings.find(f => f.ruleId === 'docs-drift');
    if (docsDriftFinding) {
      throw new HarnessAssertionError(
        'Tier 1: expected docs-drift NOT to fire on this boundary fixture (conceptual drift with ' +
          'no removed/renamed/deleted token is structurally out of scope, design §0.2/§5.B). Got ' +
          `a docs-drift finding: ${docsDriftFinding.message}`,
        1,
      );
    }
  },
  votes: 1,
  passThreshold: 1,
  tags: ['boundary'],
};

export default assertions;

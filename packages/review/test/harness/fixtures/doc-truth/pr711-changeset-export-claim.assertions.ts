/**
 * Snapshot from PR #711 ("chore: dead-code hygiene from the post-migration
 * audit (c8, EmbeddingError, stale example paths)") captured at the
 * planted-claim commit headSha 4480f85ed931 (base c7be7b68225b). The changeset
 * and the code it describes are in the same diff, so the claim is verifiable
 * from in-prompt material alone.
 *
 * Calibration status (2026-07-11, kimi-k2.7-code, --calibrate 10): 0/10
 * pre-signal AND 0/10 with the <doc_claims> worklist. In both runs traces
 * show the model engages the claim in EVERY vote (investigates remaining
 * EmbeddingError references, checks dependents, discusses "otherwise
 * unchanged") and then deliberately declines — the changeset's first
 * sentence discloses the removal, so "otherwise" has an honest lenient
 * reading. A consistent judgment call, not a discovery failure; no signal
 * fixes judgment. Characterization fixture, not a canary.
 *
 * THE PLANTED CLAIM (touched prose, .changeset/remove-embedding-error.md):
 *   "Removed the unused embeddings-era `EmbeddingError` class and its
 *    `EMBEDDING_MODEL_FAILED`/`EMBEDDING_GENERATION_FAILED` error codes. …
 *    `LienErrorCode` and the public error exports are otherwise unchanged."
 * The changeset front-matter bumps `@liendev/core` as a **patch**.
 *
 * WHY IT'S FALSE / UNDERSTATED (contradicting code in the SAME diff):
 *   - packages/core/src/index.ts removes `EmbeddingError` from the package's
 *     public `export { … }` block (the `-  EmbeddingError,` line, right beside
 *     `LienErrorCode`). Removing a public export from `@liendev/core` is a
 *     BREAKING API change, not a patch.
 *   - packages/core/src/errors/codes.ts removes the `EMBEDDING_MODEL_FAILED`
 *     and `EMBEDDING_GENERATION_FAILED` members from the `LienErrorCode` enum.
 *   So "`LienErrorCode` and the public error exports are otherwise unchanged"
 *   glosses a breaking public-API removal: `LienErrorCode` lost two members and
 *   the public surface lost `EmbeddingError`, with no consumer migration path.
 *   (The real follow-up commit 0956f9e fixed exactly this: it deleted the
 *   "otherwise unchanged" sentence and replaced it with an explicit public-API
 *   removal note plus migration guidance — catch the `LienError` base class or
 *   a remaining `LienErrorCode`.)
 *
 * WHAT A CORRECT FINDING MUST SAY: quote the changeset's "public error exports
 * are otherwise unchanged" and flag that the diff removes `EmbeddingError` from
 * `@liendev/core`'s public exports (packages/core/src/index.ts) — a breaking
 * removal the `patch` bump / "unchanged" wording understates — and drops two
 * `LienErrorCode` members. Cite the removed `export { EmbeddingError }` line as
 * the falsifying fact.
 *
 * Capture command (fixture carries pr.headSha 4480f85ed931…, base c7be7b68…):
 *   npx tsx packages/review/test/harness/capture-pr.ts 711 \
 *     packages/review/test/harness/fixtures/doc-truth/pr711-changeset-export-claim.fixture.json \
 *     --sha 4480f85ed931e461a7591176d6a863a0aec750b8
 *
 * Structural note for calibration: `.changeset/**` is a doc-truth guidance
 * surface, so the changeset prose rides in <guidance_surface_changes>; the
 * index.ts / codes.ts removals are ordinary in-diff hunks. Everything the
 * finding needs is in-prompt — no blind read_file/grep dependency. One honest
 * ambiguity to watch: the changeset DISCLOSES the removal in its first sentence,
 * so a lenient reviewer may read "otherwise unchanged" as "other than the
 * disclosed removals" and stay quiet; the sharper, more defensible finding is
 * that a removed public export is breaking and the patch/"unchanged" framing
 * understates it. NOT tagged canary until a calibration baseline exists.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #711 4480f85 — .changeset/remove-embedding-error.md says "the public error exports are ' +
    'otherwise unchanged" (patch bump) while the diff removes the exported `EmbeddingError` from ' +
    "@liendev/core's public exports and drops two LienErrorCode members — a breaking change",
  rule: 'doc-truth',
  expect: (result, h) => {
    h.expectRuleFired('doc-truth', result);
    h.expectFindingMentions(
      [
        // The removed public symbol — the crux
        'embeddingerror',
        // The false / understated claim
        'otherwise unchanged',
        'unchanged',
        'public error exports',
        // The breaking-change framing a correct finding uses
        'public export',
        'public api',
        'public-api',
        'breaking',
        'removed',
        'no longer exported',
        // Anchors
        'index.ts',
        'lienerrorcode',
        'embedding_generation_failed',
        // The semver angle (secondary)
        'patch',
        'semver',
        'major',
        'minor',
        'migration',
        'export',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: [],
};

export default assertions;

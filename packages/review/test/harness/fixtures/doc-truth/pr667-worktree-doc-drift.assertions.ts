/**
 * Snapshot from PR #667 ("feat(core): worktree-aware indexing (shared base +
 * per-worktree overlay)") captured at the planted-claim commit
 * headSha 1882b38d5228 (base 3b191a6a5cbc). This PR adds BOTH the design doc
 * `docs/architecture/worktree-aware-indexing.md` AND the code it describes,
 * `packages/core/src/vectordb/overlay-resolution.ts` (`resolveIndexStrategy`),
 * in the same diff — so the reviewer has full in-prompt context on both sides
 * of the claim. Lien Review had every fact it needed and still let this drift
 * through, which is why this is the strongest doc-truth canary in the corpus.
 *
 * THE PLANTED CLAIM (touched prose in the design doc, "Detection" section):
 *   "We additionally require that the resolved main root is **not** the current
 *    root and that it **has an index** (`structural.db` exists). If either
 *    fails we fall back to standalone."
 * The doc's Fallbacks table reinforces the same narrow gate: "Main checkout
 * has **no index** | Standalone." Both describe the base-index gate as a
 * single condition: `structural.db` exists.
 *
 * WHY IT'S FALSE (contradicting code, in the SAME diff —
 * `packages/core/src/vectordb/overlay-resolution.ts`, `resolveIndexStrategy`):
 *   const hasDb = await fileExists(path.join(baseIndexDir, STRUCTURAL_DB_FILENAME));
 *   const hasManifest = await fileExists(path.join(baseIndexDir, MANIFEST_FILE));
 *   if (!hasDb || !hasManifest) { warnOnce(...); return { mode: 'standalone' }; }
 * The overlay gate requires BOTH `structural.db` AND `manifest.json` — the code's
 * own doc comment even spells it out ("the main checkout has a `structural.db`
 * AND a `manifest.json` (the base per-file content hashes the overlay diff
 * relies on)"). A main checkout that has `structural.db` but no `manifest.json`
 * qualifies for overlay mode per the design doc, but the code falls back to
 * standalone. The doc understates the gate the code actually enforces. (This
 * drift was never corrected — the merged doc still reads "has an index
 * (`structural.db` exists)" at line 53 today.)
 *
 * WHAT A CORRECT FINDING MUST SAY: quote the doc's "has an index
 * (`structural.db` exists)" gate and state the real gate — `resolveIndexStrategy`
 * requires `structural.db` AND `manifest.json`, falling back to standalone when
 * `manifest.json` is absent — citing the `hasDb`/`hasManifest` check as the
 * code fact that falsifies the single-condition claim.
 *
 * Capture command (fixture carries pr.headSha 1882b38d5228…, base 3b191a6a…;
 * pr.number is null because the diff is computed via git diff base..sha):
 *   npx tsx packages/review/test/harness/capture-pr.ts 667 \
 *     packages/review/test/harness/fixtures/doc-truth/pr667-worktree-doc-drift.fixture.json \
 *     --sha 1882b38d52284a216665a4067a35ad321613f045
 *
 * Structural note for calibration (verified via build-prompts.ts on this
 * fixture): the doc CLAIM survives into the prompt in both <diff> and
 * <guidance_surface_changes> ("has an index (`structural.db` exists)"). The
 * falsifying CODE does NOT: the ~321-line design doc pushes the <diff> block
 * past its char budget, so it truncates ("[Diff truncated — use read_file …]")
 * BEFORE the overlay-resolution.ts hunk — the `hasDb`/`hasManifest` gate is not
 * shown as a raw hunk. What survives is `resolveIndexStrategy`'s signature in
 * <changed_functions> (a signpost) and the full function body in repoChunks.
 * So reaching the finding requires the protocol's mandated step — call
 * get_files_context on the changed overlay-resolution.ts to read the two-
 * condition gate (get_files_context reads indexed chunks, so it is reliable
 * here and is NOT a blind read_file/grep). Net: verifiable, but gated on the
 * reviewer following step 2 rather than pattern-matching the prose. That is by
 * design for the canary — it tests protocol-following, not prose-matching.
 *
 * Calibration status: NOT yet calibrated against Kimi. Tagged `canary`
 * pre-emptively — this is the reference full-context doc-truth miss. Run
 * `--calibrate 10` on kimi and record the per-run breakdown here before relying
 * on it as a drift signal.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #667 1882b38d — worktree-aware-indexing.md Detection section says the base-index gate ' +
    'is just "has an index (`structural.db` exists)", but resolveIndexStrategy requires ' +
    'structural.db AND manifest.json (falls back to standalone without the manifest)',
  rule: 'doc-truth',
  expect: (result, h) => {
    h.expectRuleFired('doc-truth', result);
    h.expectFindingMentions(
      [
        // The crux: the omitted second gate condition
        'manifest.json',
        'manifest',
        // The doc's stated (narrow) gate
        'structural.db',
        'has an index',
        // The code that enforces the real gate
        'resolveindexstrategy',
        'hasmanifest',
        'hasdb',
        // Vocabulary a correct finding reaches for
        'overlay',
        'worktree-aware-indexing',
        'both',
        'requires',
        'standalone',
        'fall back',
        'falls back',
        'base index',
        'gate',
        'incomplete',
        'only',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

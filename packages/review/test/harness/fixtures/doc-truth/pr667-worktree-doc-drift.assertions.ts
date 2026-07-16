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
 * Calibration status (2026-07-11, kimi-k2.7-code, --calibrate 10):
 * - 0/10 pre-signal (surface-widening branch). Not prompt assembly — traces
 *   showed doc-truth active and the claim rendered; the model spent its
 *   budget on the PR's real code bugs (buildOverlay mask-clear race,
 *   chunksCreated:0, manifest JSON.parse) and never engaged the doc claim.
 * - 2/10 with the <doc_claims> worklist. The signal verifiably engages:
 *   passing votes emit doc-truth findings verifying OTHER worklist entries
 *   (a JSDoc logger claim, a version-stamp claim) — but with 11 entries on a
 *   bug-rich PR the model samples a few claims and rarely reaches this one.
 *   Remaining gap is per-claim verification COST, not discovery: fixing it
 *   needs claim->code evidence pre-fetch (#729 stays open for that design).
 * - 5/10 with the DEDICATED doc-truth pass (#732/#733): the pass runs every
 *   vote, competition eliminated; residual = lenient equivalence ("has an
 *   index" judged consistent with the two-file gate ~50%).
 * - 7/10 after the strict-enumeration intro; 6/10 after adding budget
 *   discipline (statistically flat — plateau). Residuals: ~1 lenient vote +
 *   occasional evidence-ignoring read_file flood exhausting the pass budget.
 *   Model-judgment frontier on Kimi; further prompt iteration showed
 *   diminishing returns and was stopped per cost discipline.
 * Tagged `characterization` (not canary): this fixture measures the frontier
 * (~6-7/10), so the harness renders it as a non-gating `~` line and excludes it
 * from the exit code. The feature itself is certified on the canary corpus
 * (pr658 10/10, accurate-doc 10/10 precision with the strict language).
 *
 * KEYWORD-INTEGRITY SWEEP (2026-07-16): the Tier-2 list above was
 * bare-noun-heavy ('manifest', 'structural.db', 'resolveindexstrategy',
 * 'hasmanifest', 'hasdb', 'overlay', 'gate', 'requires', 'only', 'both' —
 * every one of them central vocabulary for this exact function) and
 * false-passed a hand-written distractor via assert-cli.ts: an unguarded
 * JSON.parse-crash finding about the SAME resolveIndexStrategy function,
 * naming the same identifiers, but never stating the doc understates a
 * two-condition gate as one. Tightened to compound phrases that state the
 * two-vs-one-condition contrast itself. The 6-7/10 measured rate above
 * PREDATES this tightening and almost certainly overstated the true rate —
 * the fixture's own frontier framing (a real, hard-to-close gap) is
 * unchanged, but the number itself needs a fresh measurement; no stored vote
 * traces exist in this worktree to offline re-score. The corpus
 * recalibration sweep should treat this fixture's rate as unknown, not 6-7/10,
 * until re-run.
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
    // Kept to compound phrases that state the TWO-VS-ONE-CONDITION contrast
    // itself — not bare 'manifest'/'structural.db'/'resolveindexstrategy'/
    // 'hasmanifest'/'hasdb'/'overlay'/'gate'/'requires'/'only'/'both', each
    // of which is central vocabulary for this whole function and would be
    // satisfied by an unrelated finding about a *different* bug in the same
    // resolveIndexStrategy (verified via assert-cli.ts: a distractor about
    // an unguarded JSON.parse crash on a corrupted manifest.json — a real,
    // different bug in the same function — false-passed the original list
    // purely via resolveindexstrategy/hasmanifest/hasdb/manifest.json/
    // falls back/gate, without ever stating the doc understates a
    // two-condition gate as one).
    h.expectFindingMentions(
      [
        'structural.db and manifest.json',
        'structural.db AND manifest.json',
        'has structural.db but no manifest.json',
        'structural.db but no manifest.json',
        'structural.db but not manifest.json',
        'without a manifest.json',
        'missing manifest.json',
        'omits manifest.json',
        'omit manifest.json',
        'only requires structural.db',
        'only checks structural.db',
        'only says structural.db',
        'says only structural.db',
        'second condition',
        'two conditions',
        'both conditions',
        'understates the gate',
        'narrower gate',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['characterization'],
};

export default assertions;

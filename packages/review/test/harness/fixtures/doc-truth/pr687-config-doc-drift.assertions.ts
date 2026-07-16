/**
 * Snapshot from PR #687 ("docs: overhaul agent-facing setup — CLAUDE.md,
 * skills, ADRs, contributor docs") captured at the planted-claim commit
 * headSha a26e480bd06f (base 11bdd1e98664). This PR ADDS
 * docs/architecture/decisions/0011-…md (ADR-011) and re-touches the retired-key
 * Note in docs/architecture/config-system.md — introducing a doc-vs-doc
 * inconsistency between the two, both in the same diff.
 *
 * Calibration status (2026-07-11, kimi-k2.7-code, --calibrate 10): 1/10
 * pre-signal, 1/10 with the <doc_claims> worklist. Omission-shaped claims
 * (the Note doesn't FALSELY state anything — it omits keys ADR-011 covers)
 * are the weakest doc-truth shape: verifying an omission means comparing
 * the claim against a DIFFERENT doc's enumeration, which the worklist
 * doesn't link. Needs claim->code/claim->doc evidence pre-fetch (#729).
 * Characterization fixture, not a canary.
 *
 * THE PLANTED CLAIM (touched prose, docs/architecture/config-system.md — the
 * "> **Note:**" that config-system.md links to ADR-011 from):
 *   "Existing configs that name a retired backend (`backend: "lancedb"` /
 *    "qdrant", or `qdrant.*` keys) do not crash: Lien warns once and uses the
 *    SQLite backend."
 * The Note enumerates the retired-key set as backend:lancedb / backend:qdrant /
 * qdrant.* — and OMITS the embeddings keys.
 *
 * WHY IT'S INCOMPLETE (contradicting prose in the SAME diff — the newly-added
 * ADR-011, docs/architecture/decisions/0011-…md):
 *   "Retired config values degrade gracefully — `backend: "lancedb"/"qdrant"`
 *    and the `embeddings.*`/`core.embeddingBatchSize` keys still load, warn
 *    once, and are dropped on the next config save; there is no crash path…"
 * ADR-011 documents `embeddings.*` and `core.embeddingBatchSize` as part of the
 * same graceful-degrade set. config-system.md's parallel Note — which links to
 * ADR-011 — lists only the backend/qdrant keys, so a user carrying `embeddings.*`
 * keys won't find them covered where the config system is actually documented.
 * The PR added the fuller ADR-011 list while leaving config-system.md's Note
 * describing the narrower set.
 *
 * WHAT A CORRECT FINDING MUST SAY: point out that config-system.md's retired-key
 * Note omits `embeddings.*`/`core.embeddingBatchSize`, which ADR-011 (linked
 * from that very Note, added in this same PR) documents as still-loading /
 * warn-once / dropped — so config-system.md's enumeration is incomplete and
 * inconsistent with the ADR it references.
 *
 * Capture command (fixture carries pr.headSha a26e480bd06f…, base 11bdd1e9…):
 *   npx tsx packages/review/test/harness/capture-pr.ts 687 \
 *     packages/review/test/harness/fixtures/doc-truth/pr687-config-doc-drift.fixture.json \
 *     --sha a26e480bd06f6503d0d1e0f0341c37c7173e8815
 *
 * Structural history: as first captured, BOTH sides of the contradiction were
 * truncated out of the rendered prompt (22-file PR; `.claude/skills/*` prose
 * exhausted the block budgets first). The smallest-hunk-first budget reorder
 * (#727) fixed that — the retired-key Note now renders in
 * <guidance_surface_changes> and its claim line appears in <doc_claims>
 * (verified via build-prompts.ts post-fix). What remains unreachable is
 * ADR-011's fuller enumeration (large hunk, still truncated), which is one
 * half of the omission comparison — hence the evidence-pre-fetch need above.
 * The assertion itself is well-formed (a hand-authored correct-finding verdict
 * passes assert-cli exit 0). Also the weakest contradiction on the merits: the
 * Note doesn't claim embeddings keys crash, it just omits them, so even fully
 * in-prompt a strict reviewer might read it as "accurate as far as it goes".
 * Tagged `characterization` (not canary): the harness renders it as a
 * non-gating `~` line and excludes it from the exit code.
 *
 * KEYWORD-INTEGRITY SWEEP (2026-07-16): the Tier-2 list was bare-noun-heavy
 * ('adr-011', 'config-system', 'retired', 'backend', 'qdrant', 'lancedb',
 * 'dropped', 'incomplete', 'missing' — all vocabulary for the general
 * retired-config-key topic this whole PR touches) and false-passed a
 * hand-written distractor via assert-cli.ts: a real, different documentation
 * gap (ADR-011 not specifying WHEN the config save is triggered) matched
 * every generic term without ever naming the omitted embeddings.* /
 * core.embeddingBatchSize keys. Tightened to those specific key identifiers
 * plus compound omission phrases. The 0/10 and 1/10 pre-signal numbers above
 * PREDATE this tightening; no stored vote traces exist in this worktree to
 * offline re-score — the upcoming corpus recalibration sweep re-measures it.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #687 a26e480 — config-system.md retired-key Note lists only backend:lancedb/qdrant + ' +
    'qdrant.* and omits `embeddings.*`/`core.embeddingBatchSize`, which the ADR-011 it links to ' +
    '(same PR) documents as still loading/warning/dropped',
  rule: 'doc-truth',
  expect: (result, h) => {
    h.expectRuleFired('doc-truth', result);
    // Kept to the specific omitted config-key identifiers and compound
    // omission phrases — not bare 'adr-011'/'config-system'/'retired'/
    // 'backend'/'qdrant'/'lancedb'/'dropped'/'incomplete'/'missing', each of
    // which describes the general retired-config-key topic this whole PR
    // touches and would be satisfied by an unrelated finding about a
    // *different* gap in the same docs (verified via assert-cli.ts: a
    // distractor about ADR-011 not specifying WHEN the config save is
    // triggered — a real, different documentation gap — false-passed the
    // original list via adr-011/backend/qdrant/dropped/incomplete, without
    // ever naming the omitted embeddings.*/core.embeddingBatchSize keys).
    h.expectFindingMentions(
      [
        'core.embeddingbatchsize',
        'embeddingbatchsize',
        'embeddings.* is missing',
        'embeddings.* is omitted',
        'omits embeddings.*',
        'omitting embeddings.*',
        'missing embeddings.*',
        'does not mention embeddings.*',
        "doesn't mention embeddings.*",
        'no mention of embeddings.*',
        'lists only backend',
        'only lists backend',
        'only mentions backend',
        'narrower than adr-011',
        'incomplete compared to adr-011',
        'adr-011 documents embeddings',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['characterization'],
};

export default assertions;

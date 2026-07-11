/**
 * Snapshot from PR #687 ("docs: overhaul agent-facing setup — CLAUDE.md,
 * skills, ADRs, contributor docs") captured at the planted-claim commit
 * headSha a26e480bd06f (base 11bdd1e98664). This PR ADDS
 * docs/architecture/decisions/0011-…md (ADR-011) and re-touches the retired-key
 * Note in docs/architecture/config-system.md — introducing a doc-vs-doc
 * inconsistency between the two, both in the same diff.
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
 * STRUCTURAL BLOCKER for real-Kimi calibration — VERIFIED via build-prompts.ts
 * on this fixture (2026-07-11), do NOT paper over: BOTH sides of the
 * contradiction are truncated out of the rendered prompt. This PR touches 22
 * files; the `.claude/skills/*` and `.cursor/rules/project.mdc` hunks sort
 * first and exhaust the char budgets of BOTH blocks — the <diff> block
 * truncates after `.cursor/rules/project.mdc` ("[Diff truncated — use read_file
 * …]") and <guidance_surface_changes> stops after
 * docs/architecture/claude-code-hook-channels.md. config-system.md's retired-key
 * Note never appears (grep for "Existing configs that name a retired backend"
 * in the prompt: 0 hits), and ADR-011's "embeddings.* / core.embeddingBatchSize
 * keys still load" line never appears (grep "embeddingBatchSize" / "still load":
 * 0 hits). An honest reviewer therefore has NO in-prompt signal that a
 * retired-key list even exists to cross-check, so the protocol-following verdict
 * is EMPTY and this fixture is effectively unfireable in replay as captured —
 * confirmed by assert-cli: an empty verdict fails Tier 1 here.
 *
 * The assertion below is nonetheless correct and well-formed (a hand-authored
 * "correct finding" verdict passes assert-cli exit 0), so the block is the
 * PROMPT-ASSEMBLY / capture, not the keywords. To make this fixture reachable,
 * fix upstream — e.g. have the guidance-surface passthrough prioritize
 * claim-bearing doc hunks (config-system.md, ADRs) over voluminous
 * `.claude/skills/*` prose, or re-capture a smaller/more-focused PR — rather
 * than loosening these assertions. Independent of that, this is also the
 * weakest contradiction on the merits: the Note doesn't claim embeddings keys
 * crash, it just omits them, so even fully in-prompt a strict reviewer might
 * read it as "accurate as far as it goes". Deliberately NOT tagged canary.
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
    h.expectFindingMentions(
      [
        // The omitted keys — the crux
        'embeddings.*',
        'embeddings',
        'core.embeddingbatchsize',
        'embeddingbatchsize',
        // The docs in tension
        'adr-011',
        'config-system',
        // The retired-key vocabulary both docs share
        'retired',
        'backend',
        'qdrant',
        'lancedb',
        'still load',
        'warn once',
        'dropped',
        'degrade',
        // How a correct finding frames the gap
        'omit',
        'incomplete',
        'inconsistent',
        'does not mention',
        'missing',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: [],
};

export default assertions;

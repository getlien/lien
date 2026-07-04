/**
 * Hand-authored fixture for the doc-truth rule — the falsified-claim case.
 *
 * Models the PR #658 miss on `packages/core/src/config/schema.ts`: a mechanical
 * rename (`semantic_search` → `search_code`) TOUCHES a doc comment whose
 * behavioral claim ("reports as disabled and returns no results" without
 * embeddings) is contradicted by the code visible in the same hunk —
 * `resolveSearchMode` falls back to lexical BM25 (active, returns results) when
 * `hasEmbeddings` is false. The contradiction is fully in-prompt (diff context),
 * so the case is verifiable in free/offline (CC-replay) mode without any
 * grep/read of a capture-time repo — which are blind in fixture replay.
 *
 * Tier 1: the doc-truth rule fires.
 * Tier 2: the finding names the contradiction (comment says "disabled" while the
 * code returns "lexical" / BM25). The keyword set is wide because a correct
 * rendering can lead with either the false claim or the true behavior.
 *
 * Real-PR calibration target: the captured PR #658 fixture landing on the
 * sibling branch `test/capture-pr658-fixture` is the fixture to run
 * `--calibrate 10` against on kimi before shipping (≥ 9/10). This hand-authored
 * fixture is the free CC-mode smoke test, NOT the calibration gate.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #658-style rename — schema.ts doc comment claims search "reports as disabled" ' +
    'without embeddings, but the code falls back to lexical BM25 (still active)',
  rule: 'doc-truth',
  expect: (result, h) => {
    h.expectRuleFired('doc-truth', result);
    h.expectFindingMentions(
      [
        // The true behavior the claim contradicts
        'lexical',
        'bm25',
        'fall back',
        'fallback',
        // The false claim being flagged
        'disabled',
        'reports as',
        'no results',
        // Framing a correct finding tends to use
        'resolvesearchmode',
        'stale',
        'contradict',
        'falsif',
        'still',
        'outdated',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['doc-truth', 'hand-authored'],
};

export default assertions;

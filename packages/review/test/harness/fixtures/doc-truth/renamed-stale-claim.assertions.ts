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
 *
 * KEYWORD-INTEGRITY SWEEP (2026-07-16): the Tier-2 list was bare-noun-heavy
 * ('lexical', 'bm25', 'fallback', 'disabled', 'still', 'outdated',
 * 'resolvesearchmode' — all generic to any stale-comment finding on this
 * same doc block) and false-passed a hand-written distractor via
 * assert-cli.ts: a finding about a *different* stale claim on the same
 * comment (config-level mode selection, not the disabled/no-results
 * framing) matched via lexical/fallback/resolvesearchmode/outdated/still.
 * Tightened to compound phrases that state the disabled-vs-still-active
 * contradiction itself. Not a calibration gate (hand-authored CC-mode smoke
 * fixture, no paid votes to re-score) — untagged/non-canary either way.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #658-style rename — schema.ts doc comment claims search "reports as disabled" ' +
    'without embeddings, but the code falls back to lexical BM25 (still active)',
  rule: 'doc-truth',
  expect: (result, h) => {
    h.expectRuleFired('doc-truth', result);
    // Kept to compound phrases that state the CONTRADICTION itself (the
    // "disabled" claim vs. the code still returning results) — not bare
    // 'lexical'/'bm25'/'fallback'/'disabled'/'still'/'outdated'/
    // 'resolvesearchmode', each of which a distractor about a *different*
    // stale claim on the same resolveSearchMode comment (e.g. a claim about
    // config-level mode SELECTION, not about the disabled/no-results
    // framing) also legitimately uses. Verified via assert-cli.ts: such a
    // distractor false-passed the original list via lexical/fallback/
    // resolvesearchmode/outdated/still and correctly fails against this one.
    h.expectFindingMentions(
      [
        'reports as disabled, but',
        'reports as disabled but',
        'claims disabled but',
        'disabled but returns',
        'disabled but falls back',
        'disabled but still',
        'contradicts the disabled claim',
        'the disabled claim is stale',
        'is not actually disabled',
        "isn't actually disabled",
        'no longer disabled',
        'search is not disabled',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['doc-truth', 'hand-authored'],
};

export default assertions;

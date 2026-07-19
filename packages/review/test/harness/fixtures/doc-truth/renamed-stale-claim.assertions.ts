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
 *
 * KEYWORD-INTEGRITY REPAIR (2026-07-19): the 2026-07-16 tightening traded one
 * brittleness for another. Its compound phrases required an EXACT contiguous
 * substring across a punctuation boundary — e.g. "reports as disabled, but"
 * needs a comma immediately after "disabled" with nothing between. Real model
 * output routinely wraps the quoted claim term in its own quote mark or
 * backtick right before that comma ("...reports as disabled', but
 * resolveSearchMode returns..." / "...reports as disabled\", but
 * `resolveSearchMode`..."), which breaks every phrase in the old list — a
 * correct, substantively-right finding false-FAILED on formatting alone
 * (measured 0/3 under both `LIEN_DOC_TRUTH_V2=on` and `=off`, see this
 * change's PR body; all 3 votes in each screen correctly identified the
 * contradiction, just phrased with a quote mark the phrase list didn't
 * anticipate).
 *
 * Repaired per the keyword-integrity discipline (see
 * pr658-search-code-rename.assertions.ts's claim+correction split, "single
 * finding must name both" pattern): instead of one contiguous phrase, require
 * the SAME finding to (a) mention the claim term "disabled" (bare word — safe
 * here because this fixture has exactly one claim, so "disabled" cannot
 * collide with an unrelated claim the way it could on a multi-claim fixture
 * like pr658), (b) name the specific function ("resolvesearchmode"), AND (c)
 * state the actual returned value via a punctuation-tolerant regex
 * (`/returns\s*[`'"]*lexical\b/i` — matches "returns 'lexical'", "returns
 * `'lexical'`", "returns lexical", any quote/backtick noise in between,
 * without caring which punctuation the model chose). All three together are
 * substantially harder to satisfy by accident than any one bare noun: the
 * 2026-07-16 sweep's distractor (discussing "config-level mode selection,"
 * not the disabled/no-results claim) does not state that resolveSearchMode
 * RETURNS lexical — it reasons about a different, invented override — so it
 * still fails condition (c). Verified via a reconstructed version of that
 * exact distractor in the offline smoke test below.
 */

import { HarnessAssertionError } from '../../assertions.js';
import type { FixtureAssertions } from '../../assertions.js';

/** Matches "returns 'lexical'", "returns `'lexical'`", "returns lexical" — any
 *  quote-mark/backtick punctuation between "returns" and "lexical", so the
 *  check survives whichever way a model chooses to quote the return value. */
const RETURNS_LEXICAL = /returns\s*[`'"]*\s*lexical\b/i;

const assertions: FixtureAssertions = {
  description:
    'PR #658-style rename — schema.ts doc comment claims search "reports as disabled" ' +
    'without embeddings, but the code falls back to lexical BM25 (still active)',
  rule: 'doc-truth',
  expect: (result, h) => {
    h.expectRuleFired('doc-truth', result);
    // Require ONE finding to name the claim ("disabled"), the specific function
    // ("resolvesearchmode"), AND the falsifying return value ("returns ...
    // lexical", punctuation-tolerant) — all three, in the SAME finding, rather
    // than an exact contiguous phrase. See header's KEYWORD-INTEGRITY REPAIR.
    const hasCorrectlyFramedContradiction = result.findings.some(f => {
      const haystack = [f.message, f.suggestion ?? '', f.evidence ?? ''].join('\n').toLowerCase();
      return (
        haystack.includes('disabled') &&
        haystack.includes('resolvesearchmode') &&
        RETURNS_LEXICAL.test(haystack)
      );
    });
    if (!hasCorrectlyFramedContradiction) {
      throw new HarnessAssertionError(
        'Tier 2: expected a single finding to name the claim ("disabled"), the function ' +
          '("resolveSearchMode"), and the falsifying return value (a "returns ... lexical" ' +
          `pattern, quote/backtick-tolerant) — none did. Findings: ${result.findings.length}.` +
          (result.findings.length > 0
            ? ` First message: "${result.findings[0]?.message?.slice(0, 200) ?? ''}"`
            : ''),
        2,
      );
    }
  },
  votes: 3,
  passThreshold: 9,
  tags: ['doc-truth', 'hand-authored'],
};

export default assertions;

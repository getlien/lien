/**
 * PR #509 — formatPercentChange uses (after - before) / before without
 * Math.abs on the denominator. For negative `before`, the sign flips:
 * percentChange(-100, -50) returns '-50%' even though the value improved.
 * Classic edge-case-sweep target (negative-input branch).
 *
 * Tier 2 (added 2026-07-11, authored from 13 observed Kimi votes —
 * moonshotai/kimi-k2.7-code, the prod default; 12 previously passed Tier 1,
 * 1 fired no edge-case-sweep finding). IMPORTANT judgment call recorded per
 * the harness's Tier-2-brittleness lesson: this fixture is NAMED after the
 * negative-`before` sign flip, but that specific finding appeared in only
 * 3/13 votes. The other 9 passing votes reported SIBLING edge-case bugs in
 * the SAME function — the zero-baseline branch returning an unsigned '∞'
 * for a decrease (formatPercentChange(0, -5) → '∞'), and non-finite inputs
 * (NaN / Infinity) silently falling through to '0%'. All three are real,
 * valid edge-case-sweep findings on formatPercentChange; the model just
 * doesn't reliably pick the same one. So this Tier 2 honestly pins "an
 * edge-case finding about formatPercentChange's handling of a boundary
 * input (negative baseline / zero baseline / NaN / Infinity) producing a
 * wrong sign or misleading output" — NOT the negative-`before` flip
 * specifically. Pinning the named flip alone would fail ~9/13 of the
 * model's own correct findings.
 *
 * Two expectFindingMentions calls => AND, each a wide any-of OR-list:
 *   (A) the function anchor — every finding is about `formatPercentChange`.
 *   (B) an edge-case symptom — a boundary input producing a wrong
 *       sign/direction or misleading output, or the recommended finite guard.
 *
 * Vocabulary evidence (12 passing votes, message/suggestion/evidence):
 *   - (A) every finding message begins "formatPercentChange(...)".
 *   - (B) the boundary inputs `NaN`, `Infinity`, `negative` baseline, and
 *     the zero-baseline branch (`before === 0`); symptoms "sign" / "inverts"
 *     / "+50%" / "-50%" / unsigned "∞" / silent "0%" / "misleading"; and the
 *     fix vocabulary "guard" / "isFinite" / "finite".
 *
 * Offline re-score (assert-cli.ts against all 13 saved vote results): 12/12
 * previously-passing votes still pass with these Tier-2 checks; the 1
 * previously-failing vote (emitted findings with ruleId null — the rule did
 * not fire) still fails at Tier 1, as expected. No widening was needed.
 * Certification against the >= 9/10 bar is pending a paid calibrate-10 (the
 * main session runs it).
 *
 * KEYWORD-INTEGRITY SWEEP (2026-07-16): gate (B) was bare-noun-heavy (bare
 * 'negative', 'sign', 'direction', 'guard', 'silently', 'misleading',
 * 'falls through') and false-passed a hand-written distractor via
 * assert-cli.ts: a pure string-formatting readability nit ("hard to
 * misplace the negative sign") matched via 'negative'+'sign' without
 * describing any actual wrong-output boundary case. Tightened to the
 * specific literal outputs/fix vocabulary and compound sign-flip/negative-
 * baseline phrases; re-verified both real sibling-bug shapes documented
 * above (the named sign-flip AND the zero-baseline/NaN/Infinity variant)
 * still pass. This canary's prior offline re-score PREDATES this
 * tightening — the upcoming corpus recalibration sweep re-measures it.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #509 — formatPercentChange sign-flip on negative before',
  rule: 'edge-case-sweep',
  expect: (result, h) => {
    h.expectRuleFired('edge-case-sweep', result);
    // (A) the function anchor.
    h.expectFindingMentions(
      ['formatpercentchange', 'percent change', 'percentage change', 'percentchange'],
      result,
    );
    // (B) an edge-case symptom on a boundary input (any of the sibling
    // bugs). Dropped bare 'negative'/'sign'/'direction'/'guard'/'silently'/
    // 'misleading'/'falls through' — a distractor about a pure
    // string-formatting readability nit ("hard to misplace the negative
    // sign") false-passed the original list via bare 'negative'+'sign',
    // never describing an actual wrong-output boundary case (verified via
    // assert-cli.ts).
    h.expectFindingMentions(
      [
        'nan',
        'infinity',
        'zero-baseline',
        'zero baseline',
        'before === 0',
        'negative baseline',
        'inverts',
        'inverted',
        'sign flip',
        'wrong sign',
        'flips the sign',
        '+50%',
        '-50%',
        '∞',
        '0%',
        'isfinite',
        'finite',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

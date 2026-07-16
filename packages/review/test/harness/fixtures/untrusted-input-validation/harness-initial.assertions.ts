/**
 * Snapshot from PR #541 at SHA 7cb0149 — the initial commit of the harness,
 * before CodeRabbit's review caught the multiple unvalidated-input bugs that
 * landed fixes in `637dd85`. The diff has at least three concrete instances
 * of the four sub-patterns this rule targets:
 *
 *   - assert-cli.ts:38     — cast-without-validate (`JSON.parse(raw) as Partial<HarnessResult>`)
 *   - fixture-loader.ts:46 — schema gap (FixtureShape missing complexityReport / baselineReport / deltas)
 *   - run.ts:48-49         — NaN-on-parse (`parseInt(argv[++i], 10)` for --votes / --calibrate)
 *
 * Capture command:
 *   npx tsx packages/review/test/harness/capture-pr.ts 541 \
 *     packages/review/test/harness/fixtures/untrusted-input-validation/harness-initial.fixture.json \
 *     --sha 7cb0149
 *
 * Tier 1: rule fires + a consumer-inspection tool is called. The rule prompt
 * mandates tracing the parsed value's consumers via "get_files_context (or
 * read_file)", so the gate accepts either — asserting get_files_context alone
 * failed correct Kimi runs purely on tool choice (7/10 on 2026-07-10; all 3
 * misses called read_file 8x with Tier-2-passing findings). The *discovery*
 * half is now deterministic: a pre-computed <untrusted_input_sites> worklist is
 * injected (see packages/review/src/untrusted-input-signals.ts), which hands the
 * agent the parse sites and counters the silence-bias 0-findings failure mode.
 * Tier 2: the finding mentions one of the four sub-pattern vocabulary
 * families. Set is wide because four sub-patterns can each render with
 * different language; any correct rendering of any one pattern will land.
 *
 * KEYWORD-INTEGRITY SWEEP (2026-07-16): the list included bare
 * 'validate'/'validation'/'schema'/'shape'/'untrusted'/'runtime'/
 * 'type-check'/'typeof'/'unguarded'/'unvalidated'/'cast' — generic enough
 * that a distractor about a FOURTH, undocumented site (voting.ts reading
 * `process.env.OPENROUTER_API_KEY` into a fetch header without validation —
 * a real but different untrusted-input gap, not one of the three sites this
 * fixture documents) false-passed via 'validation'/'runtime' alone
 * (verified via assert-cli.ts). Tightened to the specific function/symbol/
 * API names from the three documented sites; re-verified both the
 * loadResult-cast and parseInt-NaN variants still pass. This canary's prior
 * calibration PREDATES this tightening; no stored vote traces exist in this
 * worktree to offline re-score — the upcoming corpus recalibration sweep
 * re-measures it.
 *
 * 3-vote screen 2026-07-16 post-#787 state: 3/3 [SCREEN ONLY — calibrate-10
 * certification pending]. Earlier same-day pre-#787 screen (main@5fadbe1a):
 * 2/3 — one vote emitted corrupted verdict JSON ({": ":", "}) -> zero
 * findings; gone post-#787.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #541 7cb0149 — initial harness commit before CodeRabbit-fix landed; ' +
    'loadResult cast, narrow FixtureShape, parseInt-NaN',
  rule: 'untrusted-input-validation',
  expect: (result, h) => {
    h.expectRuleFired('untrusted-input-validation', result);
    h.expectAnyToolCalled(['get_files_context', 'read_file'], result);
    // Kept to the specific function/symbol/API names from the three
    // documented buggy sites — not bare 'validate'/'validation'/'schema'/
    // 'shape'/'untrusted'/'runtime'/'type-check'/'typeof'/'unguarded'/
    // 'unvalidated'/'cast', each generic enough that an unrelated
    // input-validation finding about a DIFFERENT harness file also
    // satisfies (verified via assert-cli.ts: a distractor about voting.ts
    // reading OPENROUTER_API_KEY without validation — a real, different
    // untrusted-input gap, not one of the three documented sites — matched
    // via 'validation'/'runtime' alone).
    h.expectFindingMentions(
      [
        'loadresult',
        'fixtureshape',
        'parseflags',
        'json.parse',
        'parseint',
        'as partial',
        'as harnessresult',
        'number.isinteger',
        'isfinite',
        'array.isarray',
        'nan',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

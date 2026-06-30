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
 * Tier 1: rule fires + get_files_context is called (the rule still mandates
 * inspecting consumers of the parsed value — get_files_context reads in-memory
 * repoChunks, so unlike grep/read it is NOT blind in replay). The *discovery*
 * half is now deterministic: a pre-computed <untrusted_input_sites> worklist is
 * injected (see packages/review/src/untrusted-input-signals.ts), which hands the
 * agent the parse sites and counters the silence-bias 0-findings failure mode.
 * Tier 2: the finding mentions one of the four sub-pattern vocabulary
 * families. Set is wide because four sub-patterns can each render with
 * different language; any correct rendering of any one pattern will land.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #541 7cb0149 — initial harness commit before CodeRabbit-fix landed; ' +
    'loadResult cast, narrow FixtureShape, parseInt-NaN',
  rule: 'untrusted-input-validation',
  expect: (result, h) => {
    h.expectRuleFired('untrusted-input-validation', result);
    h.expectToolCalled('get_files_context', result);
    h.expectFindingMentions(
      [
        // Function/symbol names from the buggy code
        'loadresult',
        'fixtureshape',
        'parseflags',
        // Vocabulary the model reaches for across the four sub-patterns
        'json.parse',
        'parseint',
        'cast',
        'as partial',
        'as harnessresult',
        'validate',
        'validation',
        'schema',
        'shape',
        'nan',
        'number.isinteger',
        'isfinite',
        'untrusted',
        'runtime',
        'type-check',
        'typeof',
        'unguarded',
        'unvalidated',
        'array.isarray',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

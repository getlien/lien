/**
 * Cross-repo pilot fixture — mined from pallets/werkzeug (Python), not the lien
 * monorepo. Captures the OFFENDING PR (the one that introduced the bug);
 * ground truth below comes from the later FIX PR.
 *
 * OFFENDING PR: pallets/werkzeug #2678 "Fix the parsing of large multipart
 * bodies" — merged 2023-05-01, head f0a1733f52a7241f51cc519593233e8be6aeaa0e,
 * released in werkzeug 2.3.3.
 *
 * FIX: pallets/werkzeug #2763 "Fix multipart parsing when additional newlines
 * are present" — merged 2023-08-12 (~3 months later), head
 * db32625cf7498267a918a356021fb228f7ce2588, released in werkzeug 2.3.7.
 * CHANGES.rst (2.3.7): "Fix parsing of multipart bodies. Adjust index of
 * last newline in data start. :issue:`2761`". Issue #2761 "Extra Newline
 * Added to Binary File Upload" reports a spurious leading newline appearing
 * in uploaded binary files larger than 64KB (i.e. spanning multiple socket
 * reads).
 *
 * THE BUG: werkzeug/sansio/multipart.py's `MultipartDecoder._parse_data`
 * computes where a body part's data ends by calling
 * `self.last_newline(data[data_start:])`. That method returns an index
 * RELATIVE to the sliced buffer `data[data_start:]` — but PR #2678 assigns
 * the return value directly to `data_end`/`del_index`, which are then used
 * as ABSOLUTE indices into the UNSLICED `data` buffer
 * (`data[data_start:data_end]`), at BOTH call sites in `_parse_data`.
 * Whenever `data_start > 0` (the part's data begins with a leading CR/LF
 * that was stripped first — exactly what happens when a part's payload is
 * split across multiple `receive_data` calls, as with large uploads), the
 * returned index is `data_start` positions too small, so `data_end`
 * under-shoots. Slicing with the under-shot `data_end` truncates the
 * returned data short; the skipped bytes (which include a real newline)
 * are left to be re-parsed and reappear as the START of the NEXT emitted
 * chunk — manifesting as an extra newline prepended to the file content.
 *
 * WHAT A CORRECT FINDING MUST SAY: flag that `self.last_newline(data[data_start:])`
 * returns an index relative to the slice `data[data_start:]`, but is used
 * directly as `data_end`/`del_index` — an absolute index into the full
 * (unsliced) `data` buffer — without adding back `data_start`. Both
 * occurrences in `_parse_data` (werkzeug/sansio/multipart.py) share the bug.
 * Concretely: when `data_start > 0`, the computed `data_end` is too small by
 * `data_start`, so returned data is truncated short and the skipped bytes
 * resurface at the start of subsequently parsed data.
 *
 * Capture command (run from inside the werkzeug clone):
 *   tsx packages/review/test/harness/capture-pr.ts 2678 \
 *     .wip/crossrepo-pilot/fixtures/werkzeug/pr2678-multipart-index-offset.fixture.json
 *
 * Rule-trigger note: build-prompts.ts activates ['structural-analysis',
 * 'edge-case-sweep', 'error-swallowing', 'boundary-change', 'stale-duplicate']
 * for this fixture (2 changed files: CHANGES.rst, multipart.py — diff renders
 * in full, no truncation). 'edge-case-sweep' is the semantically ideal rule:
 * its prompt directs mentally executing changed functions with "zero" and
 * "boundary" inputs, and `data_start == 0` vs `data_start > 0` is exactly the
 * boundary case this diff mishandles.
 */

/*
 * PROMOTED TO CROSS-REPO CANARY (2026-07-16): external fixture from
 * pallets/werkzeug PR #2678, mined in the cross-repo validation study's Python
 * round (2026-07-12). Blind-screen + Kimi 3-vote evidence in the pilot log;
 * canary certification: --calibrate 10 run recorded below.
 *
 * REGENERATE (fixture JSON is gitignored):
 *   git clone https://github.com/pallets/werkzeug /tmp/werkzeug && cd /tmp/werkzeug
 *   git fetch origin pull/2678/head:pr-2678-head
 *   npx tsx <lien>/packages/review/test/harness/capture-pr.ts 2678 \
 *     <lien>/packages/review/test/harness/fixtures/crossrepo/pr2678-multipart-index-offset.fixture.json
 * (capture-pr.ts retargets to whatever repo the cwd is in.)
 *
 * CALIBRATION (kimi-k2.7-code): CERTIFIED 10/10 (2026-07-16, prod default
 * model moonshotai/kimi-k2.7-code, no --model override, cost $0.6662) —
 * `--calibrate 10` run against `--fixture` in isolation. Prior evidence: 3/3
 * Kimi votes + blind-CC content catch (2026-07-12 Python round). NOTE: this
 * cert reflects the prompt as of 2026-07-16 (post #757 test-coverage block,
 * post #770 catch signal) — later than the 2026-07-12 cross-repo validation
 * study that mined this fixture.
 *
 * DOGFOOD (2026-07-16): a post-cert assert-cli smoke test (perfect / empty /
 * distractor verdicts, see harness README) found the original keyword list's
 * '// The domain' entries ('multipart', 'boundary') were bare nouns that a
 * plausible off-topic distractor about this same file (a max_form_memory_size
 * accounting gap, not the data_start slice-offset bug) also satisfied —
 * false Tier-2 pass. Sibling fixture pr2017 (same file) had the same class
 * of bug and its raw calibration score DID move (10/10 -> 8/10 corrected).
 * For pr2678, re-scoring all 10 stored vote traces from the run above
 * against a keyword list with the domain nouns removed (mechanism + symptom
 * phrases only, below) still holds 10/10 — every real vote independently
 * named data_start/last_newline/data_end/del_index, so the cert stands, but
 * the keyword list below is the corrected/tightened one, not the raw one the
 * --calibrate 10 run above technically scored against.
 */
import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'werkzeug PR #2678 (fixed by #2763) — MultipartDecoder._parse_data (werkzeug/sansio/multipart.py) ' +
    'uses self.last_newline(data[data_start:]), an index relative to the sliced buffer, directly as an ' +
    'absolute index (data_end/del_index) into the unsliced data buffer, truncating parsed data short ' +
    'whenever data_start > 0 and leaking a spurious newline into the next chunk',
  rule: 'edge-case-sweep',
  ruleCandidates: ['edge-case-sweep', 'structural-analysis', 'boundary-change'],
  expect: (result, h) => {
    const ruleCandidates = ['edge-case-sweep', 'structural-analysis', 'boundary-change'];
    if (!result.findings.some(f => f.ruleId && ruleCandidates.includes(f.ruleId))) {
      h.expectRuleFired(ruleCandidates[0], result);
    }
    h.expectFindingMentions(
      [
        // The mechanism
        'data_start',
        'last_newline',
        'data_end',
        'del_index',
        'relative index',
        'relative to',
        'absolute index',
        'off-by',
        'offset',
        'slice',
        'sliced',
        '+ data_start',
        // The symptom
        'extra newline',
        'spurious newline',
        'truncat',
        'newline',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary', 'crossrepo', 'python'],
};

export default assertions;

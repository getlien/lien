/**
 * Cross-repo pilot fixture — mined from pallets/werkzeug (Python), not the lien
 * monorepo. Captures the OFFENDING PR (the one that introduced the bug);
 * ground truth below comes from the later FIX PR.
 *
 * OFFENDING PR: pallets/werkzeug #2017 "Refactor the Multipart parsing into a
 * Sans-IO layer" — merged 2021-01-26, head
 * 76bb39a32f4be455feef765ea05d7acc9b6b25ad, released in werkzeug 2.0.0.
 * Extracts multipart body parsing into a new sans-IO `MultipartDecoder`
 * class (~1050 lines across ~10 files).
 *
 * FIX: pallets/werkzeug #2126 "Multipart fix" — merged 2021-05-14 (~4 months
 * later), head 3f8a95fb275dcad27d541f00026b229636e1a485, released in
 * werkzeug 2.0.1. CHANGES.rst (2.0.1): "Fix multipart parsing bug when
 * boundary contains special regex characters. :issue:`2125`". Issue #2125's
 * own title and body name the regression explicitly: "[BUG] Multipart data
 * parse regression" — "Seems that there is a regression in the new
 * MultiPartPaser implementation... does not work in Werkzeug==2.0.0; but,
 * works in Werkzeug<2.0.0", with a repro using boundary
 * `----------a_BoUnDaRy9009049739267083$` (trailing `$`, a regex
 * end-of-string anchor).
 *
 * THE BUG: `MultipartDecoder.__init__` (werkzeug/sansio/multipart.py)
 * compiles two regexes, `preamble_re` and `boundary_re`, by interpolating
 * the caller-supplied multipart `boundary` bytes directly into a
 * `%`-formatted pattern:
 *   br"%s?--%s(--[^\S\n\r]*%s?|[^\S\n\r]*%s)" % (LINE_BREAK, boundary, LINE_BREAK, LINE_BREAK)
 * The multipart boundary value is chosen by the CLIENT — RFC 2046's `bchars`
 * charset for boundaries legally includes characters that are regex
 * metacharacters (`.`, `+`, `-`, `(`, `)`, `?`, `$`, etc.) — and is never
 * passed through `re.escape()` before being spliced into the pattern. Any
 * boundary containing such a character is silently reinterpreted as regex
 * syntax instead of matched literally, so the compiled pattern no longer
 * matches the real boundary bytes in the request body, breaking multipart
 * parsing for that request. Both `preamble_re` and `boundary_re` have the
 * identical bug (same missing escape, same call pattern).
 *
 * WHAT A CORRECT FINDING MUST SAY: flag that `boundary` is spliced into the
 * `preamble_re`/`boundary_re` patterns via `%`-formatting without
 * `re.escape(boundary)` first, so any client-supplied multipart boundary
 * containing a regex metacharacter (`.`, `+`, `*`, `(`, `)`, `$`, `[`, `\`,
 * etc. — all legal per RFC 2046) is misinterpreted as regex syntax rather
 * than matched literally, breaking parsing of that request's body. File:
 * werkzeug/sansio/multipart.py, `MultipartDecoder.__init__`.
 *
 * Capture command (run from inside the werkzeug clone):
 *   tsx packages/review/test/harness/capture-pr.ts 2017 \
 *     .wip/crossrepo-pilot/fixtures/werkzeug/pr2017-multipart-boundary-regex.fixture.json
 *
 * Rule-trigger note: build-prompts.ts activates ['structural-analysis',
 * 'edge-case-sweep', 'error-swallowing', 'boundary-change', 'stale-duplicate',
 * 'doc-truth'] for this fixture (11 changed files; the buggy hunk in
 * sansio/multipart.py renders well before the initial message's end — no
 * truncation). 'edge-case-sweep' is the semantically ideal rule: its prompt
 * directs mentally executing changed functions with unusual/boundary inputs,
 * and a boundary value containing regex metacharacters is exactly such an
 * adversarial edge-case input.
 */

/*
 * CROSS-REPO CHARACTERIZATION (updated 2026-07-16): external fixture from
 * pallets/werkzeug PR #2017, mined in the cross-repo validation study's Python
 * round. Blind-screen + Kimi 3-vote evidence in the pilot log.
 *
 * REGENERATE (fixture JSON is gitignored):
 *   git clone https://github.com/pallets/werkzeug /tmp/werkzeug && cd /tmp/werkzeug
 *   git fetch origin pull/2017/head:pr-2017-head
 *   npx tsx <lien>/packages/review/test/harness/capture-pr.ts 2017 \
 *     <lien>/packages/review/test/harness/fixtures/crossrepo/pr2017-multipart-boundary-regex.fixture.json
 * (capture-pr.ts retargets to whatever repo the cwd is in.)
 *
 * CALIBRATION (kimi-k2.7-code): measured 8/10, BELOW the >=9/10 canary bar —
 * NOT promoted. `--calibrate 10` run 2026-07-16 against `--fixture` in
 * isolation, prod default model moonshotai/kimi-k2.7-code (no --model
 * override), cost $0.8681. NOTE: this measurement reflects the prompt as of
 * 2026-07-16 (post #757 test-coverage block, post #770 catch signal) — later
 * than the 2026-07-12 cross-repo validation study that mined this fixture.
 *
 * RAW vs CORRECTED: the raw --calibrate 10 run scored 10/10 against the
 * keyword list as it stood before this pass (which included the identifiers
 * 'preamble_re'/'boundary_re'/'multipartdecoder' and the bare domain nouns
 * 'boundary'/'multipart'). A dogfood assert-cli smoke test (perfect / empty
 * / distractor verdicts, see harness README) caught that a plausible
 * off-topic distractor about this same file/class — a finding about
 * recompiling preamble_re/boundary_re on every request being wasteful, NOT
 * about the missing re.escape() — still passed Tier 2, because 'boundary_re'
 * and 'boundary'/'multipart' are near-unavoidable vocabulary for ANY finding
 * about this file. Re-scoring the 10 stored vote traces from this run
 * against a keyword list restricted to the escaping-specific mechanism
 * phrases (re.escape, unescaped, regex metacharacter, etc.) drops the score
 * to 8/10: votes 5 and 9 (see
 * .wip/traces/2026-07-15T23-07-44Z-pr2017-multipart-boundary-regex/crossrepo/pr2017-multipart-boundary-regex/vote-5.json
 * and .../vote-9.json) each reported OTHER genuine werkzeug 2.0.0 issues
 * (an empty-part/boundary_re edge case, and a max_form_memory_size /
 * _fix_ie_filename regression) but never mentioned the escaping bug at all —
 * they were false Tier-2 passes, not real catches. The keyword list below is
 * the corrected one (identifiers/domain nouns removed); this fixture's
 * measured rate is the corrected 8/10, not the raw 10/10. Per the harness's
 * own reliability-bar standard, an unexpected miss pattern uncovered while
 * certifying is data for the owner, not something to paper over — do not
 * re-inflate this back to canary without a fresh >=9/10 run against THIS
 * keyword list.
 */
import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'werkzeug PR #2017 (fixed by #2126) — MultipartDecoder.__init__ (werkzeug/sansio/multipart.py) ' +
    'splices the client-supplied multipart boundary directly into preamble_re/boundary_re via ' +
    '%-formatting without re.escape(), so a boundary containing a regex metacharacter (e.g. trailing ' +
    '$, or ., +, (, )) is misinterpreted as regex syntax and breaks parsing of that request',
  rule: 'edge-case-sweep',
  ruleCandidates: ['edge-case-sweep', 'structural-analysis'],
  expect: (result, h) => {
    const ruleCandidates = ['edge-case-sweep', 'structural-analysis'];
    if (!result.findings.some(f => f.ruleId && ruleCandidates.includes(f.ruleId))) {
      h.expectRuleFired(ruleCandidates[0], result);
    }
    h.expectFindingMentions(
      [
        // The mechanism
        're.escape',
        'escape(boundary)',
        'regex metacharacter',
        'special regex character',
        'special character',
        'unescaped',
        'not escaped',
        'without escaping',
        'metacharacter',
        'regex injection',
        'interpolat',
        'literal',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['characterization', 'crossrepo', 'python'],
};

export default assertions;

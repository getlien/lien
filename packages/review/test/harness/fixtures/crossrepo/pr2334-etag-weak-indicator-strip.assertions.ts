/**
 * Cross-repo pilot fixture — mined from encode/starlette (Python), not the
 * lien monorepo. Captures the OFFENDING PR (the one that introduced the
 * bug); ground truth below comes from the later FIX PR.
 *
 * OFFENDING PR: encode/starlette #2334 "Take weak ETags in consideration on
 * `StaticFiles`" — merged 2023-12-16, head 3c8ab8e74a8c773624d6149d8c04cf5a09d4f1c4,
 * released in starlette 0.34.0. `starlette/staticfiles.py`'s `is_not_modified()`
 * changed:
 *   - if if_none_match == etag:
 *   + if etag in [tag.strip(" W/") for tag in if_none_match.split(",")]:
 * intending to make If-None-Match matching tolerant of the weak-ETag `W/`
 * prefix (and multiple comma-separated tags) per RFC 7232.
 *
 * THE BUG: `str.strip(chars)` treats its argument as a *character set*, not
 * a literal prefix/suffix. `tag.strip(" W/")` strips any combination of the
 * three characters `' '`, `'W'`, `'/'` from BOTH ends of the string — it
 * does not remove "the substring `W/`". For the common case (a quoted hex
 * ETag like `W/"abcd1234"`) this happens to look right, because stripping
 * halts at the closing `"`, which isn't in the set — but the moment an ETag
 * or client-sent If-None-Match value ends or begins with a bare `W`, `/`, or
 * space *outside* the quotes (or is passed unquoted), `.strip(" W/")`
 * over-trims it, producing a comparison against a mangled tag: legitimate
 * matches can be missed (no 304 when one is due) or, in principle, two
 * different tags can collapse to the same stripped value (an incorrect
 * 304). The code's own intent — "strip the leading `W/` weak indicator" —
 * is not what `.strip()` does; the fix (starlette #3193, ~2.5 years later)
 * replaces it with `tag.strip().removeprefix("W/")`, which strips
 * whitespace first and then removes the literal `W/` prefix only.
 *
 * FIX: encode/starlette #3193 "Use `removeprefix` to strip weak ETag
 * indicator in `is_not_modified`" — merged 2026-06-10, head
 * 37309255b4c1b9c381a2d24a1eaf83100984a16a, released in starlette 1.3.1.
 * PR body: "`strip()` works on a character set — it strips any combination
 * of `' '`, `'W'`, and `'/'` from both ends of the string. This means an
 * ETag value ending in `W` or `/` would get incorrectly trimmed... the fix
 * makes the code do what it actually intends to do."
 *
 * WHAT A CORRECT FINDING MUST SAY: `tag.strip(" W/")` in
 * `is_not_modified()` (starlette/staticfiles.py, ~line 228) uses `str.strip`
 * with a character-set argument to remove the weak-ETag `W/` prefix, but
 * `strip()` removes characters from a set, not a literal prefix — any tag
 * value ending (or beginning) with `'W'`, `'/'`, or a space gets
 * over-trimmed, so the intended "ignore the weak indicator" comparison can
 * silently mismatch/mismatch-collide instead of comparing the real tag
 * value.
 *
 * Capture command (run from inside the starlette clone):
 *   tsx packages/review/test/harness/capture-pr.ts 2334 \
 *     .wip/crossrepo-pilot/fixtures/starlette/pr2334-etag-weak-indicator-strip.fixture.json
 *
 * Rule-trigger note: build-prompts.ts activates ['structural-analysis',
 * 'edge-case-sweep', 'error-swallowing', 'boundary-change', 'stale-duplicate']
 * for this fixture; 'concurrency-race', 'incomplete-handling',
 * 'untrusted-input-validation', and 'doc-truth' are skipped. Unlike most
 * string-method fixtures, 'boundary-change' is ACTIVE here (not
 * trigger-blocked) — the diff visibly changes an equality comparison
 * (`if_none_match == etag`) into a different comparison shape, which is
 * enough to trip its trigger keywords even though the actual bug is a
 * string-method misuse, not a numeric threshold. 'edge-case-sweep' is the
 * best semantic fit (mentally executing the strip against a tag ending in
 * `W`/`/` is exactly this bug).
 */

/*
 * PROMOTED TO CROSS-REPO CANARY (2026-07-12): external fixture from
 * encode/starlette PR #2334, mined in the cross-repo validation study's Python
 * round. Blind-screen + Kimi 3-vote evidence in the pilot log; canary
 * certification: --calibrate 10 run recorded below.
 *
 * REGENERATE (fixture JSON is gitignored):
 *   git clone https://github.com/encode/starlette /tmp/starlette && cd /tmp/starlette
 *   git fetch origin pull/2334/head:pr-2334-head
 *   npx tsx <lien>/packages/review/test/harness/capture-pr.ts 2334 \
 *     <lien>/packages/review/test/harness/fixtures/crossrepo/pr2334-etag-weak-indicator-strip.fixture.json
 * (capture-pr.ts retargets to whatever repo the cwd is in.)
 *
 * CALIBRATION (kimi-k2.7-code): --calibrate 10 on 2026-07-12 measured
 * 5/10 (5 tier-1 no-finding misses, 0 tier-2) — BAR NOT MET, tagged
 * characterization (non-gating). The earlier 3/3 screen was sampling
 * luck. Failure mode matches the "engaged-and-rationalized" shape:
 * whether .strip(" W/") can over-strip here requires arguing about the
 * ETag alphabet (self-generated MD5 hex never contains W/space, quotes
 * bound the tag), so ~half of votes judge it safe-in-context — the
 * same call the blind Sonnet reviewer made. A borderline-judgment
 * fixture, not a prompt-iteration target; do not spend calibration
 * budget pushing it green (see the judgment guide).
 */
import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'starlette PR #2334 (fixed 2.5 years later by #3193) — is_not_modified() uses ' +
    'tag.strip(" W/") to remove the weak-ETag prefix, but str.strip treats its argument ' +
    'as a character set, not a literal prefix, so tags ending in W, /, or space get ' +
    'over-trimmed instead of just having the W/ prefix removed',
  rule: 'edge-case-sweep',
  ruleCandidates: ['edge-case-sweep', 'boundary-change', 'structural-analysis'],
  expect: (result, h) => {
    const ruleCandidates = ['edge-case-sweep', 'boundary-change', 'structural-analysis'];
    if (!result.findings.some(f => f.ruleId && ruleCandidates.includes(f.ruleId))) {
      h.expectRuleFired(ruleCandidates[0], result);
    }
    h.expectFindingMentions(
      [
        // The mechanism
        'strip(" w/")',
        "strip(' w/')",
        'str.strip',
        '.strip(',
        'character set',
        'character class',
        'charset',
        'not a prefix',
        'not a literal',
        'literal prefix',
        'removeprefix',
        // The domain — kept to compound phrases naming the WEAK-INDICATOR
        // mechanism specifically, not bare 'etag'/'if-none-match'/
        // 'is_not_modified', which a distractor finding about a *different*
        // bug in the same function (stale mtime-based etag, swallowed
        // KeyError, etc.) could also legitimately use
        'weak etag',
        'weak indicator',
        'w/ prefix',
        'w/" prefix',
        // How a correct finding frames the gap
        'over-trim',
        'over trim',
        'overtrim',
        'strips too much',
        'unintended characters',
        'trailing w',
        'trailing slash',
        'ends in w',
        'ends with w',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['characterization', 'crossrepo', 'python'],
};

export default assertions;

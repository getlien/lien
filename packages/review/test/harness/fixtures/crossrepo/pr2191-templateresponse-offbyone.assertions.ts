/**
 * Cross-repo pilot fixture — mined from encode/starlette (Python), not the
 * lien monorepo. Captures the OFFENDING PR (the one that introduced the
 * bug); ground truth below comes from the later FIX PR.
 *
 * OFFENDING PR: encode/starlette #2191 "Add `request` argument to
 * `TemplateResponse`" — merged 2023-07-13, head
 * 030868188328165c78010e7dc4e22b2afa32882c, released in starlette 0.28.0.
 * Rewrote `Jinja2Templates.TemplateResponse()` to accept both the old
 * positional signature `(name, context, status_code, headers, media_type,
 * background)` and the new one prefixed with `request`, dispatching on
 * `args[0]`'s type. Both branches unpack trailing positional args by index:
 *
 *   old-style (7 total params incl. name, so headers should be args[3]):
 *     status_code = args[2] if len(args) > 2 else kwargs.get("status_code", 200)
 *     headers     = args[2] if len(args) > 2 else kwargs.get("headers")
 *     media_type  = args[3] if len(args) > 3 else kwargs.get("media_type")
 *     background  = args[4] if len(args) > 4 else kwargs.get("background")
 *
 * THE BUG: `headers`, `media_type`, and `background` reuse the SAME index
 * as `status_code`/`headers`/`media_type` respectively instead of the next
 * one — `headers` is read from `args[2]` (the `status_code` slot) instead
 * of `args[3]`, `media_type` from `args[3]` (the `headers` slot) instead of
 * `args[4]`, and `background` from `args[4]` (the `media_type` slot)
 * instead of `args[5]`. Calling the old-style
 * `TemplateResponse(name, context, status_code, headers, media_type,
 * background)` with 4+ positional args therefore assigns the WRONG value
 * to each of `headers`/`media_type`/`background` — e.g. passing a real
 * `headers` dict positionally makes `headers` actually receive the
 * `status_code` int, and the true headers dict silently lands in
 * `media_type` instead. (The new-style branch, one index further right
 * because of the added `request` slot, has the same off-by-one shape:
 * `headers = args[4]` reads the `status_code` slot, `media_type =
 * args[5]` reads the `headers` slot, etc.) With 4+ positional args this
 * silently scrambles which value ends up in which parameter; with exactly
 * 3 or fewer positional args plus keyword args it instead raises
 * `IndexError` for the keyword path, matching the closed issue title.
 *
 * FIX: encode/starlette #2909 "fix IndexError in TemplateResponse" —
 * merged 2025-03-16, head bcdf0ad017168408060b6faab156636ced4c94f7, fixes
 * issue #2906. Shifts each old-style index up by one:
 *   headers = args[2] -> args[3]; media_type = args[3] -> args[4];
 *   background = args[4] -> args[5]. Gap between offending PR and fix:
 *   ~1.7 years.
 *
 * WHAT A CORRECT FINDING MUST SAY: in the old-style branch of
 * `TemplateResponse()` (starlette/templating.py, ~line 168-171), `headers`,
 * `media_type`, and `background` each read the wrong positional index —
 * `headers = args[2]` collides with the `status_code` slot instead of
 * using `args[3]`, and `media_type`/`background` are each off by one in
 * the same way — so calling the old (deprecated but still-supported)
 * positional signature with more than 3 positional arguments assigns each
 * of those parameters the value meant for the PRECEDING one, silently
 * scrambling `status_code`/`headers`/`media_type`/`background`.
 *
 * Capture command (run from inside the starlette clone):
 *   tsx packages/review/test/harness/capture-pr.ts 2191 \
 *     .wip/crossrepo-pilot/fixtures/starlette/pr2191-templateresponse-offbyone.fixture.json
 *
 * Rule-trigger note: build-prompts.ts activates ['structural-analysis',
 * 'edge-case-sweep', 'boundary-change', 'stale-duplicate', 'doc-truth'] for
 * this fixture; 'concurrency-race', 'incomplete-handling',
 * 'error-swallowing', and 'untrusted-input-validation' are skipped.
 * Unlike the other two starlette fixtures in this batch, 'boundary-change'
 * IS active here (not trigger-blocked) — the diff is literally adjacent
 * integer-index arithmetic (`args[2]`/`args[3]`/`args[4]`), which trips its
 * numeric-threshold-shift trigger keywords even though the bug is an
 * off-by-one index collision rather than a comparison operator. This is
 * the best rule-fit of the three starlette fixtures in this batch.
 */

/*
 * PROMOTED TO CROSS-REPO CANARY (2026-07-12): external fixture from
 * encode/starlette PR #2191, mined in the cross-repo validation study's Python
 * round. Blind-screen + Kimi 3-vote evidence in the pilot log; canary
 * certification: --calibrate 10 run recorded below.
 *
 * REGENERATE (fixture JSON is gitignored):
 *   git clone https://github.com/encode/starlette /tmp/starlette && cd /tmp/starlette
 *   git fetch origin pull/2191/head:pr-2191-head
 *   npx tsx <lien>/packages/review/test/harness/capture-pr.ts 2191 \
 *     <lien>/packages/review/test/harness/fixtures/crossrepo/pr2191-templateresponse-offbyone.fixture.json
 * (capture-pr.ts retargets to whatever repo the cwd is in.)
 *
 * CALIBRATION (kimi-k2.7-code): CERTIFIED 2026-07-12 — --calibrate 10
 * scored 10/10 ($0.39). Prior evidence: 3/3 Kimi screen + blind-CC
 * catch (2026-07 Python round).
 */
import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    "starlette PR #2191 (fixed 1.7 years later by #2909) — TemplateResponse's old-style " +
    'positional-arg branch reads headers/media_type/background from args[2]/args[3]/args[4] ' +
    "(each one index too low, colliding with the preceding parameter's slot) instead of " +
    'args[3]/args[4]/args[5], silently scrambling which value lands in which parameter',
  rule: 'boundary-change',
  ruleCandidates: ['boundary-change', 'edge-case-sweep', 'structural-analysis'],
  expect: (result, h) => {
    const ruleCandidates = ['boundary-change', 'edge-case-sweep', 'structural-analysis'];
    if (!result.findings.some(f => f.ruleId && ruleCandidates.includes(f.ruleId))) {
      h.expectRuleFired(ruleCandidates[0], result);
    }
    h.expectFindingMentions(
      [
        // The mechanism
        'args[2]',
        'args[3]',
        'args[4]',
        'off-by-one',
        'off by one',
        'wrong index',
        'incorrect index',
        'index shift',
        'shifted by one',
        'wrong slot',
        'same index',
        'collide',
        'collision',
        // The domain — combined with index/positional-arg language so a
        // finding must be about the ARGUMENT PLUMBING, not just anything
        // touching this function (e.g. a test-cleanup nit that happens to
        // say "TemplateResponse" would not match any of these)
        'positional argument',
        'positional arg',
        'headers slot',
        'status_code slot',
        'args tuple',
        // How a correct finding frames the gap
        'scramble',
        'scrambled',
        'wrong value',
        'wrong parameter',
        'silently assign',
        'misassign',
        'misassigned',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary', 'crossrepo', 'python'],
};

export default assertions;

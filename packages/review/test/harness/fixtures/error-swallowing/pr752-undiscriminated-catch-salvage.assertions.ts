/**
 * DOCUMENTED-MISS fixture — real bug, real miss, not yet reliably caught.
 * Tagged `characterization` (expected-miss), NOT `canary`. Do not spend
 * calibration budget pushing this green; it exists to mark a frontier and
 * be ready the moment someone iterates on `error-swallowing`'s prompt.
 *
 * PROVENANCE: getlien/lien PR #752 "fix(review): stop silently dropping
 * inline comments when batch review fails" (closes #558), captured at
 * commit 295cc7e0f5bfe2a263d804f39905a261298b45dc — an intermediate head,
 * NOT the PR's current tip. The branch (fix/558-inline-comment-fallback)
 * has since gained follow-up fix commits that address the bug below; this
 * fixture deliberately pins to the pre-fix state so the miss stays
 * reproducible after the branch moves on.
 *
 * On 2026-07-15T14:26 Lien Review reviewed the PR at exactly this SHA and
 * produced 4 findings (github-actions review 4705057335/4705057522):
 *   1. toReviewCommentParams silently strips start_line <= 0 without warning
 *   2. postBodyThenRetryCommentsIndividually's body-only retry can itself
 *      fail silently, contradicting the doc comment's "must survive" claim
 *   3. buildPresentContext.postReviewComment discards dropped-comment info
 *   4. postPRReview's re-export in index.ts is a breaking return-type change
 * None of these is the bug below. At 2026-07-15T14:31, CodeRabbit reviewed
 * the same SHA (review 4705099282) and caught it:
 *   "Update the catch handling in postPRReview so
 *   postBodyThenRetryCommentsIndividually is invoked only for GitHub
 *   validation failures caused by invalid comment anchors; rethrow
 *   authentication, rate-limit, server, timeout, and other errors... Add a
 *   test verifying a transient/server createReview error rethrows and
 *   calls neither fallback endpoint."
 *
 * THE BUG: postPRReview's catch block (packages/review/src/github-api.ts,
 * ~lines 268-286 at this SHA) catches ANY error thrown by
 * `octokit.pulls.createReview` and — as long as `comments.length > 0` —
 * unconditionally calls `postBodyThenRetryCommentsIndividually` with no
 * check that the failure was actually the 422 anchor-validation case the
 * fallback was designed for. An auth/401 failure, a rate-limit/429
 * response, a 5xx, or a plain network error all take the identical path:
 * every individual per-comment retry in the fallback will fail the same
 * way the batch call did, so the function returns `{ posted: 0, dropped:
 * <all> }` instead of throwing. A caller-facing infrastructure outage gets
 * silently repackaged as a success-shaped "0 posted, all dropped" result —
 * exactly the "catch-then-degrade" error-swallowing shape, just gated on
 * the wrong condition (any error, not the one error class the fallback
 * actually handles).
 *
 * WHY error-swallowing (not incomplete-handling): the rule's mandate is
 * "don't let a broad catch convert a real failure into a quiet degraded
 * result" — that's precisely this. `incomplete-handling` is declared as a
 * `ruleCandidates` fallback because a vote could plausibly file this under
 * "the fix doesn't handle all the cases it claims to" instead.
 *
 * RULE-TRIGGER VERIFICATION (2026-07-15, `build-prompts.ts` against this
 * fixture): active rules = ['structural-analysis', 'edge-case-sweep',
 * 'incomplete-handling', 'error-swallowing', 'boundary-change',
 * 'stale-duplicate', 'doc-truth']; skipped = ['concurrency-race',
 * 'untrusted-input-validation']. No trigger gap — both `rule` and its one
 * `ruleCandidates` entry are active, so a correct vote is reachable by
 * construction.
 *
 * REGENERATE (fixture JSON is gitignored):
 *   npx tsx packages/review/test/harness/capture-pr.ts 752 \
 *     packages/review/test/harness/fixtures/error-swallowing/pr752-undiscriminated-catch-salvage.fixture.json \
 *     --sha 295cc7e
 * (295cc7e remains resolvable: it's an ancestor of the PR's current head,
 * ancestry re-verified via `git merge-base --is-ancestor` before capture.)
 * Capture produced 6449 total chunks / 133 changed-file chunks — a healthy
 * full-repo index, not the markdown/Vue-only partial-index signature.
 *
 * CAPTURE BUG FOUND + FIXED while building this fixture: `gh pr view`
 * always returns the PR's CURRENT description, and Lien Review's own
 * `<!-- lien-stats -->` badge (inserted by `updatePRDescription` in
 * `github-api.ts`) is rewritten on every new commit. Since #752 gained
 * fix commits after 295cc7e, the body captured at the time this fixture
 * was first built carried the bot's re-review of the FIXED head, which
 * stated almost verbatim "only 422 validation errors trigger per-comment
 * retries, other errors still propagate... avoiding masking auth/
 * rate-limit/network errors" — a spoiler baked straight into the
 * fixture's prompt. A first (contaminated) 3-vote run scored a misleading
 * 3/3, with votes citing that exact vocabulary. Fixed by
 * `stripLienStatsBadge()` in `capture-pr.ts`, which truncates the body at
 * the badge marker whenever `--sha` pins a commit earlier than the PR's
 * present head; re-captured and re-verified the body no longer contains
 * "422"/"rate-limit"/"lien-stats"/"coderabbit" before re-measuring (see
 * BASELINE below). This risk applies to any `--sha`-pinned fixture whose
 * source PR was fixed and re-reviewed after the pinned commit — not
 * unique to this one.
 *
 * SMOKE TEST (assert-cli.ts, zero LLM spend, 2026-07-15) — three
 * hand-written verdicts against the assertions below:
 *   - perfect verdict (names the undiscriminated-catch mechanism + the
 *     auth/rate-limit/5xx/posted:0 impact) -> exit 0 (PASS), as required.
 *   - empty verdict ({findings:[],toolCalls:[],turns:1}) -> exit 1 (Tier 1
 *     fail), as required.
 *   - distractor verdict (the PR's REAL "doc-comment contradiction"
 *     finding — postBodyThenRetryCommentsIndividually's body-only post
 *     can itself silently fail — same file, adjacent function, same rule
 *     label, but NOT this bug) -> exit 2 (Tier 2 fail), as required.
 *   All three verdicts scored as expected; scratch JSONs deleted after.
 *
 * BASELINE MEASUREMENT (moonshotai/kimi-k2.7-code, prod default,
 * `--fixture`, 3 votes, sanitized fixture, 2026-07-15): **0/3.** Votes 2
 * and 3 emitted no findings at all; vote 1 emitted exactly one finding —
 * the doc-truth-labeled twin of the scripted distractor above (same
 * "body must survive" doc-comment-contradiction content, just filed
 * under `doc-truth` instead of `error-swallowing`). None of the 3 votes
 * named the undiscriminated-catch mechanism. This reproduces the live
 * 2026-07-15 miss on the prod default model — not a one-off live-run
 * fluke — and the near-miss finding independently corroborates the
 * distractor choice above. Cost: $0.13 for this clean run; the earlier
 * contaminated run cost $0.12 and a second contaminated re-run (while
 * diagnosing a local output-capture truncation, before the leak was
 * understood) cost another $0.12 — ~$0.37 total spent on this fixture,
 * against a $0.10-0.15 target, due to the capture bug above.
 */

import type { FixtureAssertions } from '../../assertions.js';

const RULE_CANDIDATES = ['error-swallowing', 'incomplete-handling'];

const assertions: FixtureAssertions = {
  description:
    "PR #752 @ 295cc7e — postPRReview's catch block salvages EVERY " +
    'createReview error (auth, rate-limit, 5xx, network) the same way it ' +
    'salvages a 422 anchor-validation failure, silently degrading an ' +
    'infra outage into { posted: 0, dropped: <all> } instead of throwing. ' +
    'CodeRabbit caught it same-SHA; Lien Review did not.',
  rule: 'error-swallowing',
  ruleCandidates: RULE_CANDIDATES,
  expect: (result, h) => {
    h.expectAnyRuleFired(RULE_CANDIDATES, result);
    // (A) the mechanism: the catch doesn't discriminate error class — it
    // treats a 422 anchor-validation failure and an infra failure alike.
    h.expectFindingMentions(
      [
        'not just 422',
        'not only 422',
        'not just validation errors',
        'not only validation errors',
        'only for 422',
        'only on 422',
        'only when validation fails',
        'regardless of the error type',
        'regardless of error type',
        'regardless of why',
        'no matter the cause',
        'no matter what error',
        'does not distinguish',
        "doesn't distinguish",
        'without distinguishing',
        'fails to distinguish',
        'treats every error',
        'treats any error',
        'treats all errors',
        'catches every error',
        'catches any error',
        'unconditionally falls back',
        'unconditionally triggers',
        'unconditionally invokes',
        'too broad a catch',
        'overly broad catch',
        'overly broad except',
        'blanket catch',
      ],
      result,
    );
    // (B) the impact: naming the confusable error classes (auth,
    // rate-limit, 5xx) that get wrongly salvaged/degraded instead of
    // rethrown, or the {posted:0, dropped:all} degraded-result shape.
    h.expectFindingMentions(
      [
        'authentication error',
        'authentication failure',
        'auth error',
        'auth failure',
        '401',
        'rate limit',
        'rate-limit',
        '429',
        '5xx',
        'server error',
        '500 error',
        'infrastructure failure',
        'infra failure',
        'should rethrow',
        'should propagate',
        'should still throw',
        'should be rethrown',
        'masks infrastructure',
        'masks the real error',
        'masking infrastructure',
        'converts infrastructure',
        'converts an infrastructure',
        'converted into a degraded',
        'degrade silently',
        'posted: 0',
        'posted 0 of',
        'dropped: all',
        'drops all comments',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['characterization'],
};

export default assertions;

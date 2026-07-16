/**
 * PR #511 — CreditService introduces three DB::transaction blocks each
 * using Organization::lockForUpdate()->find($org->id). Hits keywords
 * `transaction`, `lockForUpdate`, `DB::transaction`. Real check-then-act
 * on credit balance — ripe for TOCTOU analysis.
 *
 * Tier 2 (added 2026-07-11, authored from 3 observed Kimi votes —
 * moonshotai/kimi-k2.7-code, the prod default): pins the substance of the
 * correct finding. The real race the rule must catch is NOT inside the
 * lock-protected CreditService methods — it's the check-then-act GAP in
 * `ProcessPullRequestWebhook::hasCredits`, which reads the org's
 * credit_balance WITHOUT lockForUpdate before dispatching, so two
 * concurrent webhooks for the same org both pass the gate and later both
 * deduct, driving the balance negative. All 3 votes reported exactly this.
 *
 * Two expectFindingMentions calls => AND, each a wide any-of OR-list:
 *   (A) the race concept — TOCTOU / check-then-act / missing row lock.
 *   (B) the credit-billing impact — hasCredits reading credit_balance,
 *       concurrent dispatch, balance going negative/overdrawn.
 *
 * Vocabulary evidence (all 3 votes, message/suggestion/evidence):
 *   - (A) "TOCTOU race condition" (verbatim in all 3); the fix names
 *     `lockForUpdate` / "row lock" / "without locking"; evidence calls it
 *     "check-then-act".
 *   - (B) `hasCredits`, `credit_balance`, "concurrent … webhook(s)",
 *     "dispatch to NATS", and the balance going "negative" / "overdrawn" /
 *     "over-spend"; votes 2-3 also cite `canRunReview` and `deductCredit`.
 *
 * Note: vote 1 also emits a second, independently-valid TOCTOU finding on
 * `CreditService::purchaseCredits` (unprotected stripe_payment_intent_id
 * idempotency check) — not required by these assertions; the hasCredits
 * finding above is the one present in every vote.
 *
 * Offline re-score (assert-cli.ts against the 3 saved vote results): 3/3
 * previously-passing votes still pass with these Tier-2 checks; no widening
 * was needed. Certification against the >= 9/10 bar is pending a paid
 * calibrate-10 (the main session runs it).
 *
 * KEYWORD-INTEGRITY SWEEP (2026-07-16): gate (B) was bare-noun-heavy
 * ('concurrent', 'negative', 'credit_balance', 'dispatch' alone) and
 * false-passed a hand-written distractor (a real, *different* TOCTOU on
 * `CreditService::purchaseCredits` — see the "Note" above) via assert-cli.ts.
 * Tightened to the specific buggy function/call-chain identifiers and
 * compound double-webhook/negative-balance phrases; gate (A) was left
 * untouched (see the tightened gate's own comment for the full before/after).
 * No stored vote traces exist to offline re-score (fresh worktree) — any
 * PRIOR calibration number for this canary PREDATES this tightening; the
 * upcoming corpus recalibration sweep re-measures it.
 *
 * 3-vote screen 2026-07-16: 3/3 at main@5fadbe1a — pre-#787 budget raise,
 * all other this-week changes in [SCREEN ONLY — calibrate-10 certification
 * pending]
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #511 — CreditService check-then-act with lockForUpdate',
  rule: 'concurrency-race',
  expect: (result, h) => {
    h.expectRuleFired('concurrency-race', result);
    // (A) names the race: check-then-act with no lock.
    h.expectFindingMentions(
      [
        'toctou',
        'time-of-check',
        'time of check',
        'race condition',
        'check-then-act',
        'check then act',
        'lockforupdate',
        'row lock',
        'without a lock',
        'without locking',
        'without lockforupdate',
      ],
      result,
    );
    // (B) the credit-billing impact of the unguarded check. Kept to the
    // specific buggy function/call-chain identifiers (hasCredits,
    // canRunReview, deductCredit, NATS dispatch) and compound
    // double-webhook/negative-balance phrases — NOT bare 'concurrent',
    // 'negative', 'credit_balance', or 'dispatch' alone, each of which a
    // distractor about a *different* CreditService race (e.g. the
    // purchaseCredits stripe_payment_intent_id idempotency gap noted above)
    // also legitimately uses, without ever naming hasCredits or the
    // webhook-dispatch mechanism. Verified via assert-cli.ts: a hand-written
    // purchaseCredits distractor false-passed the original list and
    // correctly fails against this one.
    h.expectFindingMentions(
      [
        'hascredits',
        'canrunreview',
        'deductcredit',
        'nats',
        'dispatch to nats',
        'dispatching to nats',
        'concurrent webhook',
        'concurrent webhooks',
        'two webhooks',
        'both webhooks',
        'balance going negative',
        'balance negative',
        'balance overdrawn',
        'account overdrawn',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

/**
 * PR #411 — PaymentService::charge wrapped in try { ... } catch { return
 * false; }. Throws are silently converted to a `false` result. Textbook
 * error-swallowing: the caller cannot distinguish "charge declined" from
 * "charge crashed".
 *
 * Calibration status: 10/10 on `moonshotai/kimi-k2.7-code` (2026-07-10,
 * --calibrate 10, healthy capture).
 *
 * Tier 2 (added 2026-07-11, authored from 10 observed Kimi votes —
 * moonshotai/kimi-k2.7-code, the prod default; the same --calibrate 10
 * capture above): pins the substance of the correct finding, not just that
 * error-swallowing fired. Every correct vote must name (A) the swallow
 * mechanism — `charge()` catching all exceptions and returning `false`
 * without logging or rethrowing — and (B) the caller-side impact: callers
 * relying on RuntimeException propagation now get a silent `false` and
 * cannot distinguish failure causes.
 *
 * Two expectFindingMentions calls => AND, each a wide any-of OR-list:
 *   (A) the catch-all-returns-false swallow mechanism.
 *   (B) the lost-exception-propagation / can't-distinguish impact.
 *
 * Vocabulary evidence (all 10 votes, message/suggestion/evidence):
 *   - (A) every vote names `charge()` in `PaymentService`, says it now
 *     "catches all exceptions" / "catch-all" and "returns false" "without
 *     logging or rethrowing" (swallows / discards the error).
 *   - (B) every vote cites `RuntimeException` propagation being lost and the
 *     callers `OrderService::processOrder` / `CheckoutService::expressCheckout`
 *     silently proceeding; most enumerate the indistinguishable failure modes
 *     ("already paid", "invalid total", "gateway failure") and "error context".
 *
 * Note: several votes label the two caller findings `structural-analysis`
 * rather than `error-swallowing`; Tier 1 (`expectRuleFired`) still holds
 * because every vote has at least one error-swallowing finding, and the (A)
 * anchor (charge / returns false / swallow) is specific to it.
 *
 * Offline re-score (assert-cli.ts against the 10 saved vote results): 10/10
 * previously-passing votes still pass with these Tier-2 checks; no widening
 * was needed. Certification against the >= 9/10 bar is pending a paid
 * calibrate-10 (the main session runs it).
 *
 * KEYWORD-INTEGRITY SWEEP (2026-07-16): gate (B) was bare-noun-heavy (bare
 * 'silent'/'silently'/'distinguish'/'orderservice'/'processorder'/
 * 'checkoutservice'/'expresscheckout') and, combined with gate (A)'s
 * legitimate 'charge'/'paymentservice' anchors, false-passed a hand-written
 * distractor via assert-cli.ts: a finding about OrderService::processOrder
 * not validating the order total is positive (a real, different bug)
 * matched (A) via 'charge'/'paymentservice' and (B) via
 * 'orderservice'+'silently', without ever describing the swallow's
 * caller-facing masking effect. Tightened (B) to the specific
 * failure-mode/propagation vocabulary; gate (A) was left untouched. This
 * canary's 10/10 PREDATES this tightening; no stored vote traces exist in
 * this worktree to offline re-score — the upcoming corpus recalibration
 * sweep re-measures it.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #411 — PaymentService charge wraps throw in catch → false',
  rule: 'error-swallowing',
  expect: (result, h) => {
    h.expectRuleFired('error-swallowing', result);
    // (A) the catch-all-returns-false swallow mechanism.
    h.expectFindingMentions(
      [
        'charge',
        'paymentservice',
        'catch-all',
        'catches all',
        'catch (\\exception',
        'catch block',
        'returns false',
        'return false',
        'boolean false',
        'swallow',
        'swallowing',
        'swallowed',
        'without logging',
        'no logging',
        'rethrow',
        'rethrowing',
        'discard',
      ],
      result,
    );
    // (B) the lost-exception-propagation / can't-distinguish impact. Dropped
    // bare 'silent'/'silently'/'distinguish'/'orderservice'/'processorder'/
    // 'checkoutservice'/'expresscheckout' — a distractor about a *different*
    // bug (OrderService::processOrder not validating the order total is
    // positive before calling charge) false-passed via 'orderservice' +
    // 'silently' (and gate (A) via bare 'charge'/'paymentservice'), without
    // ever describing the swallow's caller-facing masking effect (verified
    // via assert-cli.ts).
    h.expectFindingMentions(
      [
        'runtimeexception',
        'exception propagation',
        'lost exception',
        'error context',
        'already paid',
        'invalid total',
        'gateway failure',
        'gateway error',
        "can't distinguish",
        'cannot distinguish',
        'can not distinguish',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

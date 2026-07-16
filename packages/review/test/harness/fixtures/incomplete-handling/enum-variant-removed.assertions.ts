/**
 * PR #437 — UserRole enum no longer includes Guest. getPermissionsForRole
 * switch falls through to default: [] for any unhandled variant. Rule
 * should flag the missing-case / partial-iteration pattern.
 *
 * Tier 2 (added 2026-07-11, authored from 3 observed Kimi votes —
 * moonshotai/kimi-k2.7-code, the prod default): pins the substance of the
 * incomplete-handling finding, not just that the rule fired. Every correct
 * vote must name (A) the switch anchor — `getPermissionsForRole`'s silent
 * `default: return []` replacing an exhaustive check — and (B) the impact:
 * an unhandled role (a legacy/removed Guest, or any future variant)
 * silently receiving an EMPTY permission set instead of failing loudly.
 *
 * Two expectFindingMentions calls => AND, each a wide any-of OR-list:
 *   (A) the switch / silent-default / exhaustiveness anchor.
 *   (B) the silent-permission-loss impact (guest / empty permissions).
 *
 * Vocabulary evidence (all 3 votes, message/suggestion/evidence):
 *   - (A) every vote names `getPermissionsForRole`, quotes the silent
 *     `default: return []`, and contrasts it with an "exhaustive" switch /
 *     "exhaustiveness" `never` check (the recommended fix).
 *   - (B) every vote says an unhandled role (all mention `Guest`/`guest`)
 *     "silently" receives an "empty permission set" / "zero permissions" /
 *     "empty array" — losing access rather than erroring.
 *
 * Note: votes also emit sibling structural-analysis / edge-case-sweep
 * findings about `User.role` being unpopulated by getUser/createUser;
 * expectFindingMentions scans all findings, but the (A) anchors above
 * (getPermissionsForRole / default: return [] / exhaustive) are specific
 * to the incomplete-handling target finding, so the check pins the right bug.
 *
 * Offline re-score (assert-cli.ts against the 3 saved vote results): 3/3
 * previously-passing votes still pass with these Tier-2 checks; no widening
 * was needed. Certification against the >= 9/10 bar is pending a paid
 * calibrate-10 (the main session runs it).
 *
 * KEYWORD-INTEGRITY SWEEP (2026-07-16): both gates were bare-noun-heavy
 * ('switch', 'default branch', 'default case' in (A); bare 'silently' /
 * 'empty array' / 'unhandled' in (B)) and false-passed a hand-written
 * distractor via assert-cli.ts: a finding about createUser never assigning
 * `role` (a real, different bug) matched (A) via 'switch'/'default branch'
 * and (B) via bare 'silently', without ever naming getPermissionsForRole or
 * Guest. Tightened both gates to drop the bare terms; see each gate's own
 * comment. No stored vote traces exist in this worktree to offline
 * re-score — this canary's prior calibration PREDATES this tightening; the
 * upcoming corpus recalibration sweep re-measures it.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #437 — UserRole switch falls through on missing variant',
  rule: 'incomplete-handling',
  expect: (result, h) => {
    h.expectRuleFired('incomplete-handling', result);
    // (A) the switch / silent-default / exhaustiveness anchor. Dropped bare
    // 'switch', 'userrole', 'default case', 'default branch' — a distractor
    // about a *different* function (createUser never assigning `role`,
    // whose downstream impact is described as hitting "a switch statement's
    // ... default branch") false-passed the original list via those bare
    // terms without ever naming getPermissionsForRole or its specific
    // silent-default code shape (verified via assert-cli.ts).
    h.expectFindingMentions(
      [
        'getpermissionsforrole',
        'default: return []',
        'silent default',
        'silent `default`',
        'exhaustive',
        'exhaustiveness',
        'never check',
        ': never',
      ],
      result,
    );
    // (B) the silent-permission-loss impact. Dropped bare 'silently' /
    // 'empty array' / 'unhandled' — the same createUser distractor also
    // false-passed this gate via bare 'silently' alone.
    h.expectFindingMentions(
      [
        'guest',
        'empty permission',
        'zero permission',
        'permission set',
        'silently receive',
        'silently returns empty',
        'silently return empty',
        'silently lose',
        'lose all access',
        'locked out',
        'no permissions',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

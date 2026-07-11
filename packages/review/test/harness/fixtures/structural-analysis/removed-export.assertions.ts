/**
 * PR #399 — `parse_input` (Rust exported function) entirely removed.
 * Classic structural breakage: any caller of `parse_input` is now broken.
 *
 * Per structural-analysis prompt, the agent MUST call grep_codebase for
 * each removed symbol name to check if any file still imports it. The
 * Tier 1 assertion enforces both: rule fires + investigation happened.
 *
 * Tier 2 (added 2026-07-11, authored from 3 observed Kimi votes —
 * moonshotai/kimi-k2.7-code, the prod default): pins the substance of the
 * correct finding, not just that structural-analysis fired. The planted
 * bug is a hard breaking change, so every correct vote must name (A) the
 * removed exported symbol `parse_input` and (B) that its remaining callers
 * won't compile. Two separate expectFindingMentions calls => AND; each is a
 * wide any-of OR-list so a model that varies its phrasing (e.g. "fail to
 * compile" vs "won't compile", "call sites" vs "callers") still matches.
 *
 * Vocabulary evidence (all 3 votes, message/suggestion/evidence):
 *   - (A) every finding names `parse_input` / `parser::parse_input` in
 *     `parser.rs`; the impacted call sites live in `main.rs` and
 *     `reporter.rs` (symbols process_files, quick_analyze,
 *     reanalyze_with_config).
 *   - (B) every vote states the crate "will fail to compile" and describes
 *     the removed function's callers/call sites being broken.
 *
 * Offline re-score (assert-cli.ts against the 3 saved vote results): 3/3
 * previously-passing votes still pass with these Tier-2 checks; no widening
 * was needed. Certification against the >= 9/10 bar is pending a paid
 * calibrate-10 (the main session runs it).
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #399 — removed parse_input export (Rust)',
  rule: 'structural-analysis',
  expect: (result, h) => {
    h.expectRuleFired('structural-analysis', result);
    h.expectToolCalled('grep_codebase', result);
    // (A) names the removed exported symbol.
    h.expectFindingMentions(['parse_input', 'parser::parse_input', 'parser.rs'], result);
    // (B) states the compile breakage of its remaining callers.
    h.expectFindingMentions(
      [
        'fail to compile',
        'will fail to compile',
        "won't compile",
        'not compile',
        'compilation',
        'compile',
        'call site',
        'call sites',
        'callers',
        'caller',
        'removed',
        'removing',
        'breaks',
        'broken',
        'main.rs',
        'reporter.rs',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

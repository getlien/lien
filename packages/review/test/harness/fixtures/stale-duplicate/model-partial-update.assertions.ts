/**
 * Snapshot from PR #539 at SHA f780541 — the model-bump-only state, before
 * CodeRabbit caught the stale hardcoded `'claude-sonnet-4-6'` on
 * adapterContext.model (pr-review.ts:300) that the line-272 conditional
 * missed. The fix landed in the next commit (`dd3b82c`), hoisting both
 * sites into a shared `selectedModel` const.
 *
 * Capture command:
 *   npx tsx packages/review/test/harness/capture-pr.ts 539 \
 *     packages/review/test/harness/fixtures/stale-duplicate/model-partial-update.fixture.json \
 *     --sha f780541
 *
 * Tier 1: rule fires. (We no longer assert grep_codebase: the deterministic
 * <stale_literal_candidates> signal now pre-computes the surviving copy and
 * injects it, so a correct agent confirms the candidate instead of grepping —
 * and in fixture replay grep_codebase is blind against the dead repoRootDir
 * anyway. See packages/review/src/stale-literal-signals.ts and memory
 * project_harness_grep_read_replay_blindness.)
 * Tier 2: the finding cites adapterContext / line 300 / claude-sonnet-4-6
 * or proposes a hoist to a shared const. Keyword set is deliberately wide
 * to cover the phrasings any correct rendering will use.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #539 f780541 — model bump missed adapterContext.model on line 300',
  rule: 'stale-duplicate',
  expect: (result, h) => {
    h.expectRuleFired('stale-duplicate', result);
    h.expectFindingMentions(
      [
        'adaptercontext',
        'line 300',
        'claude-sonnet-4-6',
        'selectedmodel',
        'hoist',
        'single source',
        'one source of truth',
        // Widen to absorb phrasing drift across runs. Any correct
        // rendering of this finding will use one of the above OR one
        // of these — they're the synonyms the model reaches for when
        // it doesn't echo the literal back.
        'sonnet',
        'stale',
        'hardcoded',
        'attribution',
        'metadata',
        'outside the diff',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;

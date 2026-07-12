/**
 * Preflight check: does a fixture's assertion target a rule that is even
 * active for that fixture's trigger context?
 *
 * Since #724, the agent's output format enumerates `ruleId` to the fixture's
 * ACTIVE rule set only (see `buildOutputFormat` in
 * `../../src/plugins/agent/system-prompt.ts`) — the model cannot emit a
 * finding tagged with a skipped rule's id even if it correctly spots the bug.
 * An `.assertions.ts` whose `rule` (and every `ruleCandidates` entry) is
 * trigger-skipped is therefore unpassable by construction: every paid vote
 * against it is wasted OpenRouter spend. This module is the pure decision
 * logic; `run.ts` wires it into a preflight that runs before any API call.
 */

import type { FixtureAssertions } from './assertions.js';

/**
 * Returns a human-actionable message when neither `assertions.rule` nor any
 * of `assertions.ruleCandidates` is in `activeRuleIds`, or `null` when the
 * fixture's assertion is passable.
 */
export function checkRuleCoverage(
  assertions: Pick<FixtureAssertions, 'rule' | 'ruleCandidates'>,
  activeRuleIds: string[],
): string | null {
  const candidates = [assertions.rule, ...(assertions.ruleCandidates ?? [])];
  if (candidates.some(id => activeRuleIds.includes(id))) return null;

  const active = activeRuleIds.length > 0 ? activeRuleIds.join(', ') : '(none)';
  const candidateList =
    assertions.ruleCandidates && assertions.ruleCandidates.length > 0
      ? ` (also checked ruleCandidates: [${assertions.ruleCandidates.join(', ')}])`
      : '';
  return (
    `fixture expects rule '${assertions.rule}'${candidateList} but the active rule set for ` +
    `this fixture's trigger context is [${active}]; unpassable since #724 (agent output is ` +
    `enumerated to active rules only) — fix the assertion's rule/ruleCandidates or the ` +
    `fixture's trigger conditions`
  );
}

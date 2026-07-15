/**
 * Unit tests for the harness's rule-coverage preflight (#742).
 *
 * Since #724, the agent's output format enumerates `ruleId` to the fixture's
 * ACTIVE rule set only, so an `.assertions.ts` whose `rule` (and every
 * `ruleCandidates` entry) is trigger-skipped is unpassable by construction —
 * every paid vote against it is wasted OpenRouter spend. `checkRuleCoverage`
 * is the pure decision logic; these tests cover it with zero network/LLM
 * spend by hand-building `{ rule, ruleCandidates }` inputs and an active-rule
 * id list, rather than replaying a real fixture through `selectRules`.
 */
import { describe, expect, it } from 'vitest';

import { checkRuleCoverage } from './harness/rule-coverage.js';

describe('checkRuleCoverage', () => {
  it('passes when `rule` is in the active set', () => {
    const result = checkRuleCoverage({ rule: 'boundary-change' }, [
      'structural-analysis',
      'boundary-change',
    ]);
    expect(result).toBeNull();
  });

  it('flags when `rule` is inactive and there are no ruleCandidates', () => {
    const result = checkRuleCoverage({ rule: 'concurrency-race' }, ['structural-analysis']);
    expect(result).not.toBeNull();
  });

  it('passes when `rule` is inactive but a ruleCandidates entry is active', () => {
    const result = checkRuleCoverage(
      { rule: 'boundary-change', ruleCandidates: ['boundary-change', 'edge-case-sweep'] },
      ['structural-analysis', 'edge-case-sweep'],
    );
    expect(result).toBeNull();
  });

  it('flags when `rule` and every ruleCandidates entry are inactive', () => {
    const result = checkRuleCoverage(
      { rule: 'boundary-change', ruleCandidates: ['boundary-change', 'edge-case-sweep'] },
      ['structural-analysis'],
    );
    expect(result).not.toBeNull();
  });

  it('violation message names the expected rule, the active set, and is fixture-actionable', () => {
    const result = checkRuleCoverage(
      { rule: 'concurrency-race', ruleCandidates: ['error-swallowing'] },
      ['structural-analysis', 'doc-truth'],
    );
    expect(result).not.toBeNull();
    expect(result).toContain("rule 'concurrency-race'");
    expect(result).toContain('ruleCandidates: [error-swallowing]');
    expect(result).toContain('structural-analysis, doc-truth');
    expect(result).toContain('#724');
    expect(result).toMatch(/fix the assertion|fixture's trigger conditions/);
  });

  it('reports "(none)" for the active set when no rules are active at all', () => {
    const result = checkRuleCoverage({ rule: 'doc-truth' }, []);
    expect(result).toContain('(none)');
  });
});

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
 *
 * `withDocsDriftRuleId` (docs-drift design doc §2/§3) covers the one
 * dedicated-pass-only exception: `docs-drift` has no `BUILTIN_RULES` entry,
 * so `selectRules` never includes it in `activeRuleIds` — without this union,
 * every docs-drift fixture would be flagged unpassable-by-construction even
 * when the pass is genuinely enabled for it (`run.ts`'s
 * `validateFixtureRuleCoverage`).
 */
import { describe, expect, it } from 'vitest';

import { checkRuleCoverage, withDocsDriftRuleId } from './harness/rule-coverage.js';
import type { AgentConfig } from '../src/plugins/agent/types.js';

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

// ---------------------------------------------------------------------------
// withDocsDriftRuleId — the docs-drift dedicated-pass-only exception
// ---------------------------------------------------------------------------

function cfg(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { model: 'm', maxTurns: 15, maxTokenBudget: 100_000, ...overrides };
}

describe('withDocsDriftRuleId', () => {
  it('unions in docs-drift when config.docsDriftPass is true', () => {
    const result = withDocsDriftRuleId(['structural-analysis'], cfg({ docsDriftPass: true }));
    expect(result).toEqual(['structural-analysis', 'docs-drift']);
  });

  it('leaves activeRuleIds untouched when the pass is disabled', () => {
    const result = withDocsDriftRuleId(['structural-analysis'], cfg());
    expect(result).toEqual(['structural-analysis']);
  });

  it('leaves activeRuleIds untouched when config is undefined', () => {
    const result = withDocsDriftRuleId(['structural-analysis'], undefined);
    expect(result).toEqual(['structural-analysis']);
  });

  it('does not mutate the input array', () => {
    const input = ['structural-analysis'];
    withDocsDriftRuleId(input, cfg({ docsDriftPass: true }));
    expect(input).toEqual(['structural-analysis']);
  });

  // -------------------------------------------------------------------------
  // Combined with checkRuleCoverage: the exact scenario the preflight fix targets
  // -------------------------------------------------------------------------

  it('a docs-drift fixture passes the preflight once the union is applied (pass enabled)', () => {
    const activeRuleIds = withDocsDriftRuleId(
      ['structural-analysis'],
      cfg({ docsDriftPass: true }),
    );
    const result = checkRuleCoverage({ rule: 'docs-drift' }, activeRuleIds);
    expect(result).toBeNull();
  });

  it('a docs-drift fixture is flagged unpassable when the pass is NOT enabled (no union applied)', () => {
    const activeRuleIds = withDocsDriftRuleId(['structural-analysis'], cfg());
    const result = checkRuleCoverage({ rule: 'docs-drift' }, activeRuleIds);
    expect(result).not.toBeNull();
    expect(result).toContain("rule 'docs-drift'");
  });
});

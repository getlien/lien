/**
 * Tiered assertion helpers for the agent-review test harness.
 *
 * Tier 1 — stable at T=0. Use freely; failures here are signal, not noise.
 *   expectRuleFired, expectEmpty, expectFindingsCount, expectToolCalled
 *
 * Tier 2 — stable enough for prompt-tweak verification. Phrasings drift
 * across model versions; pass an array of accepted keywords rather than
 * exact text. Use sparingly.
 *   expectFindingMentions
 *
 * Tier 3 (exact text match) is intentionally not exposed.
 */

import type { AgentFinding } from '../../src/plugins/agent/types.js';

export interface HarnessResult {
  findings: AgentFinding[];
  toolCalls: string[];
  turns: number;
}

export type AssertionTier = 1 | 2;

export class HarnessAssertionError extends Error {
  readonly tier: AssertionTier;
  constructor(message: string, tier: AssertionTier) {
    super(message);
    this.name = 'HarnessAssertionError';
    this.tier = tier;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recognized tool-call shapes:
 *   - `tool=<name>` (our capturing logger format)
 *   - `"name":"<name>"` (raw provider trace)
 *   - bare `<name>` as a standalone token (CC-mode harness-meta lines like
 *     `get_files_context: src/foo.ts`)
 *
 * The bare-token check uses \b so unrelated substrings can't false-match
 * (e.g. `read_file` vs `file_reader`).
 */
function isToolCall(entry: string, tool: string): boolean {
  const escaped = escapeRegExp(tool);
  return (
    entry.includes(`tool=${tool}`) ||
    entry.includes(`"name":"${tool}"`) ||
    new RegExp(`\\b${escaped}\\b`).test(entry)
  );
}

// ---------------------------------------------------------------------------
// Tier 1
// ---------------------------------------------------------------------------

export function expectRuleFired(ruleId: string, result: HarnessResult): void {
  const fired = result.findings.some(f => f.ruleId === ruleId);
  if (!fired) {
    const observed = result.findings.map(f => f.ruleId ?? '(none)').join(', ') || '(no findings)';
    throw new HarnessAssertionError(
      `Tier 1: expected rule '${ruleId}' to fire. Got: ${observed}`,
      1,
    );
  }
}

export function expectEmpty(result: HarnessResult): void {
  if (result.findings.length > 0) {
    throw new HarnessAssertionError(
      `Tier 1: expected no findings. Got ${result.findings.length}: ` +
        result.findings.map(f => `${f.ruleId ?? '?'}@${f.filepath}:${f.line}`).join('; '),
      1,
    );
  }
}

export function expectFindingsCount(n: number, result: HarnessResult): void {
  if (result.findings.length !== n) {
    throw new HarnessAssertionError(
      `Tier 1: expected exactly ${n} finding(s). Got ${result.findings.length}.`,
      1,
    );
  }
}

export function expectToolCalled(tool: string, result: HarnessResult): void {
  const called = result.toolCalls.some(entry => isToolCall(entry, tool));
  if (!called) {
    throw new HarnessAssertionError(
      `Tier 1: expected tool '${tool}' to be called. Calls observed: ` +
        (result.toolCalls.length === 0 ? '(none)' : result.toolCalls.slice(0, 8).join('; ')),
      1,
    );
  }
}

// ---------------------------------------------------------------------------
// Tier 2
// ---------------------------------------------------------------------------

/**
 * Pass if ANY finding's message/suggestion/evidence contains ANY of the
 * keywords (case-insensitive substring match). Designed for prompt-tweak
 * verification — provide several accepted phrasings, not one exact string.
 */
export function expectFindingMentions(keywords: string[], result: HarnessResult): void {
  // Reject blank/whitespace keywords — `''.includes('')` is true, so a stray
  // empty string would silently green-light every Tier 2 check.
  const normalized = keywords.map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
  if (normalized.length === 0) {
    throw new HarnessAssertionError('Tier 2: keywords list is empty (or contained only blanks)', 2);
  }
  const haystack = result.findings
    .flatMap(f => [f.message, f.suggestion ?? '', f.evidence ?? ''])
    .join('\n')
    .toLowerCase();
  const hit = normalized.find(kw => haystack.includes(kw));
  if (!hit) {
    throw new HarnessAssertionError(
      `Tier 2: expected at least one finding to mention any of [${normalized
        .map(k => `"${k}"`)
        .join(', ')}]. None matched. ` +
        (result.findings.length === 0
          ? 'No findings emitted.'
          : `Findings: ${result.findings.length}. First message: "${result.findings[0]?.message?.slice(0, 200) ?? ''}"`),
      2,
    );
  }
}

// ---------------------------------------------------------------------------
// Bundle exposed to .assertions.ts modules as the `h` argument
// ---------------------------------------------------------------------------

export const harness = {
  expectRuleFired,
  expectEmpty,
  expectFindingsCount,
  expectToolCalled,
  expectFindingMentions,
};

export type HarnessHelpers = typeof harness;

export interface FixtureAssertions {
  description: string;
  rule: string;
  expect: (result: HarnessResult, h: HarnessHelpers) => void;
  votes?: number;
  passThreshold?: number;
  tags?: string[];
}

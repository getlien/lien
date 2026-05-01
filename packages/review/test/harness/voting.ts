/**
 * K-of-M voting and N-run calibration for the OpenRouter mode.
 *
 * vote(K): runs the fixture K times, reports agreement on Tier 1 outcomes.
 * calibrate(N): runs N times, reports pass rate against the .assertions.ts.
 *
 * The 9/10 reliability bar from #538 is enforced by `calibrate(10)`.
 */

import { harness, HarnessAssertionError } from './assertions.js';
import type { FixtureAssertions, HarnessResult } from './assertions.js';
import { runFixture } from './runner.js';
import type { RunnerOptions } from './runner.js';

export interface VoteResult {
  votes: AssertedRun[];
  agree: boolean;
  passes: number;
  totalCost: number;
}

export interface AssertedRun {
  result: HarnessResult;
  cost: number;
  passed: boolean;
  failureMessage?: string;
  failureTier?: 1 | 2;
}

async function runOnce(
  fixturePath: string,
  assertions: FixtureAssertions,
  opts: RunnerOptions,
): Promise<AssertedRun> {
  let findings: HarnessResult['findings'];
  let toolCalls: string[];
  let turns: number;
  let cost: number;
  try {
    ({ findings, toolCalls, turns, cost } = await runFixture(fixturePath, opts));
  } catch (err) {
    // LLM-side failure (network, 5xx, timeout). Don't crash the calibration —
    // record it as a Tier 1 fail so the caller sees variance, not a thrown stack.
    return {
      result: { findings: [], toolCalls: [], turns: 0 },
      cost: 0,
      passed: false,
      failureMessage: `LLM error: ${err instanceof Error ? err.message : String(err)}`,
      failureTier: 1,
    };
  }

  const result: HarnessResult = { findings, toolCalls, turns };
  try {
    assertions.expect(result, harness);
    return { result, cost, passed: true };
  } catch (err) {
    if (err instanceof HarnessAssertionError) {
      return { result, cost, passed: false, failureMessage: err.message, failureTier: err.tier };
    }
    // Programmer error in the .assertions.ts module (not an assertion failure)
    // — surface clearly rather than swallow as a Tier 1 fail.
    throw err;
  }
}

/**
 * Run K calls in parallel. Promise.all is fine here because runOnce never
 * throws on LLM-side failures (it converts them to a passed=false result),
 * so a single bad call doesn't poison the batch. OpenRouter handles 10
 * concurrent OpenAI-compat requests without rate-limit issues at our volume.
 */
async function runMany(
  fixturePath: string,
  assertions: FixtureAssertions,
  opts: RunnerOptions,
  count: number,
): Promise<AssertedRun[]> {
  return Promise.all(Array.from({ length: count }, () => runOnce(fixturePath, assertions, opts)));
}

export async function vote(
  fixturePath: string,
  assertions: FixtureAssertions,
  opts: RunnerOptions,
  k: number = 3,
): Promise<VoteResult> {
  const votes = await runMany(fixturePath, assertions, opts, k);
  const passes = votes.filter(v => v.passed).length;
  const agree = passes === 0 || passes === k;
  const totalCost = votes.reduce((sum, v) => sum + v.cost, 0);
  return { votes, agree, passes, totalCost };
}

export interface CalibrateResult {
  runs: AssertedRun[];
  passes: number;
  passRate: number;
  totalCost: number;
  /** Whether the 9/10 bar from #538 was met. Bar threshold scales with N. */
  meetsReliabilityBar: boolean;
}

export async function calibrate(
  fixturePath: string,
  assertions: FixtureAssertions,
  opts: RunnerOptions,
  n: number = 10,
  passThreshold?: number,
): Promise<CalibrateResult> {
  const threshold = passThreshold ?? assertions.passThreshold ?? Math.max(1, Math.ceil(n * 0.9));
  const runs = await runMany(fixturePath, assertions, opts, n);
  const passes = runs.filter(r => r.passed).length;
  const totalCost = runs.reduce((sum, r) => sum + r.cost, 0);
  return {
    runs,
    passes,
    passRate: passes / n,
    totalCost,
    meetsReliabilityBar: passes >= threshold,
  };
}

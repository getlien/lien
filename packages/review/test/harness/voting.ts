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

/**
 * Heuristic for "is this an LLM transport/runtime error worth treating as
 * an honest Tier 1 fail" vs "this is a fixture/setup bug that should
 * surface and abort calibration." We only downgrade the former — anything
 * else (schema validation, missing repoChunks, programmer error in the
 * agent plugin) re-throws so calibration crashes loudly instead of
 * pretending the model was flaky.
 *
 * Match patterns the runner produces from real API failures: explicit
 * `LLM error: ...` prefix from runner.ts, OpenAI/anthropic SDK error names,
 * provider-side `terminated` / `fetch failed` strings, OpenRouter HTTP
 * codes (`API error (4xx/5xx)` etc).
 */
const LLM_ERROR_PATTERNS = [
  /^LLM error:/i,
  /^API error \(/i,
  /\bAPIError\b/,
  /\bAnthropicError\b/,
  /\bOpenAIError\b/,
  /\bECONNRESET\b|\bETIMEDOUT\b|\bENOTFOUND\b|\bECONNREFUSED\b/,
  /\bfetch failed\b/i,
  /\bterminated\b/i,
  /\brate ?limit\b/i,
  /\b5\d\d\b/, // 500/502/503/504
];

function isTransientLLMError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  const hay = `${name}: ${message}`;
  return LLM_ERROR_PATTERNS.some(re => re.test(hay));
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
    if (isTransientLLMError(err)) {
      // LLM-side failure (network, 5xx, terminated). Record as a Tier 1 fail
      // so calibration completes and the caller sees the variance.
      return {
        result: { findings: [], toolCalls: [], turns: 0 },
        cost: 0,
        passed: false,
        failureMessage: `LLM error: ${err instanceof Error ? err.message : String(err)}`,
        failureTier: 1,
      };
    }
    // Setup/fixture/programmer error — re-throw so the run aborts loudly
    // rather than masquerading as model flakiness across N votes.
    throw err;
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
 * Run K calls in parallel. Transient LLM errors are caught inside runOnce
 * and become passed=false results, so flaky network/5xx doesn't poison the
 * batch. Setup errors (fixture schema, programmer bugs) DO propagate and
 * reject the whole calibration — that's intentional, those should surface
 * loudly rather than masquerade as model flakiness across N votes.
 * OpenRouter handles 10 concurrent OpenAI-compat requests without rate-limit
 * issues at our volume.
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

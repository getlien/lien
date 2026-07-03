/**
 * OpenRouter-mode runner: load a fixture, drive the real
 * AgentReviewPlugin against it, return a HarnessResult.
 *
 * Costs real money per call (~$0.05/run) — only invoked from run.ts when
 * the user has set OPENROUTER_API_KEY.
 */

import type { ReviewContext, ReviewFinding } from '../../src/plugin-types.js';
import { AgentReviewPlugin } from '../../src/plugins/agent/index.js';
import type { AgentTrace } from '../../src/plugins/agent/types.js';
import { DEFAULT_REVIEW_MODEL, DEFAULT_OPENROUTER_BASE_URL } from '../../src/defaults.js';
import { silentLogger } from '../../src/test-helpers.js';

import { loadFixture } from './fixture-loader.js';
import type { HarnessResult } from './assertions.js';

export interface RunnerOptions {
  /** OpenRouter / OpenAI-compatible API key. Required. */
  apiKey: string;
  /** Model id. Defaults to DEFAULT_REVIEW_MODEL to mirror prod. */
  model?: string;
  /** Base URL. Default OpenRouter's. */
  baseUrl?: string;
  /** Override max turns. Default the plugin's default. */
  maxTurns?: number;
  /** Override max tokens. Default the plugin's default. */
  maxTokenBudget?: number;
}

/**
 * The harness doesn't need per-line log capture: `AgentReviewPlugin` reports
 * a fully structured `AgentTrace` via `reportTrace` regardless (see
 * `toolCallsFromTrace`/`turnCountFromTrace` below), and nothing here reads
 * raw log text, so `runFixture` passes the shared `silentLogger` (below).
 * `openai-client.ts`'s `[agent] Turn N: ...` / `[agent] Turn N tools: ...`
 * calls stay as human-readable production logs (untouched) — they're just
 * not depended on here anymore.
 */

/**
 * Flatten every tool call made across the run from the structured trace.
 * Previously this regex-parsed logger lines like "[agent] Turn 2 tools:
 * get_files_context, read_file" — stable only as long as nobody reworded
 * that log line. The trace carries the same data structurally (each turn's
 * `toolCalls[].name`), independent of any log phrasing.
 */
export function toolCallsFromTrace(trace: AgentTrace | undefined): string[] {
  if (!trace) return [];
  return trace.turns.flatMap(turn => turn.toolCalls.map(call => call.name));
}

/**
 * Turn count from the structured trace (mirrors `compare-votes.ts`'s
 * `trace.turns.length`), rather than the max turn number regex-parsed out
 * of "[agent] Turn N" log lines.
 */
export function turnCountFromTrace(trace: AgentTrace | undefined): number {
  return trace?.turns.length ?? 0;
}

function findingsToHarness(findings: ReviewFinding[]): HarnessResult['findings'] {
  return findings
    .filter(f => f.category !== 'summary')
    .map(f => ({
      filepath: f.filepath,
      line: f.line,
      endLine: f.endLine,
      symbolName: f.symbolName,
      severity: (f.severity === 'info' ? 'warning' : f.severity) as 'error' | 'warning',
      category: f.category,
      message: f.message,
      suggestion: f.suggestion,
      evidence: f.evidence,
      ruleId: (f.metadata as { ruleId?: string } | undefined)?.ruleId,
    }));
}

export async function runFixture(
  fixturePath: string,
  opts: RunnerOptions,
): Promise<HarnessResult & { cost: number }> {
  const ctx = (await loadFixture(fixturePath)) as ReviewContext;

  let cost = 0;
  const reportUsage = (usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
  }): void => {
    cost += usage.cost;
  };

  let trace: AgentTrace | undefined;
  const reportTrace = (t: AgentTrace): void => {
    trace = t;
  };

  const pluginCtx: ReviewContext = {
    ...ctx,
    logger: silentLogger,
    reportUsage,
    reportTrace,
    config: {
      // Preserve any agent options serialized into the captured fixture
      // (blastRadius config, custom token budgets, etc.) and only override
      // the runtime transport + API knobs the harness controls.
      ...(ctx.config ?? {}),
      apiKey: opts.apiKey,
      model: opts.model ?? DEFAULT_REVIEW_MODEL,
      provider: 'openai',
      baseUrl: opts.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL,
      maxTurns: opts.maxTurns ?? 15,
      maxTokenBudget: opts.maxTokenBudget ?? 100_000,
    },
  };

  const plugin = new AgentReviewPlugin();
  const findings = await plugin.analyze(pluginCtx);

  return {
    findings: findingsToHarness(findings),
    toolCalls: toolCallsFromTrace(trace),
    turns: turnCountFromTrace(trace),
    trace,
    cost,
  };
}

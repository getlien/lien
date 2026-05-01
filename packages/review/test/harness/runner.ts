/**
 * OpenRouter-mode runner: load a fixture, drive the real
 * AgentReviewPlugin against it, return a HarnessResult.
 *
 * Costs real money per call (~$0.05/run) — only invoked from run.ts when
 * the user has set OPENROUTER_API_KEY.
 */

import type { Logger } from '../../src/logger.js';
import type { ReviewContext, ReviewFinding } from '../../src/plugin-types.js';
import { AgentReviewPlugin } from '../../src/plugins/agent/index.js';

import { loadFixture } from './fixture-loader.js';
import type { HarnessResult } from './assertions.js';

export interface RunnerOptions {
  /** OpenRouter / OpenAI-compatible API key. Required. */
  apiKey: string;
  /** Model id. Default 'google/gemini-2.5-flash' to mirror prod. */
  model?: string;
  /** Base URL. Default OpenRouter's. */
  baseUrl?: string;
  /** Override max turns. Default the plugin's default. */
  maxTurns?: number;
  /** Override max tokens. Default the plugin's default. */
  maxTokenBudget?: number;
}

interface CapturingLogger extends Logger {
  lines: string[];
}

function makeCapturingLogger(): CapturingLogger {
  const lines: string[] = [];
  return {
    lines,
    info: (msg: string) => lines.push(`info: ${msg}`),
    warning: (msg: string) => lines.push(`warning: ${msg}`),
    error: (msg: string) => lines.push(`error: ${msg}`),
    debug: (msg: string) => lines.push(`debug: ${msg}`),
  };
}

/** Extract tool names from logger lines like "[agent] Turn 2 tools: get_files_context, read_file". */
function extractToolCalls(lines: string[]): string[] {
  const calls: string[] = [];
  for (const line of lines) {
    const match = line.match(/\[agent\] Turn \d+ tools: (.+)$/);
    if (match) {
      for (const name of match[1].split(',').map(s => s.trim())) {
        if (name) calls.push(name);
      }
    }
  }
  return calls;
}

function extractTurns(lines: string[]): number {
  let max = 0;
  for (const line of lines) {
    const match = line.match(/\[agent\] Turn (\d+)/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
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
  const logger = makeCapturingLogger();

  let cost = 0;
  const reportUsage = (usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
  }): void => {
    cost += usage.cost;
  };

  const pluginCtx: ReviewContext = {
    ...ctx,
    logger,
    reportUsage,
    config: {
      apiKey: opts.apiKey,
      model: opts.model ?? 'google/gemini-2.5-flash',
      provider: 'openai',
      baseUrl: opts.baseUrl ?? 'https://openrouter.ai/api/v1',
      maxTurns: opts.maxTurns ?? 15,
      maxTokenBudget: opts.maxTokenBudget ?? 100_000,
    },
  };

  const plugin = new AgentReviewPlugin();
  const findings = await plugin.analyze(pluginCtx);

  return {
    findings: findingsToHarness(findings),
    toolCalls: extractToolCalls(logger.lines),
    turns: extractTurns(logger.lines),
    cost,
  };
}

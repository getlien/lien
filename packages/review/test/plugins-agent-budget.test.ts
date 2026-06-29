import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIAgentClient, envDisabled } from '../src/plugins/agent/openai-client.js';
import { AgentReviewPlugin, scaleBudgetForBlastRadius } from '../src/plugins/agent/index.js';
import { scaleAgentBudget } from '../src/review-pr.js';
import { DEFAULT_REVIEW_MODEL, MAX_REVIEW_TOKEN_BUDGET } from '../src/defaults.js';
import { silentLogger } from '../src/test-helpers.js';
import type { Logger } from '../src/logger.js';
import type { PresentContext, ReviewFinding } from '../src/plugin-types.js';

// ---------------------------------------------------------------------------
// fetch mock helpers (OpenAI-compatible chat/completions)
// ---------------------------------------------------------------------------

type ChatResponse = {
  choices: Array<{
    message: { role: string; content: string | null; reasoning?: string; tool_calls?: unknown[] };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

/** Logger that records every line for assertions. */
function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record = (m: string) => lines.push(m);
  return {
    logger: { info: record, warning: record, error: record, debug: record },
    lines,
  };
}

/** Install a fetch mock that replays `responses` and records request bodies. */
function mockFetch(responses: ChatResponse[]): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  const queue = [...responses];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      const next = queue.shift();
      return { ok: true, status: 200, json: async () => next, text: async () => '' };
    }),
  );
  return { bodies };
}

function toolCallTurn(
  totalTokens: number,
  content: string | null = null,
  reasoning?: string,
): ChatResponse {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
          ...(reasoning ? { reasoning } : {}),
          tool_calls: [
            { id: 't1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: totalTokens, completion_tokens: 0, total_tokens: totalTokens },
  };
}

function stopTurn(content: string, totalTokens = 100): ChatResponse {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: totalTokens, completion_tokens: 0, total_tokens: totalTokens },
  };
}

const CLEAN_JSON =
  '```json\n' +
  JSON.stringify({
    findings: [],
    summary: { riskLevel: 'low', overview: 'All good', keyChanges: [] },
  }) +
  '\n```';

function makeClient(maxTokenBudget: number, logger: Logger = silentLogger): OpenAIAgentClient {
  return new OpenAIAgentClient({
    apiKey: 'test',
    baseUrl: 'http://mock.local',
    model: 'test-model',
    maxTurns: 8,
    maxTokenBudget,
    logger,
  });
}

const noopTool = async () => 'ok';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAIAgentClient budget handling', () => {
  it('marks the run incomplete when the budget is exhausted before a verdict', async () => {
    // Turn 1 blows the 1k budget (2k tokens); the summary-retry also yields no JSON.
    mockFetch([toolCallTurn(2000), stopTurn('I could not finish — no JSON.')]);
    const client = makeClient(1000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.stopReason).toBe('budget');
    expect(result.incomplete).toBe(true);
    expect(result.summary).toBeUndefined();
    expect(result.findings).toHaveLength(0);
  }, 15000); // the summary-retry sleeps 3s

  it('marks a naturally-finished run complete (not incomplete)', async () => {
    mockFetch([stopTurn(CLEAN_JSON)]);
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.stopReason).toBe('completed');
    expect(result.incomplete).toBe(false);
    expect(result.summary).toBeDefined();
  });

  it('caps an oversized tool result before feeding it back to the model', async () => {
    const { bodies } = mockFetch([toolCallTurn(100), stopTurn(CLEAN_JSON)]);
    const client = makeClient(1_000_000);
    const hugeOutput = 'X'.repeat(100_000);

    const result = await client.run('sys', 'init', [], async () => hugeOutput);

    expect(result.stopReason).toBe('completed');
    // The second request carries the tool result — it must be truncated.
    const secondRequestMessages = bodies[1].messages as Array<{ role: string; content: string }>;
    const toolMessage = secondRequestMessages.find(m => m.role === 'tool');
    expect(toolMessage).toBeDefined();
    expect(toolMessage!.content.length).toBeLessThan(hugeOutput.length);
    expect(toolMessage!.content.length).toBeLessThanOrEqual(24_100);
    expect(toolMessage!.content).toContain('…[truncated');
  });

  it('forces a JSON verdict (response_format, no tools) once near budget', async () => {
    // Turn 1 crosses the 0.6 wrap-up threshold (7k/10k) but not the hard cap;
    // turn 2 is forced to emit a JSON verdict with no tools.
    const { bodies } = mockFetch([toolCallTurn(7000), stopTurn(CLEAN_JSON, 1000)]);
    const client = makeClient(10_000);
    const tools = [
      { type: 'function', function: { name: 'read_file', description: 'd', parameters: {} } },
    ];

    const result = await client.run('sys', 'init', tools as never, noopTool);

    expect(result.stopReason).toBe('completed');
    expect(result.incomplete).toBe(false);
    expect(bodies[0].tools).toBeDefined(); // turn 1: tools usable
    expect(bodies[0].response_format).toBeUndefined();
    expect(bodies[1].tools).toBeUndefined(); // turn 2 forced: no tools
    expect(bodies[1].response_format).toEqual({ type: 'json_object' });
  });

  it('recovers a verdict via the json-forced summary-retry after a bail', async () => {
    // Loop bails on budget with no verdict; the retry returns raw JSON (as
    // response_format:json_object would) and must be parsed into a summary.
    const rawVerdict = JSON.stringify({
      findings: [],
      summary: { riskLevel: 'low', overview: 'recovered', keyChanges: [] },
    });
    mockFetch([toolCallTurn(2000), stopTurn(rawVerdict, 100)]);
    const client = makeClient(1000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.stopReason).toBe('budget');
    expect(result.incomplete).toBe(false); // retry recovered a verdict
    expect(result.summary?.overview).toBe('recovered');
  }, 15000);

  it('logs the last-turn reasoning when a run is incomplete', async () => {
    const { logger, lines } = capturingLogger();
    const reasoning = 'I am tracing the credit-service lock path for a race condition';
    mockFetch([toolCallTurn(2000, null, reasoning), stopTurn('no json here')]);
    const client = makeClient(1000, logger);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.incomplete).toBe(true);
    expect(lines.some(l => l.includes(reasoning))).toBe(true);
  }, 15000);
});

describe('envDisabled (LIEN_REVIEW_LOG_AGENT parsing — logging on by default)', () => {
  it('disables only for 0/false (case-insensitive)', () => {
    expect(envDisabled('0')).toBe(true);
    expect(envDisabled('false')).toBe(true);
    expect(envDisabled('FALSE')).toBe(true);
  });

  it('stays enabled (not disabled) for everything else, incl. unset', () => {
    expect(envDisabled('1')).toBe(false);
    expect(envDisabled('true')).toBe(false);
    expect(envDisabled('')).toBe(false);
    expect(envDisabled(undefined)).toBe(false);
  });
});

describe('scaleBudgetForBlastRadius', () => {
  it('bumps the budget for critical and high blast radius', () => {
    expect(scaleBudgetForBlastRadius(100_000, 'critical')).toBe(150_000);
    expect(scaleBudgetForBlastRadius(100_000, 'high')).toBe(125_000);
  });

  it('leaves the budget unchanged for low/medium/unknown risk', () => {
    expect(scaleBudgetForBlastRadius(100_000, 'medium')).toBe(100_000);
    expect(scaleBudgetForBlastRadius(100_000, 'low')).toBe(100_000);
    expect(scaleBudgetForBlastRadius(100_000, undefined)).toBe(100_000);
  });

  it('clamps to the shared ceiling', () => {
    expect(scaleBudgetForBlastRadius(200_000, 'critical')).toBe(MAX_REVIEW_TOKEN_BUDGET);
  });
});

describe('scaleAgentBudget — model-aware multiplier', () => {
  // ~40K chars ≈ 10K content tokens; with 5 files (maxTurns 10, toolBudget 80K)
  // base = 4000 + 10000 + 80000 + 2000 = 96000 (within [60K, ceiling], unclamped).
  const chunks = [{ content: 'x'.repeat(40_000) }];

  it('scales the budget up ~1.5x for Kimi vs a lean model', () => {
    const lean = scaleAgentBudget(5, chunks, 'some/lean-model').maxTokenBudget;
    const kimi = scaleAgentBudget(5, chunks, DEFAULT_REVIEW_MODEL).maxTokenBudget;
    expect(lean).toBe(96_000);
    expect(kimi).toBe(144_000);
    expect(kimi).toBe(lean * 1.5);
  });

  it('clamps the scaled budget to the shared ceiling', () => {
    // 15 files → big toolBudget; large content pushes base*1.5 past the ceiling.
    const big = [{ content: 'x'.repeat(400_000) }];
    expect(scaleAgentBudget(15, big, DEFAULT_REVIEW_MODEL).maxTokenBudget).toBe(
      MAX_REVIEW_TOKEN_BUDGET,
    );
  });

  it('always returns an integer budget (the config schema requires int)', () => {
    // 40002 chars → ceil(/4)=10001 → base 96001 (odd); ×1.5 = 144001.5 must round.
    const odd = [{ content: 'x'.repeat(40_002) }];
    const { maxTokenBudget } = scaleAgentBudget(5, odd, DEFAULT_REVIEW_MODEL);
    expect(Number.isInteger(maxTokenBudget)).toBe(true);
    expect(maxTokenBudget).toBe(144_002);
  });

  it('produces a config the agent-review schema accepts', () => {
    // Guards the exact failure a float budget caused: the schema rejects the
    // whole config (dropping the API key), so the agent silently doesn't run.
    const plugin = new AgentReviewPlugin();
    const cfg = {
      apiKey: 'k',
      provider: 'openai' as const,
      model: DEFAULT_REVIEW_MODEL,
      baseUrl: 'http://mock.local',
      inputCostPerMTok: 0.74,
      outputCostPerMTok: 3.5,
      ...scaleAgentBudget(5, [{ content: 'x'.repeat(40_002) }], DEFAULT_REVIEW_MODEL),
    };
    expect(() => plugin.configSchema.parse(cfg)).not.toThrow();
  });
});

describe('AgentReviewPlugin.present — incomplete review', () => {
  function incompleteSummaryFinding(): ReviewFinding {
    const message =
      'Lien Review did not finish — it hit the token budget limit while investigating and ' +
      'stopped before producing a verdict. Any findings shown are partial; re-run the review to retry.';
    return {
      pluginId: 'agent-review',
      filepath: '',
      line: 0,
      severity: 'warning',
      category: 'summary',
      message,
      metadata: { incomplete: true, stopReason: 'budget', overview: message },
    };
  }

  it('surfaces a visible warning instead of a clean review', async () => {
    const plugin = new AgentReviewPlugin();
    const appendDescription = vi.fn();
    const appendSummary = vi.fn();
    const ctx = {
      addAnnotations: vi.fn(),
      appendDescription,
      appendSummary,
    } as unknown as PresentContext;

    await plugin.present([incompleteSummaryFinding()], ctx);

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).toContain('[!WARNING]');
    expect(description).toContain('Review did not complete');
    expect(description).not.toContain('No issues found');
    expect(description).not.toMatch(/Low Risk/);

    const summary = appendSummary.mock.calls[0][0] as string;
    expect(summary).toContain('Review incomplete');
    expect(summary).not.toContain('No issues found');
  });
});

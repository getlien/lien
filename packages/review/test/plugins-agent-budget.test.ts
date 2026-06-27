import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIAgentClient } from '../src/plugins/agent/openai-client.js';
import { AgentReviewPlugin, scaleBudgetForBlastRadius } from '../src/plugins/agent/index.js';
import { silentLogger } from '../src/test-helpers.js';
import type { PresentContext, ReviewFinding } from '../src/plugin-types.js';

// ---------------------------------------------------------------------------
// fetch mock helpers (OpenAI-compatible chat/completions)
// ---------------------------------------------------------------------------

type ChatResponse = {
  choices: Array<{
    message: { role: string; content: string | null; tool_calls?: unknown[] };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

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

function toolCallTurn(totalTokens: number, content: string | null = null): ChatResponse {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
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

function makeClient(maxTokenBudget: number): OpenAIAgentClient {
  return new OpenAIAgentClient({
    apiKey: 'test',
    baseUrl: 'http://mock.local',
    model: 'test-model',
    maxTurns: 8,
    maxTokenBudget,
    logger: silentLogger,
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

  it('clamps to the 200k ceiling', () => {
    expect(scaleBudgetForBlastRadius(180_000, 'critical')).toBe(200_000);
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

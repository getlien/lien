import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Logger } from '../src/logger.js';

// Mock the Anthropic SDK so we can drive the client without a live API.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import {
  AnthropicAgentClient,
  extractThinking,
  requestMaxTokens,
} from '../src/plugins/agent/anthropic-client.js';

function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record = (m: string) => lines.push(m);
  return { logger: { info: record, warning: record, error: record, debug: record }, lines };
}

type Block = Record<string, unknown>;
function msg(content: Block[], inTok: number, outTok: number, stop: string) {
  return { content, usage: { input_tokens: inTok, output_tokens: outTok }, stop_reason: stop };
}
const thinkingBlock = (t: string) => ({ type: 'thinking', thinking: t, signature: 'sig' });
const toolUseBlock = { type: 'tool_use', id: 't1', name: 'read_file', input: {} };
const textBlock = (t: string) => ({ type: 'text', text: t });

const TOOLS = [
  { name: 'read_file', description: 'd', input_schema: { type: 'object', properties: {} } },
];

function makeClient(maxTokenBudget: number, logger: Logger) {
  return new AnthropicAgentClient({
    apiKey: 'test',
    model: 'claude-test',
    maxTurns: 8,
    maxTokenBudget,
    logger,
  });
}

afterEach(() => {
  createMock.mockReset();
});

describe('extractThinking', () => {
  it('returns concatenated thinking-block text', () => {
    expect(extractThinking([thinkingBlock('pondering'), textBlock('hi')] as never)).toBe(
      'pondering',
    );
  });

  it('returns undefined when there are no thinking blocks', () => {
    expect(extractThinking([textBlock('hi')] as never)).toBeUndefined();
  });
});

describe('requestMaxTokens (budget clamp)', () => {
  it('caps to the remaining budget', () => {
    expect(requestMaxTokens(8000)).toBe(8000);
  });
  it('never exceeds the 16k ceiling', () => {
    expect(requestMaxTokens(50_000)).toBe(16_000);
  });
  it('floors above the thinking budget even after a bail (remaining <= 0)', () => {
    expect(requestMaxTokens(0)).toBe(6144);
    expect(requestMaxTokens(-5000)).toBe(6144);
    expect(requestMaxTokens(6144)).toBeGreaterThan(4096); // budget_tokens stays valid
  });
});

describe('AnthropicAgentClient extended thinking + retry forcing', () => {
  it('enables thinking on every request', async () => {
    createMock.mockResolvedValueOnce(
      msg(
        [
          textBlock(
            '```json\n{"findings":[],"summary":{"riskLevel":"low","overview":"ok","keyChanges":[]}}\n```',
          ),
        ],
        100,
        50,
        'end_turn',
      ),
    );
    const { logger } = capturingLogger();
    await makeClient(1_000_000, logger).run('sys', 'init', TOOLS as never, async () => 'ok');

    expect(createMock.mock.calls[0][0].thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });

  it('captures reasoning from thinking blocks and surfaces it on an incomplete run', async () => {
    // Turn 1 blows the budget while thinking; retry yields no JSON → incomplete.
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('tracing the lock path'), toolUseBlock], 2000, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(msg([textBlock('could not finish')], 100, 0, 'end_turn'));
    const { logger, lines } = capturingLogger();

    const result = await makeClient(1000, logger).run(
      'sys',
      'init',
      TOOLS as never,
      async () => 'ok',
    );

    expect(result.incomplete).toBe(true);
    expect(lines.some(l => l.includes('tracing the lock path'))).toBe(true);
  }, 15000);

  it('injects the wrap-up nudge as a valid text block and completes on the forced turn', async () => {
    const verdict =
      '```json\n{"findings":[],"summary":{"riskLevel":"low","overview":"ok","keyChanges":[]}}\n```';
    // Turn 1 crosses the 0.6 wrap-up threshold (70k/100k) but not the hard cap;
    // turn 2 is the forced wrap-up turn.
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 70_000, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(msg([textBlock(verdict)], 100, 50, 'end_turn'));
    const { logger } = capturingLogger();

    const result = await makeClient(100_000, logger).run(
      'sys',
      'init',
      TOOLS as never,
      async () => 'ok',
    );

    expect(result.stopReason).toBe('completed');
    expect(result.incomplete).toBe(false);
    // Forced turn forbids tools.
    expect(createMock.mock.calls[1][0].tool_choice).toEqual({ type: 'none' });
    // The wrap-up user turn mixes tool_result + a text nudge (no unsafe cast,
    // a valid Anthropic content array — this path was previously untested).
    const forced = createMock.mock.calls[1][0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    const mixed = forced.find(
      m =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some((b: { type: string }) => b.type === 'tool_result') &&
        m.content.some((b: { type: string }) => b.type === 'text'),
    );
    expect(mixed).toBeDefined();
  }, 15000);

  it('forces the retry with tool_choice:none + thinking (parity with the loop)', async () => {
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 2000, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(msg([textBlock('no verdict')], 100, 0, 'end_turn'));
    const { logger } = capturingLogger();

    await makeClient(1000, logger).run('sys', 'init', TOOLS as never, async () => 'ok');

    const retryArgs = createMock.mock.calls[1][0];
    expect(retryArgs.tool_choice).toEqual({ type: 'none' });
    expect(retryArgs.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
    expect(retryArgs.tools).toBeDefined();
  }, 15000);
});

describe('AnthropicAgentClient never-ran (terminal API failure)', () => {
  it('returns a never-ran result instead of propagating the throw', async () => {
    // An overdrawn account: the SDK exhausts its own retries and throws. A
    // propagated throw would be silently dropped by the engine's
    // Promise.allSettled — letting a starved review read as clean — so the
    // client must catch it and return a neverRan result with zero completed
    // turns and no summary.
    createMock.mockRejectedValue(new Error('402 Insufficient credits'));
    const { logger } = capturingLogger();

    const result = await makeClient(1_000_000, logger).run(
      'sys',
      'init',
      TOOLS as never,
      async () => 'ok',
    );

    expect(result.neverRan).toBe(true);
    expect(result.incomplete).toBe(true);
    expect(result.turns).toBe(0);
    expect(result.summary).toBeUndefined();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toContain('402');
    // No summary-retry: with no lastResponse there is nothing to summarize.
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

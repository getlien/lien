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

  it('stops with stopReason=budget (not completed) when a naturally-finishing turn already meets the allocation (issue #839 between-turn check)', async () => {
    // Parity with the OpenAI client's same fix: `stop_reason:'end_turn'` was
    // checked BEFORE the cumulative-budget check, so a turn that both
    // finished naturally AND blew the budget was misreported as a clean
    // 'completed'. One turn alone (6,000 input tokens) already exceeds the
    // 5,000-token budget.
    const verdict =
      '```json\n{"findings":[],"summary":{"riskLevel":"low","overview":"ok","keyChanges":[]}}\n```';
    createMock.mockResolvedValueOnce(msg([textBlock(verdict)], 6_000, 0, 'end_turn'));
    const { logger } = capturingLogger();

    const result = await makeClient(5_000, logger).run(
      'sys',
      'init',
      TOOLS as never,
      async () => 'ok',
    );

    expect(result.stopReason).toBe('budget');
    expect(result.incomplete).toBe(false);
    expect(result.summary).toBeDefined();
    expect(result.turns).toBe(1);
  });

  it('bounds a multi-turn context-accumulation overshoot to the turn that crossed the line (issue #839)', async () => {
    // Mirrors the shape of the OpenAI client's same test: two ordinary
    // tool_use turns stay under budget, crossing the 0.6 wrap-up threshold on
    // turn 2 (forcing turn 3 to drop tools) — then the forced turn's own
    // (unbounded) input cost is what actually blows the budget.
    const verdict =
      '```json\n{"findings":[],"summary":{"riskLevel":"low","overview":"ok","keyChanges":[]}}\n```';
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 9_000, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(
        msg([thinkingBlock('still investigating'), toolUseBlock], 4_000, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(msg([textBlock(verdict)], 40_000, 0, 'end_turn'));
    const { logger } = capturingLogger();

    const result = await makeClient(20_000, logger).run(
      'sys',
      'init',
      TOOLS as never,
      async () => 'ok',
    );

    expect(result.stopReason).toBe('budget');
    expect(result.incomplete).toBe(false);
    expect(result.turns).toBe(3);
    // Bounded to the third turn's own cost — no fourth request attempted.
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it('forces wrap-up after a single turn whose own input already exhausts remaining budget — BEFORE the coarser near-budget fraction would fire (issue #839 input-growth check)', async () => {
    // Parity with the OpenAI client's same fix. Turn 1's own input (11,500)
    // leaves cumulative spend at 11,500 — still UNDER the 0.6 wrap-up
    // fraction (12,000 on a 20,000 budget), so the pre-#839 near-budget-only
    // check would NOT yet force a wrap-up. The input-growth check catches it
    // a turn earlier: remaining budget (8,500) can't even cover a repeat of
    // turn 1's own input, so turn 2 is forced to drop tools and emit its
    // verdict right away.
    //
    // Turn 2's own input (13,000) is deliberately >= turn 1's (11,500): the
    // client re-sends the FULL conversation history every request (`messages`
    // is append-only, never trimmed), so a real turn's input_tokens can never
    // be smaller than the turn before it. A non-monotonic mock here would
    // assert a physically impossible sequence.
    const verdict =
      '```json\n{"findings":[],"summary":{"riskLevel":"low","overview":"ok","keyChanges":[]}}\n```';
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 11_500, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(msg([textBlock(verdict)], 13_000, 0, 'end_turn'));
    const { logger, lines } = capturingLogger();

    const result = await makeClient(20_000, logger).run(
      'sys',
      'init',
      TOOLS as never,
      async () => 'ok',
    );

    expect(result.turns).toBe(2);
    expect(createMock.mock.calls[1][0].tool_choice).toEqual({ type: 'none' }); // forced-finish
    expect(createMock).toHaveBeenCalledTimes(2); // verdict recovered directly — no summary-retry needed
    // Even the forced turn's own (still budget-blind) input cost (13,000) is
    // enough, on top of turn 1's 11,500, to cross the 20,000 budget — the
    // true benefit is NOT a smaller total spend (this fix cannot shrink a
    // turn's own real cost), it's that the model was cut off ONE
    // investigative round-trip earlier than the pre-#839 near-budget check
    // alone would have allowed, and still produced a clean, directly-
    // recovered verdict.
    expect(result.usage.totalTokens).toBe(24_500);
    expect(result.stopReason).toBe('budget');
    expect(result.incomplete).toBe(false); // verdict parsed cleanly despite the budget stop
    expect(result.summary).toBeDefined();
    expect(lines.some(l => l.includes('input-growth check'))).toBe(true);
  });

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

// ---------------------------------------------------------------------------
// #792's 3-vote screen: a natural-stop turn corrupted at the wire ("wholesale-
// corrupted stop-turn", e.g. `{"findings":":[{",": ":", "}` — syntactically
// valid JSON but shaped wrong, so extraction correctly rejects it) triggers
// the existing summary-retry, same as any other missing-verdict bail. These
// tests cover the NEW bounded second attempt inside that retry — parity with
// the OpenAI client's fix for the same canary.
// ---------------------------------------------------------------------------
describe('AnthropicAgentClient — bounded second retry attempt for corrupted stop-turns (#792)', () => {
  const CORRUPTED_STOP_TURN = '{"findings":":[{",": ":", "}';
  const CLEAN_JSON =
    '```json\n{"findings":[],"summary":{"riskLevel":"low","overview":"recovered","keyChanges":[]}}\n```';

  it('makes a bounded second attempt when the first retry is also corrupted, and recovers', async () => {
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 100, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(msg([textBlock(CORRUPTED_STOP_TURN)], 50, 0, 'end_turn'))
      .mockResolvedValueOnce(msg([textBlock(CORRUPTED_STOP_TURN)], 50, 0, 'end_turn'))
      .mockResolvedValueOnce(msg([textBlock(CLEAN_JSON)], 50, 0, 'end_turn'));
    const { logger } = capturingLogger();

    const result = await makeClient(1_000_000, logger).run(
      'sys',
      'init',
      TOOLS as never,
      async () => 'ok',
    );

    expect(result.incomplete).toBe(false);
    expect(result.summary?.overview).toBe('recovered');
    expect(createMock).toHaveBeenCalledTimes(4);
  });

  it('surfaces incomplete (not a silent clean review) when both retry attempts stay corrupted', async () => {
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 100, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(msg([textBlock(CORRUPTED_STOP_TURN)], 50, 0, 'end_turn'))
      .mockResolvedValueOnce(msg([textBlock(CORRUPTED_STOP_TURN)], 50, 0, 'end_turn'))
      .mockResolvedValueOnce(msg([textBlock(CORRUPTED_STOP_TURN)], 50, 0, 'end_turn'));
    const { logger } = capturingLogger();

    const result = await makeClient(1_000_000, logger).run(
      'sys',
      'init',
      TOOLS as never,
      async () => 'ok',
    );

    expect(result.incomplete).toBe(true);
    expect(result.summary).toBeUndefined();
    expect(result.findings).toHaveLength(0);
  });

  it('is bounded — exactly 4 calls total, not an open retry loop', async () => {
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 100, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(msg([textBlock(CORRUPTED_STOP_TURN)], 50, 0, 'end_turn'))
      .mockResolvedValueOnce(msg([textBlock(CORRUPTED_STOP_TURN)], 50, 0, 'end_turn'))
      .mockResolvedValueOnce(msg([textBlock(CORRUPTED_STOP_TURN)], 50, 0, 'end_turn'));
    const { logger } = capturingLogger();

    await makeClient(1_000_000, logger).run('sys', 'init', TOOLS as never, async () => 'ok');

    expect(createMock).toHaveBeenCalledTimes(4);
  });

  it('logs a warning naming the bounded second-attempt retry', async () => {
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 100, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(msg([textBlock(CORRUPTED_STOP_TURN)], 50, 0, 'end_turn'))
      .mockResolvedValueOnce(msg([textBlock(CORRUPTED_STOP_TURN)], 50, 0, 'end_turn'))
      .mockResolvedValueOnce(msg([textBlock(CLEAN_JSON)], 50, 0, 'end_turn'));
    const { logger, lines } = capturingLogger();

    await makeClient(1_000_000, logger).run('sys', 'init', TOOLS as never, async () => 'ok');

    expect(lines.some(l => l.includes('attempting one more bounded retry'))).toBe(true);
  });

  it('does not make a second attempt when the first retry already recovers a verdict', async () => {
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 100, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(msg([textBlock(CORRUPTED_STOP_TURN)], 50, 0, 'end_turn'))
      .mockResolvedValueOnce(msg([textBlock(CLEAN_JSON)], 50, 0, 'end_turn'));
    const { logger } = capturingLogger();

    const result = await makeClient(1_000_000, logger).run(
      'sys',
      'init',
      TOOLS as never,
      async () => 'ok',
    );

    expect(result.incomplete).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Issue #829's truncation remainder (post-#895's require_parameters fix): the
// summary-retry must send a SLIM message list — just the last investigative
// turn's own text + the instruction — not the full accumulated tool_use/
// tool_result history. See `buildSlimRetryPrompt` (agent-client-shared.ts)
// for the deterministic construction these pin at the wire level.
// ---------------------------------------------------------------------------
describe('AnthropicAgentClient — slim summary-retry context (#829 truncation remainder)', () => {
  it('sends only a single user message on the retry — not the accumulated tool_use/tool_result history', async () => {
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 100, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(
        msg([thinkingBlock('more investigating'), toolUseBlock], 100, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(
        msg([textBlock('Issue 1: looks suspicious. No JSON yet.')], 50, 0, 'end_turn'),
      )
      .mockResolvedValueOnce(
        msg(
          [
            textBlock(
              '```json\n{"findings":[],"summary":{"riskLevel":"low","overview":"recovered","keyChanges":[]}}\n```',
            ),
          ],
          50,
          0,
          'end_turn',
        ),
      );
    const { logger } = capturingLogger();

    const result = await makeClient(1_000_000, logger).run(
      'sys',
      'init',
      TOOLS as never,
      async () => 'ok',
    );

    expect(result.incomplete).toBe(false);
    const retryArgs = createMock.mock.calls[3][0]; // 3 main-loop turns, retry is call 4
    const retryMessages = retryArgs.messages as Array<{ role: string; content: unknown }>;
    expect(retryMessages).toHaveLength(1);
    expect(retryMessages[0].role).toBe('user');
    // No dummy tool_result / assistant tool_use replay — the fresh list has
    // no pending tool_use to satisfy in the first place.
    expect((retryMessages[0].content as Array<{ type: string }> | string).toString()).not.toContain(
      'tool_result',
    );
  });

  it("carries the last investigative turn's own text into the retry prompt", async () => {
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 100, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(
        msg([textBlock('Issue 1: a real concern about null handling.')], 50, 0, 'end_turn'),
      )
      .mockResolvedValueOnce(
        msg(
          [
            textBlock(
              '```json\n{"findings":[],"summary":{"riskLevel":"low","overview":"recovered","keyChanges":[]}}\n```',
            ),
          ],
          50,
          0,
          'end_turn',
        ),
      );
    const { logger } = capturingLogger();

    await makeClient(1_000_000, logger).run('sys', 'init', TOOLS as never, async () => 'ok');

    const retryArgs = createMock.mock.calls[2][0];
    expect(retryArgs.messages[0].content).toContain('Issue 1: a real concern about null handling.');
    expect(retryArgs.messages[0].content).toContain('You ran out of budget');
  });

  it('marks the retry-produced trace turns with slimRetry: true', async () => {
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 100, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(msg([textBlock('no verdict here')], 50, 0, 'end_turn'))
      .mockResolvedValueOnce(
        msg(
          [
            textBlock(
              '```json\n{"findings":[],"summary":{"riskLevel":"low","overview":"recovered","keyChanges":[]}}\n```',
            ),
          ],
          50,
          0,
          'end_turn',
        ),
      );
    const { logger } = capturingLogger();

    const result = await makeClient(1_000_000, logger).run(
      'sys',
      'init',
      TOOLS as never,
      async () => 'ok',
    );

    const retryTurns = result.trace!.turns.filter(t => t.slimRetry);
    expect(retryTurns).toHaveLength(1);
    expect(result.trace!.turns[0].slimRetry).toBeUndefined();
  });

  it('logs that the retry is slim (diagnosable in CI logs, distinct from the old flat message)', async () => {
    createMock
      .mockResolvedValueOnce(
        msg([thinkingBlock('investigating'), toolUseBlock], 100, 0, 'tool_use'),
      )
      .mockResolvedValueOnce(msg([textBlock('no verdict here')], 50, 0, 'end_turn'))
      .mockResolvedValueOnce(
        msg(
          [
            textBlock(
              '```json\n{"findings":[],"summary":{"riskLevel":"low","overview":"recovered","keyChanges":[]}}\n```',
            ),
          ],
          50,
          0,
          'end_turn',
        ),
      );
    const { logger, lines } = capturingLogger();

    await makeClient(1_000_000, logger).run('sys', 'init', TOOLS as never, async () => 'ok');

    expect(lines.some(l => l.includes('slim retry'))).toBe(true);
  });

  // Adversarial-review finding F3: the LAST loop turn alone can be bare (a
  // pure tool_use turn with no text and no thinking) when the loop ends
  // right at max_turns — reading only that turn used to feed the retry zero
  // real context (false-clean risk). End-to-end proof the fix reaches back
  // through turn history via the real client loop, not just the shared
  // helper in isolation.
  it("falls back to an earlier turn's own text for the retry when the turn right before max_turns is bare (#829 F3)", async () => {
    createMock
      .mockResolvedValueOnce(
        msg(
          [thinkingBlock('Issue 1: a real concern about null handling.'), toolUseBlock],
          100,
          0,
          'tool_use',
        ),
      )
      .mockResolvedValueOnce(msg([toolUseBlock], 100, 0, 'tool_use')) // bare: no text, no thinking
      .mockResolvedValueOnce(
        msg(
          [
            textBlock(
              '```json\n{"findings":[],"summary":{"riskLevel":"low","overview":"recovered","keyChanges":[]}}\n```',
            ),
          ],
          50,
          0,
          'end_turn',
        ),
      );
    const { logger } = capturingLogger();
    const client = new AnthropicAgentClient({
      apiKey: 'test',
      model: 'claude-test',
      maxTurns: 2,
      maxTokenBudget: 1_000_000,
      logger,
    });

    const result = await client.run('sys', 'init', TOOLS as never, async () => 'ok');

    expect(result.incomplete).toBe(false);
    const retryArgs = createMock.mock.calls[2][0];
    expect(retryArgs.messages[0].content).toContain('Issue 1: a real concern about null handling.');
  });
});

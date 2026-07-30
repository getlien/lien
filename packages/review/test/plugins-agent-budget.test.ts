import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  OpenAIAgentClient,
  envDisabled,
  retryMaxTokens,
} from '../src/plugins/agent/openai-client.js';
import {
  AgentReviewPlugin,
  appendIncompleteNotice,
  scaleBudgetForBlastRadius,
  clampText,
  hasProviderFailure,
  hasIncompleteMainPass,
} from '../src/plugins/agent/index.js';
import { scaleAgentBudget, resolveAgentBudget, summaryOnlyEligibleFor } from '../src/review-pr.js';
import type { ReviewCoreContext } from '../src/review-pr.js';
import {
  DEFAULT_REVIEW_MODEL,
  MAX_REVIEW_TOKEN_BUDGET,
  REVIEW_TOKEN_BUDGET_MULTIPLIERS,
  REVIEW_TOKEN_BUDGET_OVERRIDE_ENV,
  MIN_REVIEW_TOKEN_BUDGET_OVERRIDE,
  MAX_REVIEW_TOKEN_BUDGET_OVERRIDE,
  applyReviewTokenBudgetOverride,
} from '../src/defaults.js';
import { silentLogger, createTestContext } from '../src/test-helpers.js';
import type { Logger } from '../src/logger.js';
import type { PresentContext, ReviewFinding, ReviewContext } from '../src/plugin-types.js';
import type { AgentResult } from '../src/plugins/agent/types.js';
import type { PRContext } from '../src/types.js';

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

/**
 * Install a fetch mock that replays `responses` and records request bodies.
 * A `null` queue entry simulates a transient empty 200 body (provider hiccup) —
 * the client reads `response.text()`, so it serializes each response there.
 */
function mockFetch(responses: Array<ChatResponse | null>): {
  bodies: Array<Record<string, unknown>>;
} {
  const bodies: Array<Record<string, unknown>> = [];
  const queue = [...responses];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      const next = queue.shift();
      const text = next == null ? '' : JSON.stringify(next);
      return { ok: true, status: 200, json: async () => next, text: async () => text };
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
    expect(toolMessage!.content.length).toBeLessThanOrEqual(16_100);
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
    // Investigation turn reasons hard; the forced-verdict turn drops to low
    // effort (findings already decided) so it emits the JSON without rambling.
    expect(bodies[0].reasoning).toEqual({ effort: 'high' });
    expect(bodies[1].reasoning).toEqual({ effort: 'low' });
    // Turn 1 (not forced) is ALSO budget-scaled as of #836: remaining budget
    // at turn 1 (10,000, nothing spent yet) exceeds the flat 24,576 ceiling's
    // ORDINARY_TURN_MIN_MAX_TOKENS floor (8,192), so the remaining-budget
    // value itself wins — 10,000, not the flat ceiling. See
    // `turnMaxTokens`'s own doc comment for why (a gap that let a single
    // ordinary turn overspend a small extra-pass budget several times over).
    expect(bodies[0].max_tokens).toBe(10_000);
  });

  it('bounds the in-loop forced-finish turn to remaining budget (#825 overshoot fix)', async () => {
    // Same shape as "forces a JSON verdict...once near budget" above, but
    // this asserts the WIRE-LEVEL fix: before this fix, the forced-finish
    // turn (bodies[1]) requested the flat 24,576 ceiling regardless of how
    // little budget (10,000 - 7,000 = 3,000) remained. PR #825's doc-truth
    // pass hit exactly this gap — its forced-finish turn's uncapped request
    // pushed total spend to 117,724/100,000 (+18%), then finished with
    // finish_reason:'stop' (stopReason 'completed' below), which exits the
    // loop *before* the post-response budget check ever runs — a silent
    // overshoot never flagged as budget-starved.
    const { bodies } = mockFetch([toolCallTurn(7000), stopTurn(CLEAN_JSON, 1000)]);
    const client = makeClient(10_000);
    const tools = [
      { type: 'function', function: { name: 'read_file', description: 'd', parameters: {} } },
    ];

    const result = await client.run('sys', 'init', tools as never, noopTool);

    expect(result.stopReason).toBe('completed'); // matches #825: completed, not flagged starved
    // Turn 1 (not forced) is ALSO budget-scaled as of #836 (see the test
    // above) — 10,000, not the pre-#836 flat 24,576 ceiling.
    expect(bodies[0].max_tokens).toBe(10_000);
    expect(bodies[1].max_tokens).toBe(3_000); // forced-finish turn: capped to remaining budget
  });

  it('floors the in-loop forced-finish turn at 2,048 when remaining budget is tiny (#825)', async () => {
    // Turn 1 (6,800 tokens) crosses the 0.6 wrap-up threshold on a 7,000
    // budget but stays under the hard cap, leaving only 200 tokens of
    // budget for the forced-finish turn — below RETRY_MIN_MAX_TOKENS, so it
    // must floor at 2,048 (parity with the retry's own floor, #811) rather
    // than request a near-zero or negative max_tokens.
    const { bodies } = mockFetch([toolCallTurn(6_800), stopTurn(CLEAN_JSON, 100)]);
    const client = makeClient(7_000);
    const tools = [
      { type: 'function', function: { name: 'read_file', description: 'd', parameters: {} } },
    ];

    await client.run('sys', 'init', tools as never, noopTool);

    // Turn 1 (not forced) is ALSO scaled down here (#836): remaining budget
    // (7,000) is itself below ORDINARY_TURN_MIN_MAX_TOKENS (8,192), so the
    // floor wins — a small-extra-pass-budget case where the ordinary-turn
    // ceiling binds even before any forced-finish turn is ever reached.
    expect(bodies[0].max_tokens).toBe(8_192);
    expect(bodies[1].max_tokens).toBe(2_048);
  });

  it('stops with stopReason=budget (not completed) when a naturally-finishing turn already meets the allocation (issue #839 between-turn check)', async () => {
    // Before this fix, `finish_reason:'stop'` was checked BEFORE the
    // cumulative-budget check, so a turn that both finished naturally AND
    // blew the budget was misreported as a clean 'completed' — a silent
    // overshoot never flagged as budget-starved (the same gap #825's own PR
    // body diagnosed but only partially closed, since it only bounded that
    // turn's OUTPUT, not this classification bug). One turn alone (6,000
    // tokens, all input — e.g. a large pre-fetched worklist) already exceeds
    // the 5,000-token budget; the between-turn check must catch this at this
    // turn's own boundary, not let the natural 'stop' branch hide it.
    mockFetch([stopTurn(CLEAN_JSON, 6_000)]);
    const client = makeClient(5_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.stopReason).toBe('budget');
    // Accounting for whether a verdict was actually produced stays
    // independent of stopReason: the turn's JSON parsed cleanly, so this
    // run is NOT incomplete even though it's flagged budget-starved for
    // attestation purposes — the same coexistence already covered by
    // "recovers a verdict via the json-forced summary-retry" below.
    expect(result.incomplete).toBe(false);
    expect(result.summary).toBeDefined();
    expect(result.turns).toBe(1);
  });

  it('bounds a multi-turn context-accumulation overshoot to the turn that crossed the line — no further turn is attempted (issue #839)', async () => {
    // Mirrors the real doc-truth receipt from issue #839's census (20,869
    // allocated / 56,430 spent, ~2.7x): two ordinary tool-calling turns stay
    // comfortably under budget, crossing the 0.6 wrap-up threshold on turn 2
    // (forcing turn 3 to drop tools and emit its verdict) — then the forced
    // turn's OWN input cost (the now much larger accumulated conversation
    // history, unbounded by max_tokens) is what actually blows the budget,
    // ending the run in a single, naturally-completing turn.
    const { bodies } = mockFetch([
      toolCallTurn(9_000),
      toolCallTurn(4_000), // cumulative 13,000 >= 0.6*20,000 — forces turn 3
      stopTurn(CLEAN_JSON, 40_000), // cumulative 53,000 — 2.65x the 20,000 budget
    ]);
    const client = makeClient(20_000);
    const tools = [
      { type: 'function', function: { name: 'read_file', description: 'd', parameters: {} } },
    ];

    const result = await client.run('sys', 'init', tools as never, noopTool);

    expect(result.stopReason).toBe('budget');
    expect(result.incomplete).toBe(false); // the forced turn's verdict still parsed cleanly
    expect(result.turns).toBe(3);
    // The overshoot is bounded to what the THIRD turn alone cost — no fourth
    // request is ever attempted once that turn's own boundary check fires.
    expect(bodies).toHaveLength(3);
  });

  it('forces wrap-up after a single turn whose own input already exhausts remaining budget — BEFORE the coarser near-budget fraction would fire (issue #839 input-growth check)', async () => {
    // A large pre-rendered worklist can make even turn 1's own input cost
    // most of a small extra-pass budget. Turn 1's input (11,500) leaves
    // cumulative spend at 11,500 — still UNDER the 0.6 wrap-up fraction
    // (12,000 on a 20,000 budget), so the pre-#839 near-budget-only check
    // would NOT yet force a wrap-up and would let turn 2 keep investigating
    // (growing conversation history further before any forced-finish turn).
    // The input-growth check catches it a turn earlier: remaining budget
    // (8,500) can't even cover a repeat of turn 1's own input, so turn 2 is
    // forced to drop tools and emit its verdict right away.
    //
    // Turn 2's own input (13,000) is deliberately >= turn 1's (11,500): the
    // client re-sends the FULL conversation history every request (`messages`
    // is append-only, never trimmed — see TOOL_RESULT_MAX_CHARS's per-call cap
    // but no whole-history trim), so a real turn's prompt_tokens can never be
    // smaller than the turn before it. A non-monotonic mock here would assert
    // a physically impossible sequence and manufacture a rosier outcome than a
    // real run could produce.
    const { bodies } = mockFetch([toolCallTurn(11_500), stopTurn(CLEAN_JSON, 13_000)]);
    const { logger, lines } = capturingLogger();
    const client = makeClient(20_000, logger);
    const tools = [
      { type: 'function', function: { name: 'read_file', description: 'd', parameters: {} } },
    ];

    const result = await client.run('sys', 'init', tools as never, noopTool);

    expect(result.turns).toBe(2);
    expect(bodies[1].tools).toBeUndefined(); // forced-finish: no tools offered
    expect(bodies[1].response_format).toEqual({ type: 'json_object' });
    expect(bodies).toHaveLength(2); // verdict recovered from the forced turn itself — no summary-retry needed
    // Even the forced turn's own (still budget-blind) input cost (13,000) is
    // enough, on top of turn 1's 11,500, to cross the 20,000 budget — the
    // true benefit here is NOT a smaller total spend (this input-growth fix
    // cannot shrink a turn's own real cost, only decide sooner whether to risk
    // another one), it's that the model was cut off ONE investigative
    // round-trip earlier than the pre-#839 near-budget check alone would have
    // allowed, and still produced a clean, directly-recovered verdict.
    expect(result.usage.totalTokens).toBe(24_500);
    expect(result.stopReason).toBe('budget');
    expect(result.incomplete).toBe(false); // verdict parsed cleanly despite the budget stop
    expect(result.summary).toBeDefined();
    expect(lines.some(l => l.includes('input-growth check'))).toBe(true);
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

  it('caps the summary-retry request to a small bounded max_tokens on a starved bail (#811)', async () => {
    // Same starved shape as the test above, but this asserts the WIRE-LEVEL
    // fix: turn 1 (2000 tokens) already blows the 1000-token budget, so the
    // retry's remainingBudget is deeply negative — its request must carry
    // the floored RETRY_MIN_MAX_TOKENS (2048), not the old flat 24,576.
    const rawVerdict = JSON.stringify({
      findings: [],
      summary: { riskLevel: 'low', overview: 'recovered', keyChanges: [] },
    });
    const { bodies } = mockFetch([toolCallTurn(2000), stopTurn(rawVerdict, 100)]);
    const client = makeClient(1000);

    await client.run('sys', 'init', [], noopTool);

    // Turn 1 (not forced) is ALSO scaled down here (#836): remaining budget
    // (1,000) is below ORDINARY_TURN_MIN_MAX_TOKENS (8,192), so the floor
    // wins — not the pre-#836 flat 24,576 ceiling.
    expect(bodies[0].max_tokens).toBe(8_192);
    expect(bodies[1].max_tokens).toBe(2_048); // the retry: capped to the floor
  }, 15000);

  it('keeps the retry at the normal 24,576 ceiling when ample budget remains (no regression)', async () => {
    // Forces the retry via max_turns (not budget) with a huge budget, so
    // remainingBudget is deeply positive — the #792 suite below also uses a
    // huge budget, but doesn't assert on max_tokens directly, so this makes
    // the "unaffected when not starved" claim explicit for the retry path.
    const rawVerdict = JSON.stringify({
      findings: [],
      summary: { riskLevel: 'low', overview: 'recovered', keyChanges: [] },
    });
    const { bodies } = mockFetch([toolCallTurn(100), stopTurn(rawVerdict, 50)]);
    const client = new OpenAIAgentClient({
      apiKey: 'test',
      baseUrl: 'http://mock.local',
      model: 'test-model',
      maxTurns: 1,
      maxTokenBudget: 1_000_000,
      logger: silentLogger,
    });

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.summary?.overview).toBe('recovered'); // retry did fire and recover
    expect(bodies[1].max_tokens).toBe(24_576);
  });

  it('logs the last-turn reasoning when a run is incomplete', async () => {
    const { logger, lines } = capturingLogger();
    const reasoning = 'I am tracing the credit-service lock path for a race condition';
    mockFetch([toolCallTurn(2000, null, reasoning), stopTurn('no json here')]);
    const client = makeClient(1000, logger);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.incomplete).toBe(true);
    expect(lines.some(l => l.includes(reasoning))).toBe(true);
  }, 15000);

  it('flags a stop turn with no parseable verdict incomplete (no silent clean)', async () => {
    // The model ends with finish_reason:'stop' (stopReason 'completed') but emits
    // prose, not findings JSON; the summary-retry also yields prose. A verdict was
    // never produced, so the run must be incomplete — NOT a clean 0-findings review
    // (the old `stopReason !== 'completed'` guard let this through silently).
    mockFetch([stopTurn('I reviewed the changes; looks fine.'), stopTurn('Still no JSON, sorry.')]);
    const client = makeClient(1_000_000); // generous budget — the model just stops early

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.stopReason).toBe('completed');
    expect(result.summary).toBeUndefined();
    expect(result.incomplete).toBe(true);
  }, 15000); // the summary-retry sleeps 3s

  it('recovers a JSON verdict embedded in surrounding prose', async () => {
    // The model ignored json_object and wrapped the verdict in reasoning prose.
    // Lenient extraction must recover it on the same turn (no retry needed).
    const verdict = JSON.stringify({
      findings: [],
      summary: { riskLevel: 'low', overview: 'wrapped', keyChanges: [] },
    });
    mockFetch([stopTurn(`Here is my analysis.\n${verdict}\nThat's everything.`)]);
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.incomplete).toBe(false);
    expect(result.summary?.overview).toBe('wrapped');
  });

  it('prefers the real verdict over an earlier example JSON block', async () => {
    // The model echoes a few-shot example ```json block, then its real verdict.
    // The OLD first-fence logic would return the example; we must pick the last.
    const example =
      '```json\n' +
      JSON.stringify({
        findings: [
          {
            filepath: 'x.ts',
            line: 1,
            severity: 'warning',
            category: 'logic_error',
            message: 'eg',
          },
        ],
        summary: { riskLevel: 'high', overview: 'EXAMPLE', keyChanges: [] },
      }) +
      '\n```';
    const real =
      '```json\n' +
      JSON.stringify({
        findings: [],
        summary: { riskLevel: 'low', overview: 'REAL', keyChanges: [] },
      }) +
      '\n```';
    mockFetch([stopTurn(`Here is the format:\n${example}\n\nMy actual review:\n${real}`)]);
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.summary?.overview).toBe('REAL');
    expect(result.findings).toHaveLength(0);
  });

  it('retries a transient empty response body instead of crashing', async () => {
    // A 200 with an empty body makes response.json() throw "Unexpected end of
    // JSON input" — previously that crashed the whole agent-review. The client
    // must retry and recover, not throw.
    mockFetch([null, stopTurn(CLEAN_JSON)]); // turn 1: empty body, then a valid verdict
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.stopReason).toBe('completed');
    expect(result.summary).toBeDefined();
    expect(result.incomplete).toBe(false);
  });

  it('retries when fetch itself rejects (network error / timeout)', async () => {
    // `fetch failed` (a network error or an aborted hung connection) rejects
    // before any response — previously this crashed the review. Retry & recover.
    let calls = 0;
    const ok = stopTurn(CLEAN_JSON);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        if (calls === 1) throw new TypeError('fetch failed');
        return {
          ok: true,
          status: 200,
          json: async () => ok,
          text: async () => JSON.stringify(ok),
        };
      }),
    );
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(calls).toBeGreaterThanOrEqual(2); // retried after the rejection
    expect(result.stopReason).toBe('completed');
    expect(result.summary).toBeDefined();
  });

  it('degrades to an incomplete review when chat requests keep failing', async () => {
    // Persistent network failure: after retries exhaust, the run ends gracefully
    // as incomplete (surfacing a "did not finish" notice), not a plugin crash.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.incomplete).toBe(true);
    expect(result.summary).toBeUndefined();
  }, 20000); // retries + the summary-retry's own attempts/sleep

  it('marks a credit-starved run never-ran (402 on every request), not a clean review', async () => {
    // The exact #737 signature: an overdrawn account 402s on every request. A
    // non-429/non-5xx 4xx is a fatal throw (no retry), so no turn ever completes.
    // The run must report neverRan with ZERO completed turns and no summary — an
    // infrastructure failure, not a misleading "0 findings in 1 turns".
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return {
          ok: false,
          status: 402,
          text: async () => '{"error":{"message":"Insufficient credits"}}',
        };
      }),
    );
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.neverRan).toBe(true);
    expect(result.incomplete).toBe(true);
    expect(result.turns).toBe(0);
    expect(result.summary).toBeUndefined();
    expect(result.findings).toHaveLength(0);
    expect(result.errorMessage).toContain('402');
    // Zero completed turns ⇒ the doomed summary-retry is skipped (one call only).
    expect(calls).toBe(1);
  });

  it('does NOT mark a partial run (a turn completed, then failures) never-ran', async () => {
    // Turn 1 completes with tool_calls; the next request (and its retries) fail.
    // A turn ran, so this is a PARTIAL incomplete — fail-open — not never-ran.
    let calls = 0;
    const ok = toolCallTurn(100);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        if (calls === 1) return { ok: true, status: 200, text: async () => JSON.stringify(ok) };
        throw new TypeError('fetch failed');
      }),
    );
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.incomplete).toBe(true);
    expect(result.neverRan).toBe(false);
    expect(result.turns).toBeGreaterThanOrEqual(1);
  }, 20000);
});

// ---------------------------------------------------------------------------
// Ordinary (non-forced-finish) turn max_tokens scaling — issue #836's
// overspend investigation. Before this fix, only the forced-finish branch
// scaled max_tokens to remaining budget; an ordinary turn always requested
// the flat 24,576 ceiling, uncoupled from a SMALL pass's own (much smaller)
// allocation — the concrete mechanism behind doc-truth's 37,106/11,000 (3.4x)
// overspend on PR #835. These tests assert the wire-level fix directly,
// beyond the budget-handling suite's existing bodies[0] assertions above.
// ---------------------------------------------------------------------------
describe('OpenAIAgentClient — ordinary-turn max_tokens scaling (#836 overspend fix)', () => {
  it('scales turn 1 down to the extra-pass-sized allocation itself (11,000), not the flat ceiling', async () => {
    // The exact shape this fix targets: a small, extra-pass-sized budget
    // (EXTRA_PASS_MIN_BUDGET_TOKENS) where the OLD flat 24,576 ceiling alone
    // was already more than double the entire allocation.
    const { bodies } = mockFetch([toolCallTurn(3_000), stopTurn(CLEAN_JSON, 500)]);
    const client = makeClient(11_000);

    await client.run('sys', 'init', [], noopTool);

    expect(bodies[0].max_tokens).toBe(11_000);
  });

  it('leaves a large, main-pass-sized budget unaffected (no regression)', async () => {
    // remainingBudget (100,000) comfortably exceeds the flat 24,576 ceiling,
    // so the ceiling itself wins — identical to pre-#836 behavior.
    const { bodies } = mockFetch([stopTurn(CLEAN_JSON)]);
    const client = makeClient(100_000);

    await client.run('sys', 'init', [], noopTool);

    expect(bodies[0].max_tokens).toBe(24_576);
  });

  it('floors an ordinary turn at 8,192 when remaining budget is smaller still', async () => {
    const { bodies } = mockFetch([stopTurn(CLEAN_JSON)]);
    const client = makeClient(3_000);

    await client.run('sys', 'init', [], noopTool);

    expect(bodies[0].max_tokens).toBe(8_192);
  });
});

// ---------------------------------------------------------------------------
// #792's 3-vote screen: a natural-stop turn corrupted at the wire ("wholesale-
// corrupted stop-turn", e.g. `{"findings":":[{",": ":", "}` — syntactically
// valid JSON but shaped wrong, so readVerdict correctly rejects it) triggers
// the existing summary-retry, same as any other missing-verdict bail. These
// tests cover the NEW bounded second attempt inside that retry: one more
// try when the first retry's own response is itself unrecoverable — never an
// unbounded loop, and a still-failed pair must surface as `incomplete`, not a
// silent clean 0-findings result.
// ---------------------------------------------------------------------------
describe('OpenAIAgentClient — bounded second retry attempt for corrupted stop-turns (#792)', () => {
  // Verbatim payload from both stale-duplicate screen runs (shape B).
  const CORRUPTED_STOP_TURN = '{"findings":":[{",": ":", "}';

  it('makes a bounded second attempt when the first retry is also corrupted, and recovers', async () => {
    mockFetch([
      toolCallTurn(100), // turn 1: investigation
      stopTurn(CORRUPTED_STOP_TURN, 50), // turn 2: natural stop, corrupted → triggers retry
      stopTurn(CORRUPTED_STOP_TURN, 50), // retry attempt 1: corrupted again
      stopTurn(CLEAN_JSON, 50), // retry attempt 2 (bounded): recovers
    ]);
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.incomplete).toBe(false);
    expect(result.summary?.overview).toBe('All good');
    // 2 main-loop turns + 2 retry attempts, all recorded on the trace.
    expect(result.trace.turns).toHaveLength(4);
  }, 15000);

  it('surfaces incomplete (not a silent clean review) when both retry attempts stay corrupted', async () => {
    mockFetch([
      toolCallTurn(100),
      stopTurn(CORRUPTED_STOP_TURN, 50),
      stopTurn(CORRUPTED_STOP_TURN, 50), // retry attempt 1: corrupted
      stopTurn(CORRUPTED_STOP_TURN, 50), // retry attempt 2 (bounded): also corrupted
    ]);
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.incomplete).toBe(true);
    expect(result.summary).toBeUndefined();
    expect(result.findings).toHaveLength(0);
  }, 15000);

  it('is bounded — does not keep retrying past the second attempt', async () => {
    // Only 4 responses queued (2 main-loop + 2 retry). If the client tried a
    // 3rd retry attempt, chatCompletion would hit the exhausted queue (empty
    // body) and its own internal transient-failure retry, which would show up
    // as extra request bodies. Assert exactly 4 requests were sent.
    const { bodies } = mockFetch([
      toolCallTurn(100),
      stopTurn(CORRUPTED_STOP_TURN, 50),
      stopTurn(CORRUPTED_STOP_TURN, 50),
      stopTurn(CORRUPTED_STOP_TURN, 50),
    ]);
    const client = makeClient(1_000_000);

    await client.run('sys', 'init', [], noopTool);

    expect(bodies).toHaveLength(4);
  }, 15000);

  it('logs a warning naming the bounded second-attempt retry', async () => {
    const { logger, lines } = capturingLogger();
    mockFetch([
      toolCallTurn(100),
      stopTurn(CORRUPTED_STOP_TURN, 50),
      stopTurn(CORRUPTED_STOP_TURN, 50),
      stopTurn(CLEAN_JSON, 50),
    ]);
    const client = makeClient(1_000_000, logger);

    await client.run('sys', 'init', [], noopTool);

    expect(lines.some(l => l.includes('attempting one more bounded retry'))).toBe(true);
  }, 15000);

  it('does not make a second attempt when the first retry already recovers a verdict', async () => {
    // Non-regression: the pre-existing single-retry path (budget test above,
    // "recovers a verdict via the json-forced summary-retry after a bail")
    // must not gain a spurious extra call when the first retry succeeds.
    const { bodies } = mockFetch([
      toolCallTurn(100),
      stopTurn(CORRUPTED_STOP_TURN, 50),
      stopTurn(CLEAN_JSON, 50), // retry attempt 1: recovers immediately
    ]);
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.incomplete).toBe(false);
    expect(bodies).toHaveLength(3);
  }, 15000);
});

// ---------------------------------------------------------------------------
// Issue #829's truncation remainder (post-#895's require_parameters fix): the
// summary-retry must send a SLIM message list — system prompt + the last
// investigative turn's own text + the instruction — not the full accumulated
// tool-calling history. See `buildSlimRetryPrompt` (agent-client-shared.ts)
// for the deterministic construction these pin at the wire level.
// ---------------------------------------------------------------------------
describe('OpenAIAgentClient — slim summary-retry context (#829 truncation remainder)', () => {
  it('sends only [system, user] on the retry — not the accumulated tool-calling history', async () => {
    const { bodies } = mockFetch([
      toolCallTurn(100), // turn 1: investigation (would bloat a full-history retry)
      toolCallTurn(100), // turn 2: more investigation
      stopTurn('Issue 1: looks suspicious. Issue 2: also suspicious. No JSON yet.'), // turn 3: derails
      stopTurn(CLEAN_JSON, 50), // retry attempt 1: recovers
    ]);
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.incomplete).toBe(false);
    const retryBody = bodies[3]; // 3 main-loop turns (0-2), retry is bodies[3]
    const retryMessages = retryBody.messages as Array<{ role: string; content: string }>;
    expect(retryMessages).toHaveLength(2);
    expect(retryMessages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(retryMessages.some(m => m.role === 'tool')).toBe(false);
  });

  it("carries the last investigative turn's own text into the retry prompt", async () => {
    const { bodies } = mockFetch([
      toolCallTurn(100),
      stopTurn('Issue 1: a real concern about null handling.'),
      stopTurn(CLEAN_JSON, 50),
    ]);
    const client = makeClient(1_000_000);

    await client.run('sys', 'init', [], noopTool);

    const retryMessages = bodies[2].messages as Array<{ role: string; content: string }>;
    expect(retryMessages[1].content).toContain('Issue 1: a real concern about null handling.');
    expect(retryMessages[1].content).toContain('Output ONLY the JSON block');
  });

  it('marks the retry-produced trace turns with slimRetry: true', async () => {
    mockFetch([toolCallTurn(100), stopTurn('no json here'), stopTurn(CLEAN_JSON, 50)]);
    const client = makeClient(1_000_000);

    const result = await client.run('sys', 'init', [], noopTool);

    const retryTurns = result.trace!.turns.filter(t => t.slimRetry);
    expect(retryTurns).toHaveLength(1);
    // Ordinary loop turns are untouched by the new field.
    expect(result.trace!.turns[0].slimRetry).toBeUndefined();
  });

  it('logs that the retry is slim (diagnosable in CI logs, distinct from the old flat message)', async () => {
    const { logger, lines } = capturingLogger();
    mockFetch([toolCallTurn(100), stopTurn('no json here'), stopTurn(CLEAN_JSON, 50)]);
    const client = makeClient(1_000_000, logger);

    await client.run('sys', 'init', [], noopTool);

    expect(lines.some(l => l.includes('slim retry'))).toBe(true);
  });

  // Adversarial-review finding F3: the LAST loop turn alone can be bare (a
  // pure tool_calls turn with no content and no reasoning) when the loop
  // ends right at max_turns — reading only that turn used to feed the retry
  // zero real context (false-clean risk). End-to-end proof the fix reaches
  // back through turn history via the real client loop, not just the shared
  // helper in isolation.
  it("falls back to an earlier turn's reasoning for the retry when the turn right before max_turns is bare (#829 F3)", async () => {
    const { bodies } = mockFetch([
      toolCallTurn(100, null, 'Issue 1: a real concern about null handling.'), // turn 1: has reasoning
      toolCallTurn(100), // turn 2: bare tool_calls (no content, no reasoning) — hits max_turns right after
      stopTurn(CLEAN_JSON, 50), // retry: recovers
    ]);
    const client = new OpenAIAgentClient({
      apiKey: 'test',
      baseUrl: 'http://mock.local',
      model: 'test-model',
      maxTurns: 2,
      maxTokenBudget: 1_000_000,
      logger: silentLogger,
    });

    const result = await client.run('sys', 'init', [], noopTool);

    expect(result.incomplete).toBe(false);
    const retryMessages = bodies[2].messages as Array<{ role: string; content: string }>;
    expect(retryMessages[1].content).toContain('Issue 1: a real concern about null handling.');
  });
});

/** Shared by both the `appendIncompleteNotice` and `hasProviderFailure` suites below. */
function baseResult(overrides: Partial<AgentResult>): AgentResult {
  return {
    findings: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
    turns: 0,
    stopReason: 'error',
    incomplete: true,
    ...overrides,
  };
}

describe('appendIncompleteNotice — severity by run outcome', () => {
  it('escalates a never-ran main pass to an ERROR notice naming the cause', () => {
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(
      findings,
      'agent-review',
      baseResult({ neverRan: true, errorMessage: 'API error (402): Insufficient credits' }),
    );

    expect(findings).toHaveLength(1);
    const notice = findings[0];
    expect(notice.severity).toBe('error');
    expect(notice.category).toBe('summary');
    expect(notice.message).toContain('did not run');
    expect(notice.message).toContain('402');
    expect(notice.message).toContain('NOT a clean review');
    expect(notice.metadata).toMatchObject({ neverRan: true, incomplete: true });
  });

  it('keeps a partial (budget) incomplete a WARNING, not clean', () => {
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(
      findings,
      'agent-review',
      baseResult({ neverRan: false, stopReason: 'budget' }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('did not finish');
    expect(findings[0].message).not.toContain('did not run');
    // The MAIN pass itself stopped short of a verdict — `hasIncompleteMainPass`'s
    // SSOT flag must be set so a conclusion-mapper can't silently read this as clean.
    expect(findings[0].metadata).toMatchObject({ mainPassIncomplete: true });
  });

  it('keeps a doc-pass-only incomplete a WARNING even if that pass never ran', () => {
    // A never-ran flag arriving alongside incompleteFromDocPass must NOT escalate
    // — the doc-truth second pass is failure-isolated; the main pass ran fine.
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(
      findings,
      'agent-review',
      baseResult({ neverRan: true, incompleteFromDocPass: true, stopReason: 'error' }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('documentation-truthfulness pass');
    expect(findings[0].message).toContain('code findings are unaffected');
    // An EXTRA-pass-only incomplete must NOT set the main-pass flag — the main
    // pass's own coverage is intact, so this stays advisory (see `hasIncompleteMainPass`).
    expect(findings[0].metadata).not.toHaveProperty('mainPassIncomplete');
  });

  it('keeps a stale-duplicate-loop-only incomplete a WARNING, naming that pass generically', () => {
    // The generic incompleteFromPass counterpart to incompleteFromDocPass —
    // any future named extra pass (not just doc-truth) gets the same
    // "that pass's findings are partial, main review unaffected" shape.
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(
      findings,
      'agent-review',
      baseResult({
        neverRan: true,
        incompleteFromPass: 'stale-duplicate',
        stopReason: 'incomplete_verdict',
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('The stale-duplicate pass did not finish');
    expect(findings[0].message).toContain('did not produce a verdict for every candidate');
    expect(findings[0].message).toContain("main review's findings are unaffected");
    expect(findings[0].metadata).not.toHaveProperty('mainPassIncomplete');
  });

  it('is a no-op for a complete run', () => {
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(findings, 'agent-review', baseResult({ incomplete: false }));
    expect(findings).toHaveLength(0);
  });
});

describe('hasProviderFailure — the single source of truth for #764-class detection', () => {
  // Regression coverage for #764/#765: the action layer (and review-pr.ts's
  // `ReviewCoreResult.providerFailure`) both key off this function rather than
  // re-deriving the signal from `metadata` shape or conclusion/summary text.
  function neverRanNotice(): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(
      findings,
      'agent-review',
      baseResult({ neverRan: true, errorMessage: 'API error (402): Insufficient credits' }),
    );
    return findings;
  }

  it('is true when findings carry the never-ran notice', () => {
    expect(hasProviderFailure(neverRanNotice())).toBe(true);
  });

  it('is false for a partial (budget) incomplete notice — no neverRan metadata', () => {
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(
      findings,
      'agent-review',
      baseResult({ neverRan: false, stopReason: 'budget' }),
    );
    expect(hasProviderFailure(findings)).toBe(false);
  });

  it('is false for a doc-pass-only incomplete notice (main pass ran fine)', () => {
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(
      findings,
      'agent-review',
      baseResult({ neverRan: true, incompleteFromDocPass: true, stopReason: 'error' }),
    );
    expect(hasProviderFailure(findings)).toBe(false);
  });

  it('is false for an ordinary error finding with no metadata at all', () => {
    expect(hasProviderFailure([{ severity: 'error' } as ReviewFinding])).toBe(false);
  });

  it('is false for an empty findings list', () => {
    expect(hasProviderFailure([])).toBe(false);
  });
});

describe('hasIncompleteMainPass — the trust-residue fix companion to hasProviderFailure', () => {
  // Regression coverage for the "an honestly-incomplete review lands a GREEN
  // check" trust residue (companion to #764/#765, observed live on #795): the
  // action layer (and review-pr.ts's `ReviewCoreResult.incompleteMainPass`)
  // both key off this function rather than re-deriving the signal from
  // `metadata` shape or conclusion/summary text.
  it('is true for a PARTIAL (budget) main-pass incomplete notice', () => {
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(
      findings,
      'agent-review',
      baseResult({ neverRan: false, stopReason: 'budget' }),
    );
    expect(hasIncompleteMainPass(findings)).toBe(true);
  });

  it('is true for an unrecoverable corrupted stop-turn (stopReason: completed, no verdict — #795)', () => {
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(
      findings,
      'agent-review',
      baseResult({ neverRan: false, stopReason: 'completed' }),
    );
    expect(hasIncompleteMainPass(findings)).toBe(true);
  });

  it('is false for a total never-ran provider failure (hasProviderFailure covers that instead)', () => {
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(
      findings,
      'agent-review',
      baseResult({ neverRan: true, errorMessage: 'API error (402): Insufficient credits' }),
    );
    expect(hasIncompleteMainPass(findings)).toBe(false);
    expect(hasProviderFailure(findings)).toBe(true);
  });

  it('is false for a doc-pass-only incomplete notice (main pass ran fine)', () => {
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(
      findings,
      'agent-review',
      baseResult({ neverRan: true, incompleteFromDocPass: true, stopReason: 'error' }),
    );
    expect(hasIncompleteMainPass(findings)).toBe(false);
  });

  it('is false for a named-extra-pass-only incomplete notice (main pass ran fine)', () => {
    const findings: ReviewFinding[] = [];
    appendIncompleteNotice(
      findings,
      'agent-review',
      baseResult({
        neverRan: true,
        incompleteFromPass: 'stale-duplicate',
        stopReason: 'incomplete_verdict',
      }),
    );
    expect(hasIncompleteMainPass(findings)).toBe(false);
  });

  it('is false for an ordinary error finding with no metadata at all', () => {
    expect(hasIncompleteMainPass([{ severity: 'error' } as ReviewFinding])).toBe(false);
  });

  it('is false for an empty findings list', () => {
    expect(hasIncompleteMainPass([])).toBe(false);
  });
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

describe('retryMaxTokens — bounding the summary-retry request (#811)', () => {
  it('floors to 2,048 when remaining budget is deeply negative (the starved case)', () => {
    // #811's actual numbers: doc-truth's turn 1 alone spent 5,526 against a
    // 2,422 budget (remaining -3,104); stale-dup's spent 6,564 against 4,400
    // (remaining -2,164). Both must floor to the same small request cap.
    expect(retryMaxTokens(-3_104)).toBe(2_048);
    expect(retryMaxTokens(-2_164)).toBe(2_048);
  });

  it('floors to 2,048 at and just above zero remaining budget', () => {
    expect(retryMaxTokens(0)).toBe(2_048);
    expect(retryMaxTokens(1_000)).toBe(2_048);
  });

  it('passes remaining budget through unchanged between the floor and the ceiling', () => {
    expect(retryMaxTokens(2_048)).toBe(2_048);
    expect(retryMaxTokens(10_000)).toBe(10_000);
    expect(retryMaxTokens(24_576)).toBe(24_576);
  });

  it('clamps to the 24,576 ceiling when ample budget remains (matches the old flat request)', () => {
    expect(retryMaxTokens(24_577)).toBe(24_576);
    expect(retryMaxTokens(999_900)).toBe(24_576); // e.g. a 1M-token-budget pass
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
  // ~40K chars ≈ 10K content tokens; with 5 files (maxTurns 10, toolBudget 60K)
  // base = 4000 + 10000 + 60000 + 2000 = 76000 (within [60K, ceiling], unclamped).
  const chunks = [{ content: 'x'.repeat(40_000) }];

  it('scales the budget up ~2x for Kimi vs a lean model', () => {
    const lean = scaleAgentBudget(5, chunks, 'some/lean-model').maxTokenBudget;
    const kimi = scaleAgentBudget(5, chunks, DEFAULT_REVIEW_MODEL).maxTokenBudget;
    expect(lean).toBe(76_000);
    expect(kimi).toBe(152_000);
    expect(kimi).toBe(lean * 2.0);
  });

  it('clamps the scaled budget to the shared ceiling', () => {
    // 15 files (maxTurns 12) + large content pushes base*2.0 past the ceiling.
    const big = [{ content: 'x'.repeat(400_000) }];
    expect(scaleAgentBudget(15, big, DEFAULT_REVIEW_MODEL).maxTokenBudget).toBe(
      MAX_REVIEW_TOKEN_BUDGET,
    );
  });

  it('always returns an integer budget (the config schema requires int)', () => {
    // 40002 chars → ceil(/4)=10001 → base 76001 (odd). Kimi's ×2.0 stays whole
    // (152002) on its own, so this only guards the int contract for Kimi's
    // current multiplier — the rounding path itself is exercised below.
    const odd = [{ content: 'x'.repeat(40_002) }];
    const { maxTokenBudget } = scaleAgentBudget(5, odd, DEFAULT_REVIEW_MODEL);
    expect(Number.isInteger(maxTokenBudget)).toBe(true);
    expect(maxTokenBudget).toBe(152_002);
  });

  it('rounds a genuinely fractional multiplier to an integer', () => {
    // Kimi's 2.0x can never produce a fraction (integer base * 2 is always
    // integer), so it can't exercise Math.round. Register a synthetic model
    // with a fractional multiplier to prove the rounding actually happens,
    // not just that Kimi's current value happens to stay whole.
    const testModel = 'test/fractional-multiplier-model';
    REVIEW_TOKEN_BUDGET_MULTIPLIERS[testModel] = 1.3;
    try {
      // base 76001 (odd, from the 40002-char case above) × 1.3 = 98801.3.
      const { maxTokenBudget } = scaleAgentBudget(5, [{ content: 'x'.repeat(40_002) }], testModel);
      expect(Number.isInteger(maxTokenBudget)).toBe(true);
      expect(maxTokenBudget).toBe(Math.round(76_001 * 1.3));
      expect(maxTokenBudget).toBe(98_801);
    } finally {
      delete REVIEW_TOKEN_BUDGET_MULTIPLIERS[testModel];
    }
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

describe('applyReviewTokenBudgetOverride — LIEN_REVIEW_TOKEN_BUDGET (PR #855)', () => {
  afterEach(() => {
    delete process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV];
  });

  it('is a byte-identical no-op when unset — the computed value passes through', () => {
    delete process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV];
    expect(applyReviewTokenBudgetOverride(161_588)).toBe(161_588);
  });

  it('is a no-op for an empty-string value (unset in practice)', () => {
    process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV] = '';
    expect(applyReviewTokenBudgetOverride(161_588)).toBe(161_588);
  });

  it('applies a valid value inside the clamp range, replacing the computed budget', () => {
    process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV] = '400000';
    expect(applyReviewTokenBudgetOverride(161_588)).toBe(400_000);
  });

  it.each([
    ['non-numeric garbage', 'not-a-number'],
    ['a fractional value', '100000.5'],
    ['zero', '0'],
    ['a negative value', '-50000'],
    ['NaN itself', 'NaN'],
    ['Infinity', 'Infinity'],
  ])('fails open to the computed value on %s', (_label, raw) => {
    process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV] = raw;
    expect(applyReviewTokenBudgetOverride(161_588)).toBe(161_588);
  });

  it('clamps a below-floor value up to MIN_REVIEW_TOKEN_BUDGET_OVERRIDE', () => {
    process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV] = '1000';
    expect(applyReviewTokenBudgetOverride(161_588)).toBe(MIN_REVIEW_TOKEN_BUDGET_OVERRIDE);
  });

  it('clamps an above-ceiling value down to MAX_REVIEW_TOKEN_BUDGET_OVERRIDE (5x the default)', () => {
    process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV] = '999999999';
    expect(applyReviewTokenBudgetOverride(161_588)).toBe(MAX_REVIEW_TOKEN_BUDGET_OVERRIDE);
    expect(MAX_REVIEW_TOKEN_BUDGET_OVERRIDE).toBe(MAX_REVIEW_TOKEN_BUDGET * 5);
  });

  it('passes an in-range value through unchanged at the exact floor/ceiling boundaries', () => {
    process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV] = String(MIN_REVIEW_TOKEN_BUDGET_OVERRIDE);
    expect(applyReviewTokenBudgetOverride(1)).toBe(MIN_REVIEW_TOKEN_BUDGET_OVERRIDE);
    process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV] = String(MAX_REVIEW_TOKEN_BUDGET_OVERRIDE);
    expect(applyReviewTokenBudgetOverride(1)).toBe(MAX_REVIEW_TOKEN_BUDGET_OVERRIDE);
  });
});

describe('AgentReviewPlugin.analyze — LIEN_REVIEW_TOKEN_BUDGET reaches the attestation (PR #855)', () => {
  afterEach(() => {
    delete process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV];
  });

  const CLEAN_JSON_LOCAL =
    '```json\n' +
    JSON.stringify({
      findings: [],
      summary: { riskLevel: 'low', overview: 'fine', keyChanges: [] },
    }) +
    '\n```';

  function stopTurnLocal(content: string) {
    return {
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    };
  }

  function mockFetchLocal() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const resp = stopTurnLocal(CLEAN_JSON_LOCAL);
        return {
          ok: true,
          status: 200,
          json: async () => resp,
          text: async () => JSON.stringify(resp),
        };
      }),
    );
  }

  it('reports the overridden value (not the computed one) via context.reportBudget on the normal path', async () => {
    mockFetchLocal();
    process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV] = '400000';
    const reportBudget = vi.fn();
    const plugin = new AgentReviewPlugin();
    const context: ReviewContext = createTestContext({
      chunks: [
        {
          content: 'export function add(a, b) { return a + b; }',
          metadata: { file: 'src/math.ts', language: 'typescript', symbolType: 'function' },
        } as ReviewContext['chunks'][number],
      ],
      changedFiles: ['src/math.ts'],
      repoChunks: [],
      repoRootDir: '/tmp/does-not-matter',
      reportBudget,
      config: {
        apiKey: 'k',
        provider: 'openai',
        model: 'test-model',
        baseUrl: 'http://mock.local',
        maxTurns: 8,
        maxTokenBudget: 60_000,
        summaryEnabled: false,
        docTruthPass: false,
      },
      pr: {
        title: 'feat: big diff',
        patches: new Map([['src/math.ts', '@@ diff @@']]),
      } as ReviewContext['pr'],
    });

    await plugin.analyze(context);

    expect(reportBudget).toHaveBeenCalledWith(400_000);
  });

  it('leaves context.reportBudget unaffected on the normal path when unset (default byte-identical)', async () => {
    mockFetchLocal();
    delete process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV];
    const reportBudget = vi.fn();
    const plugin = new AgentReviewPlugin();
    const context: ReviewContext = createTestContext({
      chunks: [
        {
          content: 'export function add(a, b) { return a + b; }',
          metadata: { file: 'src/math.ts', language: 'typescript', symbolType: 'function' },
        } as ReviewContext['chunks'][number],
      ],
      changedFiles: ['src/math.ts'],
      repoChunks: [],
      repoRootDir: '/tmp/does-not-matter',
      reportBudget,
      config: {
        apiKey: 'k',
        provider: 'openai',
        model: 'test-model',
        baseUrl: 'http://mock.local',
        maxTurns: 8,
        maxTokenBudget: 60_000,
        summaryEnabled: false,
        docTruthPass: false,
      },
      pr: {
        title: 'fix: small change',
        patches: new Map([['src/math.ts', '@@ diff @@']]),
      } as ReviewContext['pr'],
    });

    await plugin.analyze(context);

    expect(reportBudget).toHaveBeenCalledWith(60_000);
  });

  it('reports the overridden value on the summary-only path too', async () => {
    mockFetchLocal();
    process.env[REVIEW_TOKEN_BUDGET_OVERRIDE_ENV] = '500000';
    const reportBudget = vi.fn();
    const plugin = new AgentReviewPlugin();
    const context: ReviewContext = createTestContext({
      chunks: [],
      allChangedFiles: ['CLAUDE.md'],
      reportBudget,
      config: {
        apiKey: 'k',
        provider: 'openai',
        model: 'test-model',
        baseUrl: 'http://mock.local',
        maxTurns: 8,
        maxTokenBudget: 20_000,
        summaryEnabled: true,
        docTruthPass: false,
      },
      pr: {
        title: 'docs: remove stale line',
        patches: new Map([['CLAUDE.md', '@@ -1,2 +1,1 @@\n-stale\n context']]),
      } as ReviewContext['pr'],
      repoRootDir: '/tmp/does-not-matter',
    });

    await plugin.analyze(context);

    expect(reportBudget).toHaveBeenCalledWith(500_000);
  });
});

describe('summaryOnlyEligibleFor / resolveAgentBudget — issue #572 budget selection', () => {
  function pr(patches?: Map<string, string>): PRContext {
    return {
      owner: 'o',
      repo: 'r',
      pullNumber: 1,
      title: 't',
      baseSha: 'base',
      headSha: 'head',
      patches,
    };
  }

  function llmCtx(patches?: Map<string, string>): ReviewCoreContext {
    return {
      pr: pr(patches),
      llm: { provider: 'openai', apiKey: 'k', model: DEFAULT_REVIEW_MODEL } as never,
    } as unknown as ReviewCoreContext;
  }

  it('summaryOnlyEligibleFor is true only for the exact triple', () => {
    expect(summaryOnlyEligibleFor([], true, pr(new Map([['a.md', 'd']])))).toBe(true);
    expect(summaryOnlyEligibleFor(['x.ts'], true, pr(new Map([['a.md', 'd']])))).toBe(false);
    expect(summaryOnlyEligibleFor([], false, pr(new Map([['a.md', 'd']])))).toBe(false);
    expect(summaryOnlyEligibleFor([], true, pr())).toBe(false);
  });

  it('resolveAgentBudget picks the low-capped summary-only budget under the gate', () => {
    const patches = new Map([['CLAUDE.md', 'x'.repeat(4_000)]]);
    const { maxTurns, maxTokenBudget } = resolveAgentBudget(llmCtx(patches), [], [], true);
    expect(maxTurns).toBeLessThanOrEqual(8);
    expect(maxTokenBudget).toBeLessThan(60_000); // well under scaleAgentBudget's floor
  });

  it('resolveAgentBudget falls back to scaleAgentBudget outside the gate', () => {
    const chunks = [{ content: 'x'.repeat(40_000) }];
    const withFiles = resolveAgentBudget(llmCtx(new Map()), ['a.ts', 'b.ts'], chunks, true);
    const expected = scaleAgentBudget(2, chunks, DEFAULT_REVIEW_MODEL);
    expect(withFiles).toEqual(expected);
  });

  it('resolveAgentBudget uses the normal budget when summary is disabled, even with patches', () => {
    const patches = new Map([['CLAUDE.md', 'x'.repeat(4_000)]]);
    const result = resolveAgentBudget(llmCtx(patches), [], [], false);
    expect(result).toEqual(scaleAgentBudget(0, [], DEFAULT_REVIEW_MODEL));
  });
});

describe('AgentReviewPlugin.present — incomplete review', () => {
  function incompleteSummaryFinding(): ReviewFinding {
    const message =
      'Lien Review did not finish — it hit the token budget limit while investigating. ' +
      'Any findings shown are partial; re-run the review to retry.';
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

describe('AgentReviewPlugin.present — multiple summary findings', () => {
  function primarySummary(overview: string): ReviewFinding {
    return {
      pluginId: 'agent-review',
      filepath: '',
      line: 0,
      severity: 'info',
      category: 'summary',
      message: overview,
      metadata: { riskLevel: 'low', overview, keyChanges: [] },
    };
  }

  function appendedIncompleteSummary(overview: string): ReviewFinding {
    return {
      pluginId: 'agent-review',
      filepath: '',
      line: 0,
      severity: 'warning',
      category: 'summary',
      message: overview,
      metadata: { incomplete: true, stopReason: 'budget', overview },
    };
  }

  it('renders a single summary byte-identically (no appended sections)', async () => {
    const plugin = new AgentReviewPlugin();
    const appendDescription = vi.fn();
    const appendSummary = vi.fn();
    const ctx = {
      addAnnotations: vi.fn(),
      appendDescription,
      appendSummary,
    } as unknown as PresentContext;

    await plugin.present([primarySummary('All good')], ctx);

    expect(appendDescription.mock.calls[0][0]).toBe(
      '> [!NOTE]\n> **Low Risk**\n>\n> All good\n\n' +
        '✅ *Trust: **Delivered** — The review ran to completion within budget.*\n\n' +
        '<sup>Reviewed by [Lien Review](https://lien.dev). Updates automatically on new commits.</sup>',
    );
    expect(appendSummary.mock.calls[0][0]).toBe('### Agent Review\n\n**Low Risk** — All good');
  });

  it('renders a second (appended) summary that the old first-only logic dropped', async () => {
    const plugin = new AgentReviewPlugin();
    const appendDescription = vi.fn();
    const appendSummary = vi.fn();
    const ctx = {
      addAnnotations: vi.fn(),
      appendDescription,
      appendSummary,
    } as unknown as PresentContext;

    const docNotice = 'The documentation-truthfulness pass did not finish — it hit the budget.';
    await plugin.present(
      [primarySummary('Main overview'), appendedIncompleteSummary(docNotice)],
      ctx,
    );

    // Primary block still drives the callout (low risk → NOTE), and the second
    // summary surfaces as its own ⚠️ warning section — the #733 trap fixed.
    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).toContain('> [!NOTE]');
    expect(description).toContain('> **Low Risk**');
    expect(description).toContain('> Main overview');
    expect(description).toContain(`⚠️ ${docNotice}`);

    const summary = appendSummary.mock.calls[0][0] as string;
    expect(summary).toContain('**Low Risk** — Main overview');
    expect(summary).toContain(`⚠️ **Review incomplete** — ${docNotice}`);
  });

  it('renders a second non-incomplete summary as a plain appended paragraph', async () => {
    const plugin = new AgentReviewPlugin();
    const appendDescription = vi.fn();
    const appendSummary = vi.fn();
    const ctx = {
      addAnnotations: vi.fn(),
      appendDescription,
      appendSummary,
    } as unknown as PresentContext;

    const second: ReviewFinding = {
      pluginId: 'agent-review',
      filepath: '',
      line: 0,
      severity: 'info',
      category: 'summary',
      message: 'A secondary note.',
      metadata: { overview: 'A secondary note.' },
    };
    await plugin.present([primarySummary('Main overview'), second], ctx);

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).toContain('A secondary note.');
    expect(description).not.toContain('⚠️ A secondary note.');
    const summary = appendSummary.mock.calls[0][0] as string;
    // Plain paragraph, not a "Review incomplete" line, not a duplicated Risk line.
    expect(summary).toContain('\n\nA secondary note.');
    expect(summary).not.toContain('Review incomplete');
  });
});

describe('clampText (finding free-text cap)', () => {
  it('leaves short text unchanged', () => {
    expect(clampText('short message')).toBe('short message');
    expect(clampText(undefined)).toBeUndefined();
  });

  it('truncates an over-long message with an ellipsis', () => {
    const long = 'x'.repeat(5000);
    const out = clampText(long)!;
    expect(out.length).toBeLessThanOrEqual(1200);
    expect(out.endsWith('…')).toBe(true);
  });

  it('keeps text exactly at the cap and truncates one over', () => {
    // Boundary: 1200 chars passes through unchanged; 1201 is truncated. Guards
    // against a `<= 1200` → `< 1200` regression silently clipping at-cap text.
    expect(clampText('y'.repeat(1200))).toBe('y'.repeat(1200));
    const over = clampText('y'.repeat(1201))!;
    expect(over.length).toBeLessThanOrEqual(1200);
    expect(over.endsWith('…')).toBe(true);
  });
});

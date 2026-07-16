import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIAgentClient, envDisabled } from '../src/plugins/agent/openai-client.js';
import {
  AgentReviewPlugin,
  appendIncompleteNotice,
  scaleBudgetForBlastRadius,
  clampText,
  hasProviderFailure,
} from '../src/plugins/agent/index.js';
import { scaleAgentBudget, resolveAgentBudget, summaryOnlyEligibleFor } from '../src/review-pr.js';
import type { ReviewCoreContext } from '../src/review-pr.js';
import {
  DEFAULT_REVIEW_MODEL,
  MAX_REVIEW_TOKEN_BUDGET,
  REVIEW_TOKEN_BUDGET_MULTIPLIERS,
} from '../src/defaults.js';
import { silentLogger } from '../src/test-helpers.js';
import type { Logger } from '../src/logger.js';
import type { PresentContext, ReviewFinding } from '../src/plugin-types.js';
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
    expect(bodies[0].max_tokens).toBe(24_576);
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

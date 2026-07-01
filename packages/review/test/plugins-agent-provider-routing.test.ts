import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIAgentClient, describeServingProvider } from '../src/plugins/agent/openai-client.js';
import { DEFAULT_PROVIDER_ROUTING } from '../src/defaults.js';
import { silentLogger } from '../src/test-helpers.js';
import type { Logger } from '../src/logger.js';

// ---------------------------------------------------------------------------
// Helpers (mirror plugins-agent-budget.test.ts — kept local/self-contained)
// ---------------------------------------------------------------------------

function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record = (m: string) => lines.push(m);
  return { logger: { info: record, warning: record, error: record, debug: record }, lines };
}

/** Install a fetch mock that replays `responses` and records request bodies. */
function mockFetch(responses: Array<Record<string, unknown>>): {
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

const CLEAN_JSON =
  '```json\n' +
  JSON.stringify({ findings: [], summary: { riskLevel: 'low', overview: 'ok', keyChanges: [] } }) +
  '\n```';

/** A finish_reason:'stop' turn carrying the clean verdict + optional routing metadata. */
function stopTurn(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    choices: [{ message: { role: 'assistant', content: CLEAN_JSON }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    ...extra,
  };
}

function makeClient(
  opts: Partial<{ providerRouting: Record<string, unknown> | null; requestTimeoutMs: number }> = {},
  logger: Logger = silentLogger,
): OpenAIAgentClient {
  return new OpenAIAgentClient({
    apiKey: 'test',
    baseUrl: 'http://mock.local',
    model: 'test-model',
    maxTurns: 8,
    maxTokenBudget: 1_000_000,
    logger,
    ...opts,
  });
}

const noopTool = async () => 'ok';

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// describeServingProvider
// ---------------------------------------------------------------------------

describe('describeServingProvider', () => {
  it('names the selected endpoint provider', () => {
    expect(
      describeServingProvider({
        openrouter_metadata: {
          attempt: 1,
          endpoints: {
            available: [
              { provider: 'Moonshot', selected: false },
              { provider: 'Fireworks', selected: true },
            ],
          },
        },
      }),
    ).toBe('Fireworks');
  });

  it('flags a fallback (attempt > 1) using the last attempt provider', () => {
    expect(
      describeServingProvider({
        openrouter_metadata: {
          attempt: 2,
          attempts: [
            { provider: 'Slow', status: 502 },
            { provider: 'Together', status: 200 },
          ],
        },
      }),
    ).toBe('Together (attempt 2, fell back)');
  });

  it('falls back to the top-level provider field, then summary, then unknown', () => {
    expect(describeServingProvider({ provider: 'DeepInfra' })).toBe('DeepInfra');
    expect(
      describeServingProvider({ openrouter_metadata: { summary: 'available=1, selected=X' } }),
    ).toBe('available=1, selected=X');
    expect(describeServingProvider({})).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Request body — provider routing block
// ---------------------------------------------------------------------------

describe('OpenAIAgentClient provider routing', () => {
  it('sends the default provider routing block when unconfigured', async () => {
    const { bodies } = mockFetch([stopTurn()]);
    await makeClient().run('sys', 'init', [], noopTool);
    expect(bodies[0].provider).toEqual(DEFAULT_PROVIDER_ROUTING);
    expect(bodies[0].provider).toEqual({ sort: 'throughput', allow_fallbacks: true });
  });

  it('sends a caller-supplied routing block verbatim', async () => {
    const { bodies } = mockFetch([stopTurn()]);
    await makeClient({ providerRouting: { order: ['fireworks', 'together'] } }).run(
      'sys',
      'init',
      [],
      noopTool,
    );
    expect(bodies[0].provider).toEqual({ order: ['fireworks', 'together'] });
  });

  it('omits the provider block when routing is explicitly null', async () => {
    const { bodies } = mockFetch([stopTurn()]);
    await makeClient({ providerRouting: null }).run('sys', 'init', [], noopTool);
    expect(bodies[0].provider).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Per-request diagnostics — serving provider + latency logging
// ---------------------------------------------------------------------------

describe('OpenAIAgentClient per-request diagnostics', () => {
  it('logs the serving provider and latency for each request', async () => {
    mockFetch([
      stopTurn({
        openrouter_metadata: {
          attempt: 1,
          endpoints: { available: [{ provider: 'Fireworks', selected: true }] },
        },
      }),
    ]);
    const { logger, lines } = capturingLogger();
    await makeClient({}, logger).run('sys', 'init', [], noopTool);
    expect(lines.some(l => /served by Fireworks in \d+ms/.test(l))).toBe(true);
  });

  it('completes a normal run with a custom requestTimeoutMs (option accepted)', async () => {
    mockFetch([stopTurn()]);
    const result = await makeClient({ requestTimeoutMs: 30_000 }).run('sys', 'init', [], noopTool);
    expect(result.incomplete).toBe(false);
    expect(result.summary).toBeDefined();
  });
});

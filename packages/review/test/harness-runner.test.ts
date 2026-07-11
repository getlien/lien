/**
 * The test harness's Tier-1 fields (`toolCalls`, `turns`) must come from the
 * structured `AgentTrace` the agent client always returns via `reportTrace`
 * — not from regex-parsing `logger.info` lines like "[agent] Turn 2 tools:
 * get_files_context, read_file". The old regex extractor was only ever as
 * stable as that log line's exact wording; the trace carries the same data
 * structurally (`trace.turns[].toolCalls[].name`), independent of any log
 * phrasing.
 *
 * Two layers of coverage:
 *  - Pure unit tests of `toolCallsFromTrace`/`turnCountFromTrace` against
 *    hand-built `AgentTrace` objects, including one where the free-text
 *    `reasoning`/`responseText` deliberately *mentions* tool names that were
 *    never actually invoked (the exact shape that would fool a text-scraper).
 *  - A fixture-replay through `runFixture` with a mocked OpenAI-compat
 *    `fetch`, proving the wiring end-to-end without hitting OpenRouter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { runFixture, toolCallsFromTrace, turnCountFromTrace } from './harness/runner.js';
import {
  expectAnyToolCalled,
  expectRuleFired,
  expectToolCalled,
  HarnessAssertionError,
} from './harness/assertions.js';
import { reportCalibrate, reportVote } from './harness/reporter.js';
import type { AssertedRun, CalibrateResult, VoteResult } from './harness/voting.js';
import type { AgentTrace, TurnTrace } from '../src/plugins/agent/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLACEHOLDER_FIXTURE = resolve(
  HERE,
  'harness/fixtures/boundary-change/placeholder.fixture.json',
);

function turn(turnNumber: number, toolNames: string[], responseText = ''): TurnTrace {
  return {
    turnNumber,
    responseText,
    toolCalls: toolNames.map(name => ({ name, input: {}, output: '' })),
  };
}

function traceOf(turns: TurnTrace[]): AgentTrace {
  return { systemPrompt: 'sys', initialMessage: 'init', model: 'test-model', turns };
}

describe('expectAnyToolCalled', () => {
  const result = { findings: [], toolCalls: ['tool=read_file'], turns: 1 };

  it('passes when any of the accepted tools was called', () => {
    expect(() => expectAnyToolCalled(['get_files_context', 'read_file'], result)).not.toThrow();
  });

  it('throws Tier 1 when none of the accepted tools was called', () => {
    expect(() => expectAnyToolCalled(['get_files_context', 'grep_codebase'], result)).toThrow(
      HarnessAssertionError,
    );
  });

  it('does not false-match a tool name substring', () => {
    const subst = { findings: [], toolCalls: ['tool=file_reader_x'], turns: 1 };
    expect(() => expectAnyToolCalled(['read_file'], subst)).toThrow(HarnessAssertionError);
  });
});

describe('toolCallsFromTrace / turnCountFromTrace (pure trace helpers)', () => {
  it('flattens tool calls across turns, in order', () => {
    const trace = traceOf([
      turn(1, ['get_files_context']),
      turn(2, ['get_dependents', 'read_file']),
    ]);
    expect(toolCallsFromTrace(trace)).toEqual(['get_files_context', 'get_dependents', 'read_file']);
    expect(turnCountFromTrace(trace)).toBe(2);
  });

  it('ignores tool names mentioned only in free-text reasoning/response prose', () => {
    const trace = traceOf([
      {
        turnNumber: 1,
        responseText: 'I will call get_dependents and read_file next.',
        reasoning: '[agent] Turn 1 tools: get_dependents, read_file',
        toolCalls: [{ name: 'get_files_context', input: {}, output: '' }],
      },
    ]);
    // Only the structurally-issued tool call counts — the prose above uses
    // the exact old log-line format but names tools that were never called.
    expect(toolCallsFromTrace(trace)).toEqual(['get_files_context']);
  });

  it('counts a summary-retry turn (no tool calls) toward the turn count', () => {
    const trace = traceOf([turn(1, ['get_files_context']), turn(2, [], '{}')]);
    expect(turnCountFromTrace(trace)).toBe(2);
    expect(toolCallsFromTrace(trace)).toEqual(['get_files_context']);
  });

  it('defaults to empty when no trace is present', () => {
    expect(toolCallsFromTrace(undefined)).toEqual([]);
    expect(turnCountFromTrace(undefined)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fixture replay: runFixture end-to-end, with a mocked OpenAI-compat fetch.
// ---------------------------------------------------------------------------

type ChatResponse = {
  choices: Array<{
    message: { role: string; content: string | null; reasoning?: string; tool_calls?: unknown[] };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

function mockFetch(responses: ChatResponse[]): void {
  const queue = [...responses];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      JSON.parse(init.body); // sanity: the client always sends a valid JSON body
      const next = queue.shift();
      return {
        ok: true,
        status: 200,
        json: async () => next,
        text: async () => JSON.stringify(next),
      };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const CLEAN_JSON =
  '```json\n' +
  JSON.stringify({
    findings: [
      {
        filepath: 'src/risk.ts',
        line: 13,
        severity: 'warning',
        category: 'boundary_change',
        message: 'Off-by-one boundary shift.',
        ruleId: 'boundary-change',
      },
    ],
    summary: { riskLevel: 'low', overview: 'Looks fine.', keyChanges: [] },
  }) +
  '\n```';

describe('runFixture — HarnessResult.toolCalls/turns come from the trace', () => {
  it('reports only the structurally-invoked tool, unaffected by misleading reasoning prose', async () => {
    mockFetch([
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              // Deliberately names tools that were never actually called, in
              // the exact shape the old regex extractor scraped from logs.
              // A text-scraping approach would misreport these as called.
              reasoning: '[agent] Turn 7 tools: read_file, grep_codebase',
              tool_calls: [
                {
                  id: 't1',
                  type: 'function',
                  function: {
                    name: 'get_files_context',
                    arguments: JSON.stringify({ filepaths: ['src/risk.ts'] }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 500, completion_tokens: 50, total_tokens: 550 },
      },
      {
        choices: [{ message: { role: 'assistant', content: CLEAN_JSON }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
      },
    ]);

    const result = await runFixture(PLACEHOLDER_FIXTURE, {
      apiKey: 'test-key',
      baseUrl: 'http://mock.local',
    });

    // Structural extraction: exactly the one real tool call — nothing from
    // the misleading "[agent] Turn 7 tools: ..." reasoning text.
    expect(result.toolCalls).toEqual(['get_files_context']);
    expectToolCalled('get_files_context', result);

    // Two loop turns, straight from `trace.turns.length` — no "[agent] Turn
    // N" log line was ever inspected.
    expect(result.turns).toBe(2);
    expect(result.trace?.turns).toHaveLength(2);

    expectRuleFired('boundary-change', result);
  });
});

// ---------------------------------------------------------------------------
// Reporter — characterization rendering, --bail aborted lines, byte-identical
// default output. These are pure string formatters (no LLM).
// ---------------------------------------------------------------------------

function fakeRun(passed: boolean): AssertedRun {
  return { result: { findings: [], toolCalls: [], turns: 0 }, cost: 0, passed };
}

function calResult(overrides: Partial<CalibrateResult> = {}): CalibrateResult {
  const runs = Array.from({ length: 10 }, () => fakeRun(true));
  return {
    runs,
    passes: 10,
    passRate: 1,
    totalCost: 0.5,
    meetsReliabilityBar: true,
    requested: 10,
    aborted: false,
    ...overrides,
  };
}

describe('reportCalibrate', () => {
  it('renders a passing bar exactly as before (byte-identical default)', () => {
    const line = reportCalibrate('doc-truth/pr658', calResult());
    expect(line).toBe('✓ doc-truth/pr658 — 10/10 passed (100%) · $0.5000');
  });

  it('renders a characterization fixture as a neutral non-gating ~ line', () => {
    const runs = [
      ...Array.from({ length: 6 }, () => fakeRun(true)),
      ...Array.from({ length: 4 }, () => fakeRun(false)),
    ];
    const line = reportCalibrate(
      'doc-truth/pr667-worktree-doc-drift',
      calResult({ runs, passes: 6, passRate: 0.6, meetsReliabilityBar: false }),
      { characterization: true },
    );
    expect(line).toBe(
      '~ doc-truth/pr667-worktree-doc-drift — measured 6/10 (non-gating, see fixture header) · $0.5000',
    );
    // No red ✗, no "BAR NOT MET" scare line.
    expect(line).not.toContain('✗');
    expect(line).not.toContain('BAR NOT MET');
  });

  it('renders an aborted --bail run with the aborted headline', () => {
    const runs = [fakeRun(true), fakeRun(false), fakeRun(false)];
    const line = reportCalibrate(
      'concurrency-race/toctou',
      calResult({
        runs,
        passes: 1,
        passRate: 1 / 3,
        meetsReliabilityBar: false,
        aborted: true,
        bail: 2,
      }),
    );
    expect(line).toContain('✗ concurrency-race/toctou — aborted after 3/10 votes (--bail 2)');
    // The aborted headline replaces the "BAR NOT MET" advisory (it's redundant).
    expect(line).not.toContain('BAR NOT MET');
    expect(line).toContain('failures: 0 tier-1');
  });
});

describe('reportVote', () => {
  function voteResult(overrides: Partial<VoteResult> = {}): VoteResult {
    const votes = Array.from({ length: 3 }, () => fakeRun(true));
    return { votes, agree: true, passes: 3, totalCost: 0.18, ...overrides };
  }

  it('renders a passing vote exactly as before (byte-identical default)', () => {
    expect(reportVote('boundary-change/ge5', voteResult())).toBe(
      '✓ boundary-change/ge5 — 3/3 passed · $0.1800',
    );
  });

  it('renders a characterization fixture as a neutral non-gating ~ line', () => {
    const votes = [fakeRun(true), fakeRun(false), fakeRun(false)];
    const line = reportVote(
      'doc-truth/pr716-install-claim',
      voteResult({ votes, agree: false, passes: 1 }),
      { characterization: true },
    );
    expect(line).toBe(
      '~ doc-truth/pr716-install-claim — measured 1/3 (non-gating, see fixture header) · $0.1800',
    );
    expect(line).not.toContain('FLAKY');
  });
});

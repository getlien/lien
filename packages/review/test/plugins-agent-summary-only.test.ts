/**
 * Tests for the diff-only summary-only mode (issue #572, remaining half).
 *
 * Covers:
 *  - `isSummaryOnlyEligible`/`isSummaryOnlyMode` — the exact triple gate
 *  - `buildSummaryOnlyInitialMessage` — renders patches, truncation for huge diffs
 *  - `scaleSummaryOnlyBudget` — proportional to diff size, low-capped
 *  - `AgentReviewPlugin.shouldActivate` — activates ONLY under the exact
 *    triple condition (chunks empty + patches present + summary enabled)
 *  - `AgentReviewPlugin.analyze` — the summary-only branch renders the
 *    dedicated diff-only prompt (not the normal bug-hunting rules), and the
 *    normal (chunks-driven) path is unaffected — it never takes this branch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  isSummaryOnlyEligible,
  isSummaryOnlyMode,
  buildSummaryOnlyInitialMessage,
  buildSummaryOnlyPrompts,
  scaleSummaryOnlyBudget,
  MAX_SUMMARY_DIFF_CHARS,
  SUMMARY_ONLY_MAX_TURNS,
} from '../src/plugins/agent/summary-only-pass.js';
import { AgentReviewPlugin } from '../src/plugins/agent/index.js';
import { createTestContext } from '../src/test-helpers.js';
import type { ReviewContext } from '../src/plugin-types.js';
import { DEFAULT_REVIEW_MODEL } from '../src/defaults.js';

// ---------------------------------------------------------------------------
// isSummaryOnlyEligible / isSummaryOnlyMode
// ---------------------------------------------------------------------------

describe('isSummaryOnlyEligible — the exact triple gate', () => {
  it('is true only when all three conditions hold', () => {
    expect(isSummaryOnlyEligible(true, true, true)).toBe(true);
  });

  it('is false when chunks ARE analyzable, regardless of the other two', () => {
    expect(isSummaryOnlyEligible(false, true, true)).toBe(false);
    expect(isSummaryOnlyEligible(false, false, false)).toBe(false);
  });

  it('is false when summary is not enabled', () => {
    expect(isSummaryOnlyEligible(true, false, true)).toBe(false);
  });

  it('is false when there are no patches', () => {
    expect(isSummaryOnlyEligible(true, true, false)).toBe(false);
  });

  it('is false when nothing holds', () => {
    expect(isSummaryOnlyEligible(false, false, false)).toBe(false);
  });
});

describe('isSummaryOnlyMode — ReviewContext-shaped wrapper', () => {
  function ctx(overrides?: Partial<ReviewContext>): ReviewContext {
    return createTestContext({ chunks: [], ...overrides });
  }

  it('is true with empty chunks, summary enabled, and non-empty patches', () => {
    const context = ctx({ pr: { patches: new Map([['a.md', 'diff']]) } as ReviewContext['pr'] });
    expect(isSummaryOnlyMode(context, true)).toBe(true);
  });

  it('is false when chunks are present', () => {
    const context = ctx({
      chunks: [{ content: 'x' } as never],
      pr: { patches: new Map([['a.ts', 'diff']]) } as ReviewContext['pr'],
    });
    expect(isSummaryOnlyMode(context, true)).toBe(false);
  });

  it('is false when summaryEnabled is false', () => {
    const context = ctx({ pr: { patches: new Map([['a.md', 'diff']]) } as ReviewContext['pr'] });
    expect(isSummaryOnlyMode(context, false)).toBe(false);
  });

  it('is false when pr.patches is undefined or empty', () => {
    expect(isSummaryOnlyMode(ctx({ pr: undefined }), true)).toBe(false);
    expect(
      isSummaryOnlyMode(ctx({ pr: { patches: new Map() } as ReviewContext['pr'] }), true),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSummaryOnlyInitialMessage
// ---------------------------------------------------------------------------

describe('buildSummaryOnlyInitialMessage', () => {
  function ctx(overrides?: Partial<ReviewContext>): ReviewContext {
    return createTestContext({ chunks: [], ...overrides });
  }

  it('renders the PR metadata, changed files, and diff patches', () => {
    const context = ctx({
      allChangedFiles: ['CLAUDE.md'],
      pr: {
        title: 'docs: fix stale line',
        body: 'Removes a stale sentence.',
        patches: new Map([['CLAUDE.md', '@@ -1,2 +1,1 @@\n-stale line\n context']]),
      } as ReviewContext['pr'],
    });

    const message = buildSummaryOnlyInitialMessage(context);

    expect(message).toContain('<pr_metadata>');
    expect(message).toContain('docs: fix stale line');
    expect(message).toContain('Removes a stale sentence.');
    expect(message).toContain('<changed_files>');
    expect(message).toContain('- CLAUDE.md');
    expect(message).toContain('<diff>');
    expect(message).toContain('stale line');
    expect(message).toContain('This PR has no analyzable code chunks.');
  });

  it('falls back to changedFiles when allChangedFiles is absent', () => {
    const context = ctx({ changedFiles: ['README.md'], allChangedFiles: undefined });
    expect(buildSummaryOnlyInitialMessage(context)).toContain('- README.md');
  });

  it('says no diff is available when patches are absent', () => {
    const context = ctx({ pr: undefined });
    expect(buildSummaryOnlyInitialMessage(context)).toContain('(no diff available)');
  });

  it('truncates a huge diff and appends a truncation note', () => {
    const hugePatch = 'x'.repeat(MAX_SUMMARY_DIFF_CHARS + 5_000);
    const context = ctx({
      pr: { patches: new Map([['big.md', hugePatch]]) } as ReviewContext['pr'],
    });

    const message = buildSummaryOnlyInitialMessage(context);

    expect(message).toContain('[Diff truncated for this summary-only pass');
    // The raw diff section itself must not carry the full huge patch through.
    const diffSection = message.slice(message.indexOf('<diff>'), message.indexOf('</diff>'));
    expect(diffSection.length).toBeLessThan(hugePatch.length);
  });

  it('does not truncate a diff at or under the cap', () => {
    const patch = 'y'.repeat(1_000);
    const context = ctx({ pr: { patches: new Map([['small.md', patch]]) } as ReviewContext['pr'] });
    expect(buildSummaryOnlyInitialMessage(context)).not.toContain('truncated');
  });
});

// ---------------------------------------------------------------------------
// buildSummaryOnlyPrompts — reduced rule set, no bug-hunting rules
// ---------------------------------------------------------------------------

describe('buildSummaryOnlyPrompts', () => {
  it('enumerates ONLY the summary-only rule id in the output format', () => {
    const context = createTestContext({ chunks: [] });
    const { systemPrompt } = buildSummaryOnlyPrompts(context);
    expect(systemPrompt).toContain('REQUIRED — exactly one of: summary-only');
  });

  it('does not include any bug-hunting investigation strategy', () => {
    const context = createTestContext({ chunks: [] });
    const { systemPrompt } = buildSummaryOnlyPrompts(context);
    expect(systemPrompt).not.toContain('Structural Analysis');
    expect(systemPrompt).not.toContain('Edge Case Sweep');
    expect(systemPrompt).not.toContain('Threshold / Boundary Change Check');
    expect(systemPrompt).toContain('Diff-Only Summary');
  });
});

// ---------------------------------------------------------------------------
// scaleSummaryOnlyBudget
// ---------------------------------------------------------------------------

describe('scaleSummaryOnlyBudget', () => {
  it('scales with diff size within the clamp range', () => {
    const small = scaleSummaryOnlyBudget(new Map([['a.md', 'x'.repeat(4_000)]]), 'lean-model');
    const bigger = scaleSummaryOnlyBudget(new Map([['a.md', 'x'.repeat(40_000)]]), 'lean-model');
    expect(bigger).toBeGreaterThan(small);
  });

  it('clamps to the minimum for a tiny/absent diff', () => {
    expect(scaleSummaryOnlyBudget(new Map(), 'lean-model')).toBe(6_000);
    expect(scaleSummaryOnlyBudget(undefined, 'lean-model')).toBe(6_000);
  });

  it('clamps to the low ceiling for a huge diff — well below the normal 60K floor', () => {
    const huge = scaleSummaryOnlyBudget(new Map([['a.md', 'x'.repeat(400_000)]]), 'lean-model');
    expect(huge).toBe(20_000);
    expect(huge).toBeLessThan(60_000);
  });

  it('applies the model multiplier (Kimi vs a lean model)', () => {
    const patches = new Map([['a.md', 'x'.repeat(4_000)]]);
    const lean = scaleSummaryOnlyBudget(patches, 'some/lean-model');
    const kimi = scaleSummaryOnlyBudget(patches, DEFAULT_REVIEW_MODEL);
    expect(kimi).toBeGreaterThanOrEqual(lean);
  });

  it('always returns an integer (the config schema requires int)', () => {
    const odd = scaleSummaryOnlyBudget(
      new Map([['a.md', 'x'.repeat(4_003)]]),
      DEFAULT_REVIEW_MODEL,
    );
    expect(Number.isInteger(odd)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AgentReviewPlugin.shouldActivate — the exact triple condition
// ---------------------------------------------------------------------------

describe('AgentReviewPlugin.shouldActivate — summary-only gate', () => {
  function ctxWith(config: Record<string, unknown>, chunks: unknown[] = []): ReviewContext {
    return createTestContext({
      chunks: chunks as ReviewContext['chunks'],
      config,
      pr: config.__patches
        ? ({ patches: config.__patches } as ReviewContext['pr'])
        : (undefined as unknown as ReviewContext['pr']),
    });
  }

  const plugin = new AgentReviewPlugin();

  it('is false with no apiKey, regardless of chunks/summary/patches', () => {
    const context = ctxWith({ summaryEnabled: true, __patches: new Map([['a.md', 'd']]) });
    expect(plugin.shouldActivate(context)).toBe(false);
  });

  it('is true when chunks are present and apiKey is set (unchanged normal path)', () => {
    const context = ctxWith({ apiKey: 'k', summaryEnabled: false }, [{ content: 'code' }]);
    expect(plugin.shouldActivate(context)).toBe(true);
  });

  it('is false with empty chunks when summary is disabled (even with patches)', () => {
    const context = ctxWith({
      apiKey: 'k',
      summaryEnabled: false,
      __patches: new Map([['a.md', 'd']]),
    });
    expect(plugin.shouldActivate(context)).toBe(false);
  });

  it('is false with empty chunks and summary enabled but NO patches', () => {
    const context = ctxWith({ apiKey: 'k', summaryEnabled: true });
    expect(plugin.shouldActivate(context)).toBe(false);
  });

  it('is true ONLY for the exact triple: empty chunks + summary enabled + patches present', () => {
    const context = ctxWith({
      apiKey: 'k',
      summaryEnabled: true,
      __patches: new Map([['a.md', 'diff content']]),
    });
    expect(plugin.shouldActivate(context)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AgentReviewPlugin.analyze — branch selection (integration, via fetch mock)
// ---------------------------------------------------------------------------

type ChatResponse = {
  choices: Array<{ message: { role: string; content: string | null }; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

function stopTurn(content: string): ChatResponse {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

const CLEAN_JSON =
  '```json\n' +
  JSON.stringify({
    findings: [],
    summary: { riskLevel: 'low', overview: 'fine', keyChanges: [] },
  }) +
  '\n```';

/** Installs a fetch mock and returns the captured request bodies. */
function mockFetch(): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      const resp = stopTurn(CLEAN_JSON);
      return {
        ok: true,
        status: 200,
        json: async () => resp,
        text: async () => JSON.stringify(resp),
      };
    }),
  );
  return { bodies };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgentReviewPlugin.analyze — summary-only branch selection', () => {
  const plugin = new AgentReviewPlugin();

  it('takes the summary-only branch when chunks are empty and the gate is met', async () => {
    const { bodies } = mockFetch();
    const context = createTestContext({
      chunks: [],
      allChangedFiles: ['CLAUDE.md'],
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

    expect(bodies.length).toBeGreaterThan(0);
    const systemPrompt = bodies[0].messages as Array<{ role: string; content: string }>;
    const system = systemPrompt.find(m => m.role === 'system')!.content;
    const user = systemPrompt.find(m => m.role === 'user')!.content;
    expect(system).toContain('Diff-Only Summary');
    expect(system).not.toContain('Structural Analysis');
    expect(user).toContain('This PR has no analyzable code chunks.');
    expect(user).toContain('stale');
  });

  it('does NOT take the summary-only branch on the normal (chunks-driven) path', async () => {
    const { bodies } = mockFetch();
    const context = createTestContext({
      chunks: [
        {
          content: 'export function add(a, b) { return a + b; }',
          metadata: { file: 'src/math.ts', language: 'typescript', symbolType: 'function' },
        } as ReviewContext['chunks'][number],
      ],
      changedFiles: ['src/math.ts'],
      repoChunks: [],
      repoRootDir: '/tmp/does-not-matter',
      config: {
        apiKey: 'k',
        provider: 'openai',
        model: 'test-model',
        baseUrl: 'http://mock.local',
        maxTurns: 8,
        maxTokenBudget: 60_000,
        summaryEnabled: true,
        docTruthPass: false,
      },
      pr: {
        title: 'fix: math',
        patches: new Map([['src/math.ts', '@@ diff @@']]),
      } as ReviewContext['pr'],
    });

    await plugin.analyze(context);

    expect(bodies.length).toBeGreaterThan(0);
    const messages = bodies[0].messages as Array<{ role: string; content: string }>;
    const system = messages.find(m => m.role === 'system')!.content;
    expect(system).toContain('Structural Analysis');
    expect(system).not.toContain('Diff-Only Summary');
  });
});

describe('SUMMARY_ONLY_MAX_TURNS', () => {
  it('is a small, non-zero cap', () => {
    expect(SUMMARY_ONLY_MAX_TURNS).toBeGreaterThan(0);
    expect(SUMMARY_ONLY_MAX_TURNS).toBeLessThanOrEqual(8);
  });
});

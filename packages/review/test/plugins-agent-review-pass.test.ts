import { describe, it, expect, vi } from 'vitest';

import {
  runReviewPass,
  appendPassTurns,
  runExtraPasses,
  unspentMainBudget,
  EXTRA_PASS_MIN_BUDGET_TOKENS,
  OBSERVED_TOKENS_PER_TURN,
  VERDICT_EMISSION_RESERVE_TOKENS,
  MAX_DEFERRED_LABELS,
  affordableCandidateCeiling,
  capCandidatesToCeiling,
  deferredCandidateLabels,
  renderDeferralNote,
  type ReviewPassSpec,
} from '../src/plugins/agent/review-pass.js';
import { createTestContext, silentLogger } from '../src/test-helpers.js';
import type { ReviewContext } from '../src/plugin-types.js';
import type {
  AgentConfig,
  AgentFinding,
  AgentResult,
  AgentTrace,
  TurnTrace,
} from '../src/plugins/agent/types.js';

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

function cfg(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { model: 'm', maxTurns: 15, maxTokenBudget: 100_000, ...overrides };
}

function finding(overrides: Partial<AgentFinding> = {}): AgentFinding {
  return {
    filepath: 'a.ts',
    line: 1,
    severity: 'warning',
    category: 'bug',
    message: 'msg',
    ...overrides,
  };
}

function fakeResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    findings: [],
    summary: { riskLevel: 'low', overview: 'ok', keyChanges: [] },
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0.01 },
    turns: 1,
    stopReason: 'completed',
    incomplete: false,
    ...overrides,
  };
}

function turn(turnNumber: number, toolNames: string[] = []): TurnTrace {
  return {
    turnNumber,
    responseText: '',
    toolCalls: toolNames.map(name => ({ name, input: {}, output: 'ok' })),
    finishReason: 'stop',
  };
}

function trace(turns: TurnTrace[]): AgentTrace {
  return { systemPrompt: 's', initialMessage: 'i', model: 'm', turns };
}

/** A minimal, fully-controllable spec for exercising the generic executor. */
function makeSpec(overrides: Partial<ReviewPassSpec> = {}): ReviewPassSpec {
  return {
    name: 'test-pass',
    skipPlugin: 'agent-review:test-pass',
    gateReason: () => null,
    buildPrompts: () => ({ systemPrompt: 'sys', initialMessage: 'init' }),
    budget: base => Math.round(base * 0.5),
    maxTurns: 4,
    mergeFindings: (merged, passFindings) => [...merged, ...passFindings],
    mergeResultState: (main, passResult) => {
      if (passResult?.incomplete) main.incomplete = true;
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EXTRA_PASS_MIN_BUDGET_TOKENS
// ---------------------------------------------------------------------------

describe('EXTRA_PASS_MIN_BUDGET_TOKENS', () => {
  it('is at least one measured Kimi turn (#811: 5,526-6,564 tokens/turn) with real margin', () => {
    // Not a tautology on the current value — a regression that drops the
    // floor back toward the old per-pass minimums (4,000/5,000) would fail
    // this outright, since those are both below the measured per-turn cost.
    expect(EXTRA_PASS_MIN_BUDGET_TOKENS).toBeGreaterThanOrEqual(10_000);
    expect(EXTRA_PASS_MIN_BUDGET_TOKENS).toBeLessThanOrEqual(12_000);
  });
});

// ---------------------------------------------------------------------------
// unspentMainBudget — rolling unspent main-pass budget into extra passes
// (issue #836)
// ---------------------------------------------------------------------------

describe('unspentMainBudget', () => {
  it('reproduces PR #835 receipt shape: main allocated 20,000/spent 7,771 -> +12,229', () => {
    expect(unspentMainBudget(20_000, 7_771)).toBe(12_229);
  });

  it('floors at 0 when the main pass spent at or beyond its own allocation', () => {
    expect(unspentMainBudget(10_000, 10_000)).toBe(0);
    expect(unspentMainBudget(10_000, 15_000)).toBe(0);
  });

  it('returns the full allocation when the main pass spent nothing', () => {
    expect(unspentMainBudget(20_000, 0)).toBe(20_000);
  });
});

// ---------------------------------------------------------------------------
// affordableCandidateCeiling — candidate-overflow rank-and-cap ceiling
// ---------------------------------------------------------------------------

describe('affordableCandidateCeiling', () => {
  it('derives the reserve as EXTRA_PASS_MIN_BUDGET_TOKENS minus one observed turn', () => {
    expect(VERDICT_EMISSION_RESERVE_TOKENS).toBe(
      EXTRA_PASS_MIN_BUDGET_TOKENS - OBSERVED_TOKENS_PER_TURN,
    );
  });

  it('returns 0 when budget does not even cover the verdict-emission reserve', () => {
    expect(affordableCandidateCeiling(VERDICT_EMISSION_RESERVE_TOKENS - 1, 800)).toBe(0);
    expect(affordableCandidateCeiling(0, 800)).toBe(0);
  });

  it('returns 0 exactly AT the reserve boundary (nothing left to invest per-candidate)', () => {
    expect(affordableCandidateCeiling(VERDICT_EMISSION_RESERVE_TOKENS, 800)).toBe(0);
  });

  it('floors a non-exact division rather than rounding up', () => {
    // reserve + 1500 leaves exactly 1500 investigable at 800/candidate = 1.875 -> 1
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 1_500;
    expect(affordableCandidateCeiling(budget, 800)).toBe(1);
  });

  it('reproduces the #813 shape: a 15-candidate incomplete-handling run at its own scaled budget affords ~1', () => {
    // BASE_OVERHEAD_TOKENS(2,500) + PER_CANDIDATE_TOKENS(900) * 15 = 16,000 —
    // the "correctly scaled" budget #813 measured. Read-heavy candidates cost
    // OBSERVED_TOKENS_PER_TURN each, not the pass's own 900 prompt-sizing constant.
    const measuredBudget = 16_000;
    expect(affordableCandidateCeiling(measuredBudget, OBSERVED_TOKENS_PER_TURN)).toBe(1);
  });

  it('never returns negative, however small the budget', () => {
    expect(affordableCandidateCeiling(-5_000, 800)).toBe(0);
  });

  it('scales up with a larger budget for the same per-candidate cost', () => {
    const small = affordableCandidateCeiling(EXTRA_PASS_MIN_BUDGET_TOKENS, 500);
    const large = affordableCandidateCeiling(EXTRA_PASS_MIN_BUDGET_TOKENS * 4, 500);
    expect(large).toBeGreaterThan(small);
  });
});

// ---------------------------------------------------------------------------
// capCandidatesToCeiling — rank-and-cap, preserving the caller's own order
// ---------------------------------------------------------------------------

describe('capCandidatesToCeiling', () => {
  it('keeps everything and defers nothing when the list already fits', () => {
    const result = capCandidatesToCeiling(['a', 'b', 'c'], 5);
    expect(result).toEqual({ kept: ['a', 'b', 'c'], deferred: [] });
  });

  it('keeps everything and defers nothing at the exact boundary (length === ceiling)', () => {
    const result = capCandidatesToCeiling(['a', 'b', 'c'], 3);
    expect(result).toEqual({ kept: ['a', 'b', 'c'], deferred: [] });
  });

  it('truncates to the first `ceiling` entries, preserving order — no re-ranking', () => {
    const result = capCandidatesToCeiling(['a', 'b', 'c', 'd', 'e'], 2);
    expect(result.kept).toEqual(['a', 'b']);
    expect(result.deferred).toEqual(['c', 'd', 'e']);
  });

  it('defers everything when the ceiling is 0', () => {
    const result = capCandidatesToCeiling(['a', 'b'], 0);
    expect(result.kept).toEqual([]);
    expect(result.deferred).toEqual(['a', 'b']);
  });

  it('is a pure function — does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    capCandidatesToCeiling(input, 1);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// deferredCandidateLabels — attestation labels, capped short
// ---------------------------------------------------------------------------

describe('deferredCandidateLabels', () => {
  it('maps every deferred item through labelFor', () => {
    const labels = deferredCandidateLabels(['a', 'b'], s => s.toUpperCase());
    expect(labels).toEqual(['A', 'B']);
  });

  it('caps at MAX_DEFERRED_LABELS even when more were deferred', () => {
    const deferred = Array.from({ length: MAX_DEFERRED_LABELS + 5 }, (_, i) => `item-${i}`);
    const labels = deferredCandidateLabels(deferred, s => s);
    expect(labels).toHaveLength(MAX_DEFERRED_LABELS);
    expect(labels).toEqual(deferred.slice(0, MAX_DEFERRED_LABELS));
  });

  it('returns [] for an empty deferred list', () => {
    expect(deferredCandidateLabels([], s => s)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderDeferralNote — the honesty half of candidate-overflow handling
// ---------------------------------------------------------------------------

describe('renderDeferralNote', () => {
  it('is empty when nothing was deferred', () => {
    expect(renderDeferralNote(0)).toBe('');
  });

  it('names the count and instructs the model not to claim exhaustive coverage', () => {
    const note = renderDeferralNote(7);
    expect(note).toContain('7');
    expect(note).toMatch(/deferred/i);
    expect(note).toMatch(/not incompleteness/i);
  });
});

// ---------------------------------------------------------------------------
// runReviewPass
// ---------------------------------------------------------------------------

describe('runReviewPass', () => {
  it('does not invoke the client and returns null when the pass is gated off', async () => {
    const ctx = createTestContext();
    const spec = makeSpec({ gateReason: () => 'not eligible' });
    let called = false;

    const result = await runReviewPass(spec, ctx, cfg(), silentLogger, async () => {
      called = true;
      return fakeResult();
    });

    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it('reports the precise gate reason via context.reportSkip', async () => {
    const reportSkip = vi.fn();
    const ctx = { ...createTestContext(), reportSkip };
    const spec = makeSpec({ gateReason: () => 'no candidates found' });

    await runReviewPass(spec, ctx, cfg(), silentLogger, async () => fakeResult());

    expect(reportSkip).toHaveBeenCalledWith({
      plugin: 'agent-review:test-pass',
      reason: 'no candidates found',
    });
  });

  it('runs the client with the pass-specific budget/turns and returns its result', async () => {
    const ctx = createTestContext();
    const spec = makeSpec({ maxTurns: 7, budget: base => base * 0.25 });
    const captured: { sys?: string; init?: string; budget?: number; maxTurns?: number } = {};

    const result = await runReviewPass(
      spec,
      ctx,
      cfg({ maxTokenBudget: 80_000 }),
      silentLogger,
      async (sys, init, budget, maxTurns) => {
        Object.assign(captured, { sys, init, budget, maxTurns });
        return fakeResult({ findings: [finding()] });
      },
    );

    expect(result).not.toBeNull();
    expect(result!.findings).toHaveLength(1);
    expect(captured).toEqual({ sys: 'sys', init: 'init', budget: 20_000, maxTurns: 7 });
  });

  it('adds rolledOverBudget on top of the pass own computed budget (issue #836)', async () => {
    const ctx = createTestContext();
    const spec = makeSpec({ budget: base => base * 0.25 });
    const captured: { budget?: number } = {};

    await runReviewPass(
      spec,
      ctx,
      cfg({ maxTokenBudget: 80_000 }),
      silentLogger,
      async (_sys, _init, budget) => {
        captured.budget = budget;
        return fakeResult();
      },
      12_229, // PR #835's exact receipt shape: 20,000 allocated - 7,771 spent
    );

    // base 80,000 * 0.25 = 20,000, PLUS the rolled-over surplus.
    expect(captured.budget).toBe(20_000 + 12_229);
  });

  it('defaults rolledOverBudget to 0 when omitted (no regression)', async () => {
    const ctx = createTestContext();
    const spec = makeSpec({ budget: base => base * 0.25 });
    const captured: { budget?: number } = {};

    await runReviewPass(
      spec,
      ctx,
      cfg({ maxTokenBudget: 80_000 }),
      silentLogger,
      async (_sys, _init, budget) => {
        captured.budget = budget;
        return fakeResult();
      },
    );

    expect(captured.budget).toBe(20_000);
  });

  it('passes context through to budget() so a candidate-count-scaled pass can size itself', async () => {
    const ctx = createTestContext({ changedFiles: ['marker.ts'] });
    let seenContext: ReviewContext | undefined;
    const spec = makeSpec({
      budget: (base, context) => {
        seenContext = context;
        return base;
      },
    });

    await runReviewPass(spec, ctx, cfg(), silentLogger, async () => fakeResult());

    expect(seenContext).toBe(ctx);
  });

  it('runs postProcessResult on the raw client result before returning it', async () => {
    const ctx = createTestContext();
    const spec = makeSpec({
      postProcessResult: (result, context) => ({
        ...result,
        findings: [finding({ message: `post-processed:${context.changedFiles.length}` })],
      }),
    });

    const result = await runReviewPass(spec, ctx, cfg(), silentLogger, async () =>
      fakeResult({ findings: [finding({ message: 'raw' })] }),
    );

    expect(result!.findings).toEqual([finding({ message: 'post-processed:0' })]);
  });

  it('is a pass-through identity when postProcessResult is omitted (doc-truth needs nothing here)', async () => {
    const ctx = createTestContext();
    const spec = makeSpec(); // no postProcessResult
    const raw = fakeResult({ findings: [finding({ message: 'unchanged' })] });

    const result = await runReviewPass(spec, ctx, cfg(), silentLogger, async () => raw);

    expect(result).toEqual(raw);
  });

  it('isolates a pass failure: a throwing client yields null, logs a warning, reports the failure', async () => {
    const reportSkip = vi.fn();
    const ctx = { ...createTestContext(), reportSkip };
    const spec = makeSpec();
    const lines: string[] = [];
    const logger = {
      info: () => {},
      warning: (m: string) => lines.push(m),
      error: () => {},
      debug: () => {},
    };

    const result = await runReviewPass(spec, ctx, cfg(), logger, async () => {
      throw new Error('boom');
    });

    expect(result).toBeNull();
    expect(lines.some(l => l.includes('test-pass pass failed') && l.includes('boom'))).toBe(true);
    expect(reportSkip).toHaveBeenCalledWith({
      plugin: 'agent-review:test-pass',
      reason: 'failed: boom',
    });
  });

  it('does not report anything when the pass runs to completion', async () => {
    const reportSkip = vi.fn();
    const ctx = { ...createTestContext(), reportSkip };
    const spec = makeSpec();

    await runReviewPass(spec, ctx, cfg(), silentLogger, async () => fakeResult());

    expect(reportSkip).not.toHaveBeenCalled();
  });

  it('threads the SAME computed budget into both buildPrompts and postProcessResult (candidate-overflow consistency)', async () => {
    // A capping pass must rank-and-cap its worklist identically at prompt-build
    // time and at post-process time, or the verdict-coverage check would judge
    // a DIFFERENT worklist than the one actually shown to the model. Both call
    // sites must observe the exact same budget value — computed once.
    const ctx = createTestContext();
    const seenBudgets: number[] = [];
    const spec = makeSpec({
      budget: () => 12_345,
      buildPrompts: (_context, budget) => {
        seenBudgets.push(budget);
        return { systemPrompt: 'sys', initialMessage: 'init' };
      },
      postProcessResult: (result, _context, budget) => {
        seenBudgets.push(budget);
        return result;
      },
    });

    await runReviewPass(spec, ctx, cfg(), silentLogger, async () => fakeResult());

    expect(seenBudgets).toEqual([12_345, 12_345]);
  });
});

// ---------------------------------------------------------------------------
// appendPassTurns
// ---------------------------------------------------------------------------

describe('appendPassTurns', () => {
  it('appends renumbered turns stamped with the given phase', () => {
    const mainTrace = trace([turn(1, ['grep_codebase']), turn(2)]);
    const passTrace = trace([turn(1, ['get_files_context']), turn(2)]);

    appendPassTurns(mainTrace, passTrace, 'stale-duplicate');

    expect(mainTrace.turns).toHaveLength(4);
    expect(mainTrace.turns[2].turnNumber).toBe(3);
    expect(mainTrace.turns[2].phase).toBe('stale-duplicate');
    expect(mainTrace.turns[3].turnNumber).toBe(4);
    const toolNames = mainTrace.turns.flatMap(t => t.toolCalls.map(c => c.name));
    expect(toolNames).toContain('grep_codebase');
    expect(toolNames).toContain('get_files_context');
  });

  it('is a no-op when either trace is absent', () => {
    const mainTrace = trace([turn(1)]);
    expect(() => appendPassTurns(undefined, trace([turn(1)]), 'x')).not.toThrow();
    appendPassTurns(mainTrace, undefined, 'x');
    expect(mainTrace.turns).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// runExtraPasses — the ordered-list orchestrator
// ---------------------------------------------------------------------------

describe('runExtraPasses', () => {
  function mainResult(overrides: Partial<AgentResult> = {}): AgentResult {
    return fakeResult({ findings: [finding({ message: 'main finding' })], ...overrides });
  }

  it('runs every eligible pass IN ORDER, serially (not concurrently)', async () => {
    const order: string[] = [];
    const specA = makeSpec({ name: 'pass-a', skipPlugin: 'agent-review:pass-a' });
    const specB = makeSpec({ name: 'pass-b', skipPlugin: 'agent-review:pass-b' });
    const ctx = createTestContext();
    const main = mainResult();

    const runClientFor = (spec: ReviewPassSpec) => async () => {
      order.push(`${spec.name}-start`);
      // A microtask delay proves B does not start until A's promise settles.
      await new Promise(resolve => setTimeout(resolve, 5));
      order.push(`${spec.name}-end`);
      return fakeResult();
    };

    await runExtraPasses(
      [specA, specB],
      ctx,
      cfg(),
      silentLogger,
      main,
      main.findings,
      runClientFor,
    );

    expect(order).toEqual(['pass-a-start', 'pass-a-end', 'pass-b-start', 'pass-b-end']);
  });

  it("merges each pass's findings into the running list, in list order", async () => {
    const specA = makeSpec({ name: 'pass-a' });
    const specB = makeSpec({ name: 'pass-b' });
    const ctx = createTestContext();
    const main = mainResult();
    let call = 0;
    const runClientFor = () => async () => {
      call += 1;
      return fakeResult({ findings: [finding({ message: `finding-${call}` })] });
    };

    const { findings } = await runExtraPasses(
      [specA, specB],
      ctx,
      cfg(),
      silentLogger,
      main,
      main.findings,
      runClientFor,
    );

    expect(findings.map(f => f.message)).toEqual(['main finding', 'finding-1', 'finding-2']);
  });

  it('skips a pass that declines eligibility, recording the reason via reportSkip (feeds passesSkipped)', async () => {
    const reportSkip = vi.fn();
    const ctx = { ...createTestContext(), reportSkip };
    const eligible = makeSpec({ name: 'eligible-pass' });
    const declined = makeSpec({ name: 'declined-pass', gateReason: () => 'no work to do' });
    const main = mainResult();
    const ran: string[] = [];
    const runClientFor = (spec: ReviewPassSpec) => async () => {
      ran.push(spec.name);
      return fakeResult();
    };

    const { outcomes } = await runExtraPasses(
      [declined, eligible],
      ctx,
      cfg(),
      silentLogger,
      main,
      main.findings,
      runClientFor,
    );

    // The declined pass's client never ran, and only the eligible pass shows
    // up as a real outcome — the declined one is reported via reportSkip only.
    expect(ran).toEqual(['eligible-pass']);
    expect(outcomes.map(o => o.name)).toEqual(['eligible-pass']);
    expect(reportSkip).toHaveBeenCalledWith({
      plugin: 'agent-review:test-pass',
      reason: 'no work to do',
    });
  });

  it('skips every pass without evaluating its gate when the main pass never ran', async () => {
    const gateSpy = vi.fn(() => null);
    const spec = makeSpec({ name: 'never-run-guard', gateReason: gateSpy });
    const reportSkip = vi.fn();
    const ctx = { ...createTestContext(), reportSkip };
    const main = fakeResult({ neverRan: true, incomplete: true, stopReason: 'error' });

    const { outcomes } = await runExtraPasses(
      [spec],
      ctx,
      cfg(),
      silentLogger,
      main,
      [],
      () => async () => fakeResult(),
    );

    expect(gateSpy).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
    expect(reportSkip).toHaveBeenCalledWith({
      plugin: 'agent-review:test-pass',
      reason: 'main pass never ran (provider failure)',
    });
  });

  it('reports one outcome per pass that actually ran, with its own budget/stopReason', async () => {
    const specA = makeSpec({ name: 'pass-a', budget: () => 10_000 });
    const specB = makeSpec({ name: 'pass-b', budget: () => 5_000 });
    const ctx = createTestContext();
    const main = mainResult();
    const runClientFor = (spec: ReviewPassSpec) => async () =>
      spec.name === 'pass-b'
        ? fakeResult({
            stopReason: 'budget',
            incomplete: true,
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 4_000, cost: 0.02 },
          })
        : fakeResult({
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 9_000, cost: 0.05 },
          });

    const { outcomes } = await runExtraPasses(
      [specA, specB],
      ctx,
      cfg(),
      silentLogger,
      main,
      main.findings,
      runClientFor,
    );

    expect(outcomes).toEqual([
      {
        name: 'pass-a',
        stopReason: 'completed',
        neverRan: false,
        allocatedTokens: 10_000,
        spentTokens: 9_000,
        candidatesDeferred: 0,
        deferredCandidateIds: undefined,
      },
      {
        name: 'pass-b',
        stopReason: 'budget',
        neverRan: false,
        allocatedTokens: 5_000,
        spentTokens: 4_000,
        candidatesDeferred: 0,
        deferredCandidateIds: undefined,
      },
    ]);
  });

  it('gives the FIRST pass the full rollover when it does not touch it, undiminished for the next pass', async () => {
    // PR #835's exact receipt shape: main allocated 20,000, spent 7,771 ->
    // +12,229 rolled into the shared pool. pass-a spends well within its OWN
    // budget (10,000) — it never draws on the rollover, so pass-b still
    // sees the full, undiminished 12,229.
    const specA = makeSpec({ name: 'pass-a', budget: () => 10_000 });
    const specB = makeSpec({ name: 'pass-b', budget: () => 5_000 });
    const ctx = createTestContext();
    const main = mainResult();
    const seenBudgets: number[] = [];
    const runClientFor = () => async (_sys: string, _init: string, budget: number) => {
      seenBudgets.push(budget);
      return fakeResult({
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 3_000, cost: 0 },
      });
    };

    const { outcomes } = await runExtraPasses(
      [specA, specB],
      ctx,
      cfg(),
      silentLogger,
      main,
      main.findings,
      runClientFor,
      12_229,
    );

    // Both passes' own client calls ran with the SAME full rollover added —
    // pass-a never dipped into it (spent 3,000 of its own 10,000), so it's
    // still fully available to pass-b.
    expect(seenBudgets).toEqual([10_000 + 12_229, 5_000 + 12_229]);
    expect(outcomes.map(o => o.allocatedTokens)).toEqual([10_000 + 12_229, 5_000 + 12_229]);
  });

  it("depletes the shared rollover pool as a pass actually draws on it — doesn't hand the same tokens to every pass independently (issue #836 dogfood fix)", async () => {
    // Reproduces the real bug PR #837's own dogfood run on this repo caught:
    // main allocated 250,000/spent 241,131 (+8,869 rolled over), and doc-truth
    // (own budget 12,000) overspent to 56,430 — consuming the ENTIRE 8,869
    // rollover, not just its own 12,000. Before this fix, stale-duplicate-loop
    // (own budget 11,000) and incomplete-handling-loop (own budget 65,000)
    // BOTH still showed the full, undiminished 8,869 in their own
    // allocatedTokens (19,869 / 73,869) — as if the SAME 8,869 tokens were
    // handed to all three passes independently, rather than one pool spent at
    // most once in total.
    const docTruthLike = makeSpec({ name: 'doc-truth', budget: () => 12_000 });
    const staleDupLike = makeSpec({ name: 'stale-duplicate-loop', budget: () => 11_000 });
    const incompleteLike = makeSpec({ name: 'incomplete-handling-loop', budget: () => 65_000 });
    const ctx = createTestContext();
    const main = mainResult();
    const runClientFor = (spec: ReviewPassSpec) => async () =>
      spec.name === 'doc-truth'
        ? fakeResult({
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 56_430, cost: 0 },
          })
        : fakeResult({ usage: { promptTokens: 0, completionTokens: 0, totalTokens: 1, cost: 0 } });

    const { outcomes } = await runExtraPasses(
      [docTruthLike, staleDupLike, incompleteLike],
      ctx,
      cfg(),
      silentLogger,
      main,
      main.findings,
      runClientFor,
      8_869,
    );

    // doc-truth: its own 12,000 + the full 8,869 pool (nothing depleted yet).
    // Overspending past its own allocation consumes the ENTIRE pool.
    expect(outcomes[0]).toMatchObject({ name: 'doc-truth', allocatedTokens: 12_000 + 8_869 });
    // stale-duplicate-loop and incomplete-handling-loop see the pool ALREADY
    // exhausted by doc-truth — their own allocatedTokens carry NO rollover,
    // not another independent 8,869 (the bug this test guards against).
    expect(outcomes[1]).toMatchObject({ name: 'stale-duplicate-loop', allocatedTokens: 11_000 });
    expect(outcomes[2]).toMatchObject({
      name: 'incomplete-handling-loop',
      allocatedTokens: 65_000,
    });
  });

  it('partially depletes the pool when a pass draws on only some of the rollover', async () => {
    const specA = makeSpec({ name: 'pass-a', budget: () => 10_000 });
    const specB = makeSpec({ name: 'pass-b', budget: () => 5_000 });
    const ctx = createTestContext();
    const main = mainResult();
    const runClientFor = (spec: ReviewPassSpec) => async () =>
      // pass-a's own budget is 10,000; it spends 12,000 -> draws 2,000 from
      // the 5,000-token pool, leaving 3,000 for pass-b.
      spec.name === 'pass-a'
        ? fakeResult({
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 12_000, cost: 0 },
          })
        : fakeResult({ usage: { promptTokens: 0, completionTokens: 0, totalTokens: 1, cost: 0 } });

    const { outcomes } = await runExtraPasses(
      [specA, specB],
      ctx,
      cfg(),
      silentLogger,
      main,
      main.findings,
      runClientFor,
      5_000,
    );

    expect(outcomes[0]).toMatchObject({ name: 'pass-a', allocatedTokens: 10_000 + 5_000 });
    expect(outcomes[1]).toMatchObject({ name: 'pass-b', allocatedTokens: 5_000 + 3_000 });
  });

  it('defaults rolledOverBudget to 0 when omitted (no regression)', async () => {
    const spec = makeSpec({ name: 'pass-a', budget: () => 10_000 });
    const ctx = createTestContext();
    const main = mainResult();

    const { outcomes } = await runExtraPasses(
      [spec],
      ctx,
      cfg(),
      silentLogger,
      main,
      main.findings,
      () => async () => fakeResult(),
    );

    expect(outcomes[0].allocatedTokens).toBe(10_000);
  });

  it('reads candidatesDeferred/deferredCandidateIds straight off the pass result (candidate-overflow attestation)', async () => {
    const spec = makeSpec({ name: 'capped-pass' });
    const ctx = createTestContext();
    const main = mainResult();
    const runClientFor = () => async () =>
      fakeResult({ candidatesDeferred: 3, deferredCandidateIds: ['x', 'y', 'z'] });

    const { outcomes } = await runExtraPasses(
      [spec],
      ctx,
      cfg(),
      silentLogger,
      main,
      main.findings,
      runClientFor,
    );

    expect(outcomes).toEqual([
      expect.objectContaining({
        name: 'capped-pass',
        candidatesDeferred: 3,
        deferredCandidateIds: ['x', 'y', 'z'],
      }),
    ]);
  });

  it('defaults candidatesDeferred to 0 when the pass result does not set it (no overflow handling)', async () => {
    const spec = makeSpec();
    const ctx = createTestContext();
    const main = mainResult();

    const { outcomes } = await runExtraPasses(
      [spec],
      ctx,
      cfg(),
      silentLogger,
      main,
      main.findings,
      () => async () => fakeResult(),
    );

    expect(outcomes[0].candidatesDeferred).toBe(0);
    expect(outcomes[0].deferredCandidateIds).toBeUndefined();
  });

  it('does not add an outcome for a pass whose client throws (failure-isolated)', async () => {
    const spec = makeSpec();
    const ctx = createTestContext();
    const main = mainResult();

    const { outcomes, findings } = await runExtraPasses(
      [spec],
      ctx,
      cfg(),
      silentLogger,
      main,
      main.findings,
      () => async () => {
        throw new Error('boom');
      },
    );

    expect(outcomes).toEqual([]);
    // The main-pass findings survive untouched — a pass-2+ error never fails the review.
    expect(findings).toEqual(main.findings);
  });
});

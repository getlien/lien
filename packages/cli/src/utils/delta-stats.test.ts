import { describe, it, expect } from 'vitest';
import { computeDeltaWindowStats } from './delta-stats.js';
import type { DeltaEvent } from './delta-events.js';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY_MS).toISOString();
}

function event(overrides: Partial<DeltaEvent> = {}): DeltaEvent {
  return {
    timestamp: daysAgo(0),
    mode: 'normal',
    exitCode: 0,
    counts: { crossings: 0, newOverThreshold: 0, improved: 0 },
    flagged: [],
    ...overrides,
  };
}

describe('computeDeltaWindowStats — windowing', () => {
  it('counts zero runs when there are no events', () => {
    const stats = computeDeltaWindowStats([], 7, NOW);
    expect(stats).toMatchObject({ windowDays: 7, runs: 0, runsWithCrossings: 0 });
  });

  it('excludes events older than the window', () => {
    const events = [event({ timestamp: daysAgo(1) }), event({ timestamp: daysAgo(8) })];
    expect(computeDeltaWindowStats(events, 7, NOW).runs).toBe(1);
    expect(computeDeltaWindowStats(events, 30, NOW).runs).toBe(2);
  });

  it('includes an event exactly at the window boundary', () => {
    const events = [event({ timestamp: daysAgo(7) })];
    expect(computeDeltaWindowStats(events, 7, NOW).runs).toBe(1);
  });

  it('drops events with an unparsable timestamp instead of crashing', () => {
    const events = [event({ timestamp: 'not-a-date' }), event({ timestamp: daysAgo(1) })];
    expect(computeDeltaWindowStats(events, 7, NOW).runs).toBe(1);
  });
});

describe('computeDeltaWindowStats — runsWithCrossings', () => {
  it('counts only runs whose counts.crossings > 0', () => {
    const events = [
      event({ counts: { crossings: 0, newOverThreshold: 0, improved: 1 } }),
      event({ counts: { crossings: 2, newOverThreshold: 1, improved: 0 } }),
      event({ counts: { crossings: 1, newOverThreshold: 1, improved: 0 } }),
    ];
    expect(computeDeltaWindowStats(events, 7, NOW).runs).toBe(3);
    expect(computeDeltaWindowStats(events, 7, NOW).runsWithCrossings).toBe(2);
  });
});

describe('computeDeltaWindowStats — distinctFunctionsFlagged', () => {
  it('dedupes the same function across multiple runs and metrics', () => {
    const events = [
      event({
        counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
        flagged: [{ filepath: 'a.ts', symbol: 'foo', metric: 'cognitive' }],
      }),
      event({
        counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
        // same function flagged again, this time also on a second metric
        flagged: [
          { filepath: 'a.ts', symbol: 'foo', metric: 'cognitive' },
          { filepath: 'a.ts', symbol: 'foo', metric: 'cyclomatic' },
        ],
      }),
      event({
        counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
        flagged: [{ filepath: 'b.ts', symbol: 'bar', metric: 'cognitive' }],
      }),
    ];
    expect(computeDeltaWindowStats(events, 7, NOW).distinctFunctionsFlagged).toBe(2);
  });

  it('treats the same symbol name in different files as distinct functions', () => {
    const events = [
      event({
        counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
        flagged: [{ filepath: 'a.ts', symbol: 'foo', metric: 'cognitive' }],
      }),
      event({
        counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
        flagged: [{ filepath: 'b.ts', symbol: 'foo', metric: 'cognitive' }],
      }),
    ];
    expect(computeDeltaWindowStats(events, 7, NOW).distinctFunctionsFlagged).toBe(2);
  });
});

describe('computeDeltaWindowStats — resolvedAfterFlag', () => {
  it('counts a function flagged then absent in a strictly later run', () => {
    const events = [
      event({
        timestamp: daysAgo(3),
        counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
        flagged: [{ filepath: 'a.ts', symbol: 'foo', metric: 'cognitive' }],
      }),
      event({
        timestamp: daysAgo(1),
        counts: { crossings: 0, newOverThreshold: 0, improved: 1 },
        flagged: [],
      }),
    ];
    expect(computeDeltaWindowStats(events, 7, NOW).resolvedAfterFlag).toBe(1);
  });

  it('does not count a function that is still flagged in the later run', () => {
    const events = [
      event({
        timestamp: daysAgo(3),
        counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
        flagged: [{ filepath: 'a.ts', symbol: 'foo', metric: 'cognitive' }],
      }),
      event({
        timestamp: daysAgo(1),
        counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
        flagged: [{ filepath: 'a.ts', symbol: 'foo', metric: 'cognitive' }],
      }),
    ];
    expect(computeDeltaWindowStats(events, 7, NOW).resolvedAfterFlag).toBe(0);
  });

  it('does not count a function flagged only once with no later run to confirm resolution', () => {
    const events = [
      event({
        timestamp: daysAgo(1),
        counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
        flagged: [{ filepath: 'a.ts', symbol: 'foo', metric: 'cognitive' }],
      }),
    ];
    expect(computeDeltaWindowStats(events, 7, NOW).resolvedAfterFlag).toBe(0);
  });

  it('once resolved, stays resolved even if a still-later run re-flags the same function', () => {
    const events = [
      event({
        timestamp: daysAgo(5),
        counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
        flagged: [{ filepath: 'a.ts', symbol: 'foo', metric: 'cognitive' }],
      }),
      event({
        timestamp: daysAgo(3),
        counts: { crossings: 0, newOverThreshold: 0, improved: 1 },
        flagged: [],
      }),
      event({
        timestamp: daysAgo(1),
        counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
        flagged: [{ filepath: 'a.ts', symbol: 'foo', metric: 'cognitive' }],
      }),
    ];
    expect(computeDeltaWindowStats(events, 7, NOW).resolvedAfterFlag).toBe(1);
  });

  it('counts each distinct resolved function once, not once per event', () => {
    const events = [
      event({
        timestamp: daysAgo(5),
        counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
        flagged: [
          { filepath: 'a.ts', symbol: 'foo', metric: 'cognitive' },
          { filepath: 'b.ts', symbol: 'bar', metric: 'cyclomatic' },
        ],
      }),
      event({
        timestamp: daysAgo(1),
        counts: { crossings: 0, newOverThreshold: 0, improved: 1 },
        flagged: [],
      }),
    ];
    expect(computeDeltaWindowStats(events, 7, NOW).resolvedAfterFlag).toBe(2);
  });
});

describe('computeDeltaWindowStats — softShareOfFlaggedRuns', () => {
  it('is null when there are no crossing-having runs', () => {
    const events = [event({ counts: { crossings: 0, newOverThreshold: 0, improved: 1 } })];
    expect(computeDeltaWindowStats(events, 7, NOW).softShareOfFlaggedRuns).toBeNull();
  });

  it('computes the share of flagged runs that were --soft', () => {
    const events = [
      event({ mode: 'soft', counts: { crossings: 1, newOverThreshold: 1, improved: 0 } }),
      event({ mode: 'normal', counts: { crossings: 1, newOverThreshold: 1, improved: 0 } }),
      event({ mode: 'normal', counts: { crossings: 0, newOverThreshold: 0, improved: 1 } }), // no crossings, excluded
    ];
    expect(computeDeltaWindowStats(events, 7, NOW).softShareOfFlaggedRuns).toBeCloseTo(0.5);
  });

  it('is 1 when every flagged run was --soft', () => {
    const events = [
      event({ mode: 'soft', counts: { crossings: 1, newOverThreshold: 1, improved: 0 } }),
    ];
    expect(computeDeltaWindowStats(events, 7, NOW).softShareOfFlaggedRuns).toBe(1);
  });
});

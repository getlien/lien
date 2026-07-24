import { describe, it, expect } from 'vitest';
import { computeBlastWindowStats } from './blast-stats.js';
import type { BlastEvent } from './blast-events.js';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY_MS).toISOString();
}

function event(overrides: Partial<BlastEvent> = {}): BlastEvent {
  return {
    timestamp: daysAgo(0),
    filepath: 'src/foo.ts',
    changes: [
      {
        symbol: 'foo',
        kind: 'signature-changed',
        dependentCount: 2,
        untestedDependentCount: 0,
        riskLevel: 'low',
      },
    ],
    enriched: true,
    ...overrides,
  };
}

describe('computeBlastWindowStats — windowing', () => {
  it('counts zero runs when there are no events', () => {
    const stats = computeBlastWindowStats([], 7, NOW);
    expect(stats).toMatchObject({ windowDays: 7, runs: 0, distinctSymbolsChanged: 0 });
  });

  it('excludes events older than the window', () => {
    const events = [event({ timestamp: daysAgo(1) }), event({ timestamp: daysAgo(8) })];
    expect(computeBlastWindowStats(events, 7, NOW).runs).toBe(1);
    expect(computeBlastWindowStats(events, 30, NOW).runs).toBe(2);
  });

  it('includes an event exactly at the window boundary', () => {
    const events = [event({ timestamp: daysAgo(7) })];
    expect(computeBlastWindowStats(events, 7, NOW).runs).toBe(1);
  });

  it('drops events with an unparsable timestamp instead of crashing', () => {
    const events = [event({ timestamp: 'not-a-date' }), event({ timestamp: daysAgo(1) })];
    expect(computeBlastWindowStats(events, 7, NOW).runs).toBe(1);
  });
});

describe('computeBlastWindowStats — distinctSymbolsChanged', () => {
  it('dedupes the same (filepath, symbol) across runs', () => {
    const events = [
      event({
        filepath: 'a.ts',
        changes: [
          {
            symbol: 'foo',
            kind: 'signature-changed',
            dependentCount: 1,
            untestedDependentCount: 0,
            riskLevel: 'low',
          },
        ],
      }),
      event({
        filepath: 'a.ts',
        changes: [
          {
            symbol: 'foo',
            kind: 'removed',
            dependentCount: 1,
            untestedDependentCount: 0,
            riskLevel: 'low',
          },
        ],
      }),
      event({
        filepath: 'b.ts',
        changes: [
          {
            symbol: 'foo',
            kind: 'signature-changed',
            dependentCount: 1,
            untestedDependentCount: 0,
            riskLevel: 'low',
          },
        ],
      }),
    ];
    // Same symbol name in two different files counts as two distinct symbols.
    expect(computeBlastWindowStats(events, 7, NOW).distinctSymbolsChanged).toBe(2);
  });

  it('counts multiple symbols changed within a single event', () => {
    const events = [
      event({
        changes: [
          {
            symbol: 'foo',
            kind: 'signature-changed',
            dependentCount: 1,
            untestedDependentCount: 0,
            riskLevel: 'low',
          },
          {
            symbol: 'Widget.render',
            kind: 'removed',
            dependentCount: 3,
            untestedDependentCount: 1,
            riskLevel: 'high',
          },
        ],
      }),
    ];
    expect(computeBlastWindowStats(events, 7, NOW).distinctSymbolsChanged).toBe(2);
  });
});

describe('computeBlastWindowStats — byRiskLevel', () => {
  it('buckets each change by its riskLevel', () => {
    const events = [
      event({
        changes: [
          {
            symbol: 'a',
            kind: 'signature-changed',
            dependentCount: 1,
            untestedDependentCount: 0,
            riskLevel: 'low',
          },
          {
            symbol: 'b',
            kind: 'removed',
            dependentCount: 10,
            untestedDependentCount: 2,
            riskLevel: 'high',
          },
        ],
      }),
      event({
        filepath: 'c.ts',
        changes: [
          {
            symbol: 'c',
            kind: 'signature-changed',
            dependentCount: 60,
            untestedDependentCount: 5,
            riskLevel: 'critical',
          },
        ],
      }),
    ];
    expect(computeBlastWindowStats(events, 7, NOW).byRiskLevel).toEqual({
      low: 1,
      medium: 0,
      high: 1,
      critical: 1,
      unknown: 0,
    });
  });

  it('buckets a degraded (null riskLevel) change as unknown', () => {
    const events = [
      event({
        enriched: false,
        changes: [
          {
            symbol: 'a',
            kind: 'signature-changed',
            dependentCount: null,
            untestedDependentCount: null,
            riskLevel: null,
          },
        ],
      }),
    ];
    expect(computeBlastWindowStats(events, 7, NOW).byRiskLevel.unknown).toBe(1);
  });
});

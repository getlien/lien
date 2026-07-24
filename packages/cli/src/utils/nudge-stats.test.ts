import { describe, it, expect } from 'vitest';
import { computeNudgeFunnels, type NudgeFunnel } from './nudge-stats.js';
import type { NudgeEvent } from './nudge-events.js';
import type { DeltaEvent } from './delta-events.js';

const NOW = new Date('2026-07-24T12:00:00.000Z');

function at(hoursAgo: number): string {
  return new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function shown(
  nudge: 'annotate' | 'blast' | 'test-verify',
  sessionId: string,
  ts: string,
  file?: string,
): NudgeEvent {
  return { kind: 'shown', timestamp: ts, sessionId, nudge, ...(file ? { file } : {}) };
}

function signal(
  sig: 'get_dependents' | 'get_files_context' | 'test_run',
  sessionId: string,
  ts: string,
): NudgeEvent {
  return { kind: 'signal', timestamp: ts, sessionId, signal: sig };
}

/** Pull one funnel out of the computed set for a window. */
function funnel(funnels: NudgeFunnel[], nudge: NudgeFunnel['nudge']): NudgeFunnel {
  const f = funnels.find(x => x.nudge === nudge);
  if (!f) throw new Error(`no funnel for ${nudge}`);
  return f;
}

describe('computeNudgeFunnels — shape', () => {
  it('emits delta first, then annotate/blast/test-verify', () => {
    const funnels = computeNudgeFunnels([], [], 7, NOW);
    expect(funnels.map(f => f.nudge)).toEqual(['delta', 'annotate', 'blast', 'test-verify']);
  });

  it('reports zero shown with a null actedShare when nothing was recorded', () => {
    const f = funnel(computeNudgeFunnels([], [], 7, NOW), 'annotate');
    expect(f).toMatchObject({ shown: 0, acted: 0, actedShare: null, windowDays: 7 });
  });
});

describe('shown → acted join', () => {
  it('counts a shown as acted when a qualifying signal follows it in the same session', () => {
    const events = [
      shown('blast', 's1', at(5), 'a.ts'),
      signal('get_dependents', 's1', at(4)), // 1h later
    ];
    const f = funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast');
    expect(f).toMatchObject({ shown: 1, acted: 1, actedShare: 1 });
  });

  it('does NOT count a signal that occurred BEFORE the shown event', () => {
    const events = [
      signal('get_dependents', 's1', at(6)), // before
      shown('blast', 's1', at(5)),
    ];
    const f = funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast');
    expect(f).toMatchObject({ shown: 1, acted: 0, actedShare: 0 });
  });

  it('does NOT count a signal from a different session', () => {
    const events = [shown('blast', 's1', at(5)), signal('get_dependents', 's2', at(4))];
    const f = funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast');
    expect(f).toMatchObject({ shown: 1, acted: 0 });
  });

  it('requires the signal type the nudge cares about (a test_run does not act a blast nudge)', () => {
    const events = [shown('blast', 's1', at(5)), signal('test_run', 's1', at(4))];
    const f = funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast');
    expect(f).toMatchObject({ shown: 1, acted: 0 });
  });

  it('annotate is acted by get_files_context OR get_dependents', () => {
    const ctx = [shown('annotate', 's1', at(5)), signal('get_files_context', 's1', at(4))];
    expect(funnel(computeNudgeFunnels(ctx, [], 7, NOW), 'annotate').acted).toBe(1);
    const deps = [shown('annotate', 's2', at(5)), signal('get_dependents', 's2', at(4))];
    expect(funnel(computeNudgeFunnels(deps, [], 7, NOW), 'annotate').acted).toBe(1);
  });

  it('test-verify is acted by a subsequent test_run', () => {
    const events = [shown('test-verify', 's1', at(5)), signal('test_run', 's1', at(4))];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'test-verify').acted).toBe(1);
  });

  it('counts each shown independently and aggregates the share', () => {
    const events = [
      shown('annotate', 's1', at(5)),
      signal('get_files_context', 's1', at(4)), // acts the s1 shown
      shown('annotate', 's2', at(5)), // no follow-up
    ];
    const f = funnel(computeNudgeFunnels(events, [], 7, NOW), 'annotate');
    expect(f).toMatchObject({ shown: 2, acted: 1, actedShare: 0.5 });
  });

  it('a single later signal acts every earlier shown of the same nudge in the session', () => {
    const events = [
      shown('annotate', 's1', at(6)),
      shown('annotate', 's1', at(5)),
      signal('get_dependents', 's1', at(4)),
    ];
    const f = funnel(computeNudgeFunnels(events, [], 7, NOW), 'annotate');
    expect(f).toMatchObject({ shown: 2, acted: 2 });
  });
});

describe('window filtering', () => {
  it('excludes shown events older than the window', () => {
    const events = [
      shown('blast', 's1', at(24 * 40)), // 40 days ago — outside 7 and 30
      signal('get_dependents', 's1', at(24 * 40 - 1)),
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast').shown).toBe(0);
    expect(funnel(computeNudgeFunnels(events, [], 30, NOW), 'blast').shown).toBe(0);
  });

  it('includes shown events inside the window', () => {
    const events = [
      shown('blast', 's1', at(24 * 10)),
      signal('get_dependents', 's1', at(24 * 10 - 1)),
    ];
    // 10 days ago: outside 7-day, inside 30-day.
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast').shown).toBe(0);
    expect(funnel(computeNudgeFunnels(events, [], 30, NOW), 'blast')).toMatchObject({
      shown: 1,
      acted: 1,
    });
  });
});

describe('delta funnel (sourced from delta-events, not nudge-events)', () => {
  function deltaEvent(
    ts: string,
    flagged: Array<{ filepath: string; symbol: string }>,
  ): DeltaEvent {
    return {
      timestamp: ts,
      mode: 'normal',
      exitCode: flagged.length > 0 ? 1 : 0,
      counts: { crossings: flagged.length, newOverThreshold: flagged.length, improved: 0 },
      flagged: flagged.map(f => ({ ...f, metric: 'cyclomatic' as const })),
    };
  }

  it('maps distinctFunctionsFlagged → shown and resolvedAfterFlag → acted', () => {
    const deltaEvents = [
      deltaEvent(at(5), [{ filepath: 'a.ts', symbol: 'foo' }]), // flagged
      deltaEvent(at(4), []), // foo now clean → resolved
    ];
    const f = funnel(computeNudgeFunnels([], deltaEvents, 7, NOW), 'delta');
    expect(f).toMatchObject({ shown: 1, acted: 1, actedShare: 1 });
  });

  it('a still-flagged function counts as shown but not acted', () => {
    const deltaEvents = [
      deltaEvent(at(5), [{ filepath: 'a.ts', symbol: 'foo' }]),
      deltaEvent(at(4), [{ filepath: 'a.ts', symbol: 'foo' }]),
    ];
    const f = funnel(computeNudgeFunnels([], deltaEvents, 7, NOW), 'delta');
    expect(f).toMatchObject({ shown: 1, acted: 0 });
  });
});

describe('unparsable timestamps', () => {
  it('drops events with an unparsable timestamp rather than crashing', () => {
    const events: NudgeEvent[] = [
      { kind: 'shown', timestamp: 'not-a-date', sessionId: 's1', nudge: 'blast' },
      shown('blast', 's1', at(5)),
      signal('get_dependents', 's1', at(4)),
    ];
    const f = funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast');
    expect(f).toMatchObject({ shown: 1, acted: 1 });
  });
});

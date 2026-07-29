import { describe, it, expect } from 'vitest';
import {
  computeNudgeFunnels,
  computeNudgeRecordingStatus,
  latestBuildStampedEvent,
  type NudgeFunnel,
} from './nudge-stats.js';
import type { NudgeEvent } from './nudge-events.js';
import type { DeltaEvent } from './delta-events.js';
import type { BuildStamp } from './nudge-build.js';

const NOW = new Date('2026-07-24T12:00:00.000Z');

function at(hoursAgo: number): string {
  return new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function shown(
  nudge: 'annotate' | 'blast' | 'test-verify',
  sessionId: string,
  ts: string,
  opts: { file?: string; symbol?: string } = {},
): NudgeEvent {
  return {
    kind: 'shown',
    timestamp: ts,
    sessionId,
    nudge,
    ...(opts.file ? { file: opts.file } : {}),
    ...(opts.symbol ? { symbol: opts.symbol } : {}),
  };
}

function signal(
  sig: 'get_dependents' | 'get_files_context' | 'test_run',
  sessionId: string,
  ts: string,
  opts: { file?: string; symbol?: string } = {},
): NudgeEvent {
  return {
    kind: 'signal',
    timestamp: ts,
    sessionId,
    signal: sig,
    ...(opts.file ? { file: opts.file } : {}),
    ...(opts.symbol ? { symbol: opts.symbol } : {}),
  };
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

describe('matched shown → acted join', () => {
  it('counts a shown as acted when a same-file signal follows it in the same session', () => {
    const events = [
      shown('blast', 's1', at(5), { file: 'a.ts' }),
      signal('get_dependents', 's1', at(4), { file: 'a.ts' }), // same file, 1h later
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast')).toMatchObject({
      shown: 1,
      acted: 1,
      actedShare: 1,
    });
  });

  it('does NOT count a same-file signal that occurred BEFORE the shown', () => {
    const events = [
      signal('get_dependents', 's1', at(6), { file: 'a.ts' }), // before
      shown('blast', 's1', at(5), { file: 'a.ts' }),
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast')).toMatchObject({
      shown: 1,
      acted: 0,
    });
  });

  it('does NOT count a signal from a different session', () => {
    const events = [
      shown('blast', 's1', at(5), { file: 'a.ts' }),
      signal('get_dependents', 's2', at(4), { file: 'a.ts' }),
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast')).toMatchObject({ acted: 0 });
  });

  it('requires the signal type the nudge cares about (a test_run does not act a blast nudge)', () => {
    const events = [shown('blast', 's1', at(5), { file: 'a.ts' }), signal('test_run', 's1', at(4))];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast')).toMatchObject({ acted: 0 });
  });
});

describe('matched join defeats the mandated-get_files_context inflation', () => {
  it('3 annotate shown + one UNRELATED-file get_files_context → acted 0 (the reviewer repro)', () => {
    // Regression: CLAUDE.md mandates get_files_context before every edit, so a bare
    // any-signal join reported 100% here. A different-file signal must not count.
    const events = [
      shown('annotate', 's1', at(6), { file: 'a.ts' }),
      shown('annotate', 's1', at(5), { file: 'a.ts' }),
      shown('annotate', 's1', at(4), { file: 'a.ts' }),
      signal('get_files_context', 's1', at(3), { file: 'unrelated/z.ts' }),
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'annotate')).toMatchObject({
      shown: 3,
      acted: 0,
      actedShare: 0,
    });
  });

  it('a genuine same-file annotate sequence IS acted', () => {
    const events = [
      shown('annotate', 's1', at(5), { file: 'a.ts' }),
      signal('get_files_context', 's1', at(4), { file: 'a.ts' }),
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'annotate').acted).toBe(1);
  });

  it('annotate is acted by get_files_context OR get_dependents naming the same file', () => {
    const ctx = [
      shown('annotate', 's1', at(5), { file: 'a.ts' }),
      signal('get_files_context', 's1', at(4), { file: 'a.ts' }),
    ];
    expect(funnel(computeNudgeFunnels(ctx, [], 7, NOW), 'annotate').acted).toBe(1);
    const deps = [
      shown('annotate', 's2', at(5), { file: 'b.ts' }),
      signal('get_dependents', 's2', at(4), { file: 'b.ts' }),
    ];
    expect(funnel(computeNudgeFunnels(deps, [], 7, NOW), 'annotate').acted).toBe(1);
  });
});

describe('blast symbol match', () => {
  it('is acted by a get_dependents naming the same SYMBOL even on a different path', () => {
    const events = [
      shown('blast', 's1', at(5), { file: 'b.ts', symbol: 'Foo' }),
      signal('get_dependents', 's1', at(4), { file: 'other/c.ts', symbol: 'Foo' }), // different path, same symbol
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast').acted).toBe(1);
  });

  it('is acted by a get_dependents naming the same FILE regardless of symbol', () => {
    const events = [
      shown('blast', 's1', at(5), { file: 'b.ts', symbol: 'Foo' }),
      signal('get_dependents', 's1', at(4), { file: 'b.ts' }),
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast').acted).toBe(1);
  });

  it('is NOT acted when neither file nor symbol match', () => {
    const events = [
      shown('blast', 's1', at(5), { file: 'b.ts', symbol: 'Foo' }),
      signal('get_dependents', 's1', at(4), { file: 'x.ts', symbol: 'Bar' }),
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast').acted).toBe(0);
  });
});

describe('test-verify is session-scoped (test_run has no file)', () => {
  it('is acted by any subsequent test_run in the same session', () => {
    const events = [shown('test-verify', 's1', at(5)), signal('test_run', 's1', at(4))];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'test-verify').acted).toBe(1);
  });

  it('is not acted by a test_run before the advisory', () => {
    const events = [signal('test_run', 's1', at(6)), shown('test-verify', 's1', at(5))];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'test-verify').acted).toBe(0);
  });
});

describe('aggregation', () => {
  it('counts each shown independently and aggregates the share', () => {
    const events = [
      shown('annotate', 's1', at(5), { file: 'a.ts' }),
      signal('get_files_context', 's1', at(4), { file: 'a.ts' }), // acts the s1 shown
      shown('annotate', 's2', at(5), { file: 'a.ts' }), // no follow-up in s2
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'annotate')).toMatchObject({
      shown: 2,
      acted: 1,
      actedShare: 0.5,
    });
  });

  it('a single later same-file signal acts every earlier shown of the same nudge in the session', () => {
    const events = [
      shown('annotate', 's1', at(6), { file: 'a.ts' }),
      shown('annotate', 's1', at(5), { file: 'a.ts' }),
      signal('get_dependents', 's1', at(4), { file: 'a.ts' }),
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'annotate')).toMatchObject({
      shown: 2,
      acted: 2,
    });
  });
});

describe('window filtering', () => {
  it('excludes shown events older than the window', () => {
    const events = [
      shown('blast', 's1', at(24 * 40), { file: 'a.ts' }), // 40 days ago
      signal('get_dependents', 's1', at(24 * 40 - 1), { file: 'a.ts' }),
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast').shown).toBe(0);
    expect(funnel(computeNudgeFunnels(events, [], 30, NOW), 'blast').shown).toBe(0);
  });

  it('includes shown events inside the window', () => {
    const events = [
      shown('blast', 's1', at(24 * 10), { file: 'a.ts' }),
      signal('get_dependents', 's1', at(24 * 10 - 1), { file: 'a.ts' }),
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
      deltaEvent(at(5), [{ filepath: 'a.ts', symbol: 'foo' }]),
      deltaEvent(at(4), []), // foo now clean → resolved
    ];
    expect(funnel(computeNudgeFunnels([], deltaEvents, 7, NOW), 'delta')).toMatchObject({
      shown: 1,
      acted: 1,
      actedShare: 1,
    });
  });

  it('a still-flagged function counts as shown but not acted', () => {
    const deltaEvents = [
      deltaEvent(at(5), [{ filepath: 'a.ts', symbol: 'foo' }]),
      deltaEvent(at(4), [{ filepath: 'a.ts', symbol: 'foo' }]),
    ];
    expect(funnel(computeNudgeFunnels([], deltaEvents, 7, NOW), 'delta')).toMatchObject({
      shown: 1,
      acted: 0,
    });
  });
});

describe('unparsable timestamps', () => {
  it('drops events with an unparsable timestamp rather than crashing', () => {
    const events: NudgeEvent[] = [
      { kind: 'shown', timestamp: 'not-a-date', sessionId: 's1', nudge: 'blast', file: 'a.ts' },
      shown('blast', 's1', at(5), { file: 'a.ts' }),
      signal('get_dependents', 's1', at(4), { file: 'a.ts' }),
    ];
    expect(funnel(computeNudgeFunnels(events, [], 7, NOW), 'blast')).toMatchObject({
      shown: 1,
      acted: 1,
    });
  });
});

/** Attach a build stamp to an existing event fixture, for recording-status tests. */
function withBuild(event: NudgeEvent, build: BuildStamp): NudgeEvent {
  return { ...event, build } as NudgeEvent;
}

const BUILD_A: BuildStamp = { cliVersion: '0.70.0', hooksHash: 'aaaaaaaaaaaa' };
const BUILD_B: BuildStamp = { cliVersion: '0.72.0', hooksHash: 'bbbbbbbbbbbb' };

describe('latestBuildStampedEvent', () => {
  it('returns null when no event carries a build stamp', () => {
    const events = [shown('annotate', 's1', at(5)), signal('test_run', 's1', at(4))];
    expect(latestBuildStampedEvent(events)).toBeNull();
  });

  it('returns the build from the single stamped event', () => {
    const events = [withBuild(shown('annotate', 's1', at(5)), BUILD_A)];
    expect(latestBuildStampedEvent(events)?.build).toEqual(BUILD_A);
  });

  it('picks the most recent stamped event by timestamp, not array order', () => {
    const events = [
      withBuild(shown('annotate', 's1', at(2)), BUILD_B), // more recent (closer to NOW)
      withBuild(shown('blast', 's1', at(10)), BUILD_A), // older, listed first
    ];
    expect(latestBuildStampedEvent(events)?.build).toEqual(BUILD_B);
  });

  it('ignores events with an unparsable timestamp', () => {
    const events: NudgeEvent[] = [
      withBuild(
        { kind: 'shown', timestamp: 'not-a-date', sessionId: 's1', nudge: 'blast' },
        BUILD_A,
      ),
    ];
    expect(latestBuildStampedEvent(events)).toBeNull();
  });
});

describe('computeNudgeRecordingStatus (issue #916)', () => {
  it('never recorded: the ledger has no events at all', () => {
    expect(computeNudgeRecordingStatus([], 7, NOW)).toEqual({
      windowEmpty: true,
      neverRecorded: true,
    });
  });

  it('never recorded: events exist but none ever carried a build stamp (all legacy)', () => {
    const events = [shown('annotate', 's1', at(200))]; // outside window too, but irrelevant here
    expect(computeNudgeRecordingStatus(events, 7, NOW)).toEqual({
      windowEmpty: true,
      neverRecorded: true,
    });
  });

  it('zero events in window, but a capable build was seen outside it (case 2 of the issue)', () => {
    const events = [withBuild(shown('annotate', 's1', at(24 * 20)), BUILD_A)]; // 20 days ago
    const status = computeNudgeRecordingStatus(events, 7, NOW); // 7-day window: empty
    expect(status.windowEmpty).toBe(true);
    expect(status.neverRecorded).toBe(false);
    expect(status.build).toEqual(BUILD_A);
    expect(status.seenAt).toBe(at(24 * 20));
  });

  it('non-empty window reports the latest build stamped INSIDE the window (case 1 of the issue)', () => {
    const events = [
      withBuild(shown('annotate', 's1', at(6)), BUILD_A),
      withBuild(shown('blast', 's1', at(2)), BUILD_B),
    ];
    const status = computeNudgeRecordingStatus(events, 7, NOW);
    expect(status.windowEmpty).toBe(false);
    expect(status.build).toEqual(BUILD_B); // the more recent of the two
  });

  it('non-empty window whose events all predate build stamping (legacy-only in-window) reports no build', () => {
    const events = [shown('annotate', 's1', at(5))];
    const status = computeNudgeRecordingStatus(events, 7, NOW);
    expect(status.windowEmpty).toBe(false);
    expect(status.neverRecorded).toBe(false);
    expect(status.build).toBeUndefined();
  });

  it('does not let an out-of-window stamp answer for a non-empty window', () => {
    // In-window event is legacy (no build); a stamped event exists but is OUTSIDE the window.
    const events = [
      shown('annotate', 's1', at(5)), // in window (7d), no build
      withBuild(shown('blast', 's1', at(24 * 40)), BUILD_A), // 40 days ago, has build
    ];
    const status = computeNudgeRecordingStatus(events, 7, NOW);
    expect(status.windowEmpty).toBe(false);
    expect(status.build).toBeUndefined(); // the out-of-window stamp must not leak in
  });
});

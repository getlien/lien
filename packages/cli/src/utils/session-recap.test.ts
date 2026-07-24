import { describe, it, expect } from 'vitest';
import {
  computeUnactedBlastNudges,
  computeSessionRecap,
  formatDeltaSection,
  formatBlastSection,
  MAX_RECAP_ITEMS_PER_SECTION,
  type DeltaRecapItem,
} from './session-recap.js';
import type { NudgeEvent } from './nudge-events.js';

const T0 = new Date('2026-07-24T12:00:00.000Z').getTime();
function at(minutes: number): string {
  return new Date(T0 + minutes * 60 * 1000).toISOString();
}

function blastShown(
  sessionId: string,
  ts: string,
  opts: { file?: string; symbol?: string } = {},
): NudgeEvent {
  return { kind: 'shown', timestamp: ts, sessionId, nudge: 'blast', ...opts };
}
function depSignal(
  sessionId: string,
  ts: string,
  opts: { file?: string; symbol?: string } = {},
): NudgeEvent {
  return { kind: 'signal', timestamp: ts, sessionId, signal: 'get_dependents', ...opts };
}

function deltaItem(over: Partial<DeltaRecapItem> = {}): DeltaRecapItem {
  return {
    filepath: 'src/foo.ts',
    symbol: 'computeFoo',
    metricLabel: 'cognitive',
    beforeText: '12',
    afterText: '18',
    thresholdText: '15',
    ...over,
  };
}

describe('computeUnactedBlastNudges', () => {
  it('PRESENT: a blast shown with no get_dependents is unacted', () => {
    const events = [blastShown('s1', at(1), { symbol: 'parseBar', file: 'src/bar.ts' })];
    expect(computeUnactedBlastNudges(events, 's1')).toEqual([
      { symbol: 'parseBar', file: 'src/bar.ts' },
    ]);
  });

  it('RESOLVED (symbol): a later get_dependents naming the same symbol clears it', () => {
    const events = [
      blastShown('s1', at(1), { symbol: 'parseBar', file: 'src/bar.ts' }),
      depSignal('s1', at(2), { symbol: 'parseBar' }),
    ];
    expect(computeUnactedBlastNudges(events, 's1')).toEqual([]);
  });

  it('RESOLVED (file): a later get_dependents naming the same file clears it', () => {
    const events = [
      blastShown('s1', at(1), { symbol: 'parseBar', file: 'src/bar.ts' }),
      depSignal('s1', at(3), { file: 'src/bar.ts' }),
    ];
    expect(computeUnactedBlastNudges(events, 's1')).toEqual([]);
  });

  it('TIMING: a get_dependents BEFORE the shown does not resolve it', () => {
    const events = [
      depSignal('s1', at(1), { symbol: 'parseBar' }),
      blastShown('s1', at(2), { symbol: 'parseBar', file: 'src/bar.ts' }),
    ];
    expect(computeUnactedBlastNudges(events, 's1')).toEqual([
      { symbol: 'parseBar', file: 'src/bar.ts' },
    ]);
  });

  it('SESSION-SCOPED: another session’s get_dependents does not resolve it', () => {
    const events = [
      blastShown('s1', at(1), { symbol: 'parseBar', file: 'src/bar.ts' }),
      depSignal('s2', at(2), { symbol: 'parseBar' }),
    ];
    expect(computeUnactedBlastNudges(events, 's1')).toEqual([
      { symbol: 'parseBar', file: 'src/bar.ts' },
    ]);
  });

  it('ABSENT: a blast shown with no symbol is skipped (cannot render or match)', () => {
    const events = [blastShown('s1', at(1), { file: 'src/bar.ts' })];
    expect(computeUnactedBlastNudges(events, 's1')).toEqual([]);
  });

  it('DEDUPE: multiple shown for the same symbol collapse to one, and an act on the later one clears it', () => {
    const events = [
      blastShown('s1', at(1), { symbol: 'parseBar', file: 'src/bar.ts' }),
      blastShown('s1', at(3), { symbol: 'parseBar', file: 'src/bar.ts' }),
      depSignal('s1', at(2), { symbol: 'parseBar' }),
    ];
    // earliest shown is at(1); the get_dependents at at(2) >= at(1) resolves it.
    expect(computeUnactedBlastNudges(events, 's1')).toEqual([]);
  });

  it('ORDER: most-recently-shown symbol comes first', () => {
    const events = [
      blastShown('s1', at(1), { symbol: 'older', file: 'src/a.ts' }),
      blastShown('s1', at(5), { symbol: 'newer', file: 'src/b.ts' }),
    ];
    expect(computeUnactedBlastNudges(events, 's1').map(b => b.symbol)).toEqual(['newer', 'older']);
  });

  it('ignores unparseable timestamps', () => {
    const events: NudgeEvent[] = [
      { kind: 'shown', timestamp: 'not-a-date', sessionId: 's1', nudge: 'blast', symbol: 'x' },
    ];
    expect(computeUnactedBlastNudges(events, 's1')).toEqual([]);
  });
});

describe('computeSessionRecap', () => {
  it('EMPTY: all three sources empty → isEmpty true', () => {
    const recap = computeSessionRecap({ tests: [], delta: [], blast: [] });
    expect(recap.isEmpty).toBe(true);
  });

  it('non-empty when any single source has an item', () => {
    expect(
      computeSessionRecap({ tests: [{ file: 'a.ts', tests: ['a.test.ts'] }], delta: [], blast: [] })
        .isEmpty,
    ).toBe(false);
    expect(computeSessionRecap({ tests: [], delta: [deltaItem()], blast: [] }).isEmpty).toBe(false);
    expect(computeSessionRecap({ tests: [], delta: [], blast: [{ symbol: 'x' }] }).isEmpty).toBe(
      false,
    );
  });

  it('passes sources through unchanged', () => {
    const input = {
      tests: [{ file: 'a.ts', tests: ['a.test.ts'] }],
      delta: [deltaItem()],
      blast: [{ symbol: 'x' }],
    };
    const recap = computeSessionRecap(input);
    expect(recap.tests).toEqual(input.tests);
    expect(recap.delta).toEqual(input.delta);
    expect(recap.blast).toEqual(input.blast);
  });
});

describe('formatDeltaSection', () => {
  it('ABSENT: empty → empty string (silent)', () => {
    expect(formatDeltaSection([])).toBe('');
  });

  it('renders one crossing with the frozen shape + escape hatch', () => {
    const out = formatDeltaSection([deltaItem()]);
    expect(out).toContain(
      'Before finishing: functions you changed this session still cross a complexity threshold (lien delta vs HEAD):',
    );
    expect(out).toContain('  • computeFoo cognitive 18 (was 12, limit 15)');
    expect(out).toContain('disregard and stop again');
  });

  it('renders "new" for a newly-added over-threshold function', () => {
    const out = formatDeltaSection([deltaItem({ beforeText: 'new' })]);
    expect(out).toContain('(was new, limit 15)');
  });

  it('CAP: more than the cap shows only the cap and "(+N more)"', () => {
    const items = Array.from({ length: MAX_RECAP_ITEMS_PER_SECTION + 2 }, (_, i) =>
      deltaItem({ symbol: `fn${i}` }),
    );
    const out = formatDeltaSection(items);
    const bullets = out.split('\n').filter(l => l.trim().startsWith('•'));
    expect(bullets).toHaveLength(MAX_RECAP_ITEMS_PER_SECTION);
    expect(out).toContain('(+2 more)');
  });
});

describe('formatBlastSection', () => {
  it('ABSENT: empty → empty string (silent)', () => {
    expect(formatBlastSection([])).toBe('');
  });

  it('renders symbol with file', () => {
    const out = formatBlastSection([{ symbol: 'parseBar', file: 'src/bar.ts' }]);
    expect(out).toContain(
      'Before finishing: you changed an exported API this session but I never saw a get_dependents check for:',
    );
    expect(out).toContain('  • parseBar (in src/bar.ts)');
    expect(out).toContain('run get_dependents before you finish');
  });

  it('renders symbol without file', () => {
    expect(formatBlastSection([{ symbol: 'parseBar' }])).toContain('  • parseBar');
  });

  it('CAP: more than the cap shows only the cap and "(+N more)"', () => {
    const items = Array.from({ length: MAX_RECAP_ITEMS_PER_SECTION + 1 }, (_, i) => ({
      symbol: `sym${i}`,
    }));
    const out = formatBlastSection(items);
    const bullets = out.split('\n').filter(l => l.trim().startsWith('•'));
    expect(bullets).toHaveLength(MAX_RECAP_ITEMS_PER_SECTION);
    expect(out).toContain('(+1 more)');
  });
});

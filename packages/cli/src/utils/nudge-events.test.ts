import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getIndexDir } from '@liendev/parser';
import {
  recordNudgeEvent,
  recordNudgeShown,
  recordNudgeSignal,
  readNudgeEvents,
  nudgeEventsFilePath,
  nudgeEventsEnabled,
  isNudgeName,
  isNudgeSignalName,
  MAX_BYTES_BEFORE_TRIM,
  KEEP_LINES_AFTER_TRIM,
  type NudgeEvent,
} from './nudge-events.js';

let originalHome: string | undefined;
let originalKillSwitch: string | undefined;
let home: string;
const rootDir = '/fake/repo/for-nudge-events-test';

function shownEvent(overrides: Partial<Extract<NudgeEvent, { kind: 'shown' }>> = {}): NudgeEvent {
  return {
    kind: 'shown',
    timestamp: new Date().toISOString(),
    sessionId: 'sess-1',
    nudge: 'annotate',
    ...overrides,
  };
}

beforeEach(async () => {
  originalHome = process.env.LIEN_HOME;
  originalKillSwitch = process.env.LIEN_NUDGE_EVENTS;
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-nudge-events-test-'));
  process.env.LIEN_HOME = home;
  delete process.env.LIEN_NUDGE_EVENTS;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.LIEN_HOME;
  else process.env.LIEN_HOME = originalHome;
  if (originalKillSwitch === undefined) delete process.env.LIEN_NUDGE_EVENTS;
  else process.env.LIEN_NUDGE_EVENTS = originalKillSwitch;
  await fs.rm(home, { recursive: true, force: true });
});

describe('nudgeEventsFilePath', () => {
  it('lives inside the per-repo index directory', () => {
    expect(nudgeEventsFilePath(rootDir)).toBe(
      path.join(getIndexDir(rootDir), 'nudge-events.jsonl'),
    );
  });
});

describe('nudgeEventsEnabled', () => {
  it('is enabled by default', () => {
    expect(nudgeEventsEnabled()).toBe(true);
  });

  it('is disabled when LIEN_NUDGE_EVENTS=off', () => {
    process.env.LIEN_NUDGE_EVENTS = 'off';
    expect(nudgeEventsEnabled()).toBe(false);
  });

  it('is enabled for any other value (only the literal "off" disables it)', () => {
    process.env.LIEN_NUDGE_EVENTS = 'false';
    expect(nudgeEventsEnabled()).toBe(true);
  });
});

describe('isNudgeName / isNudgeSignalName', () => {
  it('recognizes the recorded nudge names', () => {
    expect(isNudgeName('annotate')).toBe(true);
    expect(isNudgeName('blast')).toBe(true);
    expect(isNudgeName('test-verify')).toBe(true);
    // delta is derived from delta-events, never recorded here.
    expect(isNudgeName('delta')).toBe(false);
    expect(isNudgeName('nope')).toBe(false);
  });

  it('recognizes the signal names', () => {
    expect(isNudgeSignalName('get_dependents')).toBe(true);
    expect(isNudgeSignalName('get_files_context')).toBe(true);
    expect(isNudgeSignalName('test_run')).toBe(true);
    expect(isNudgeSignalName('search_code')).toBe(false);
  });
});

describe('recordNudgeEvent + readNudgeEvents', () => {
  it('reading before any event is recorded yields an empty array', async () => {
    expect(await readNudgeEvents(rootDir)).toEqual([]);
  });

  it('round-trips a shown event', async () => {
    const event = shownEvent({ nudge: 'blast', file: 'src/foo.ts' });
    await recordNudgeEvent(rootDir, event);
    expect(await readNudgeEvents(rootDir)).toEqual([event]);
  });

  it('round-trips a signal event', async () => {
    const event: NudgeEvent = {
      kind: 'signal',
      timestamp: new Date().toISOString(),
      sessionId: 'sess-1',
      signal: 'get_dependents',
      file: 'src/foo.ts',
      symbol: 'doThing',
    };
    await recordNudgeEvent(rootDir, event);
    expect(await readNudgeEvents(rootDir)).toEqual([event]);
  });

  it('appends multiple events oldest-first', async () => {
    const a = shownEvent({ timestamp: new Date(1000).toISOString() });
    const b = shownEvent({ timestamp: new Date(2000).toISOString(), nudge: 'test-verify' });
    await recordNudgeEvent(rootDir, a);
    await recordNudgeEvent(rootDir, b);
    expect(await readNudgeEvents(rootDir)).toEqual([a, b]);
  });
});

describe('recordNudgeShown / recordNudgeSignal helpers', () => {
  it('stamps a timestamp and omits empty file/symbol', async () => {
    await recordNudgeShown(rootDir, { sessionId: 's', nudge: 'test-verify' });
    const [e] = await readNudgeEvents(rootDir);
    expect(e.kind).toBe('shown');
    expect(typeof e.timestamp).toBe('string');
    expect(Number.isFinite(Date.parse(e.timestamp))).toBe(true);
    expect('file' in e).toBe(false);
    expect('symbol' in e).toBe(false);
  });

  it('includes file/symbol when provided', async () => {
    await recordNudgeSignal(rootDir, {
      sessionId: 's',
      signal: 'get_dependents',
      file: 'a.ts',
      symbol: 'x',
    });
    const [e] = await readNudgeEvents(rootDir);
    expect(e).toMatchObject({
      kind: 'signal',
      signal: 'get_dependents',
      file: 'a.ts',
      symbol: 'x',
    });
  });

  it('normalizes an absolute file to project-relative at record time (the matched-join contract)', async () => {
    await recordNudgeShown(rootDir, {
      sessionId: 's',
      nudge: 'annotate',
      file: `${rootDir}/packages/cli/src/foo.ts`,
    });
    const [e] = await readNudgeEvents(rootDir);
    expect(e).toMatchObject({ file: 'packages/cli/src/foo.ts' });
  });

  it('leaves an already-relative file untouched (never re-relativizes against cwd)', async () => {
    await recordNudgeSignal(rootDir, {
      sessionId: 's',
      signal: 'get_files_context',
      file: 'packages/cli/src/foo.ts',
    });
    const [e] = await readNudgeEvents(rootDir);
    expect(e).toMatchObject({ file: 'packages/cli/src/foo.ts' });
  });
});

describe('validation on read', () => {
  it('skips a torn/corrupted line rather than failing the whole read', async () => {
    const good = shownEvent();
    await recordNudgeEvent(rootDir, good);
    await fs.appendFile(nudgeEventsFilePath(rootDir), '{not valid json\n', 'utf-8');
    await recordNudgeEvent(rootDir, shownEvent({ nudge: 'blast' }));

    const events = await readNudgeEvents(rootDir);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(good);
  });

  it('skips a shown line with an unknown nudge value', async () => {
    const good = shownEvent();
    await recordNudgeEvent(rootDir, good);
    await fs.appendFile(
      nudgeEventsFilePath(rootDir),
      `${JSON.stringify({ kind: 'shown', timestamp: new Date().toISOString(), sessionId: 's', nudge: 'delta' })}\n`,
      'utf-8',
    );
    const events = await readNudgeEvents(rootDir);
    expect(events).toEqual([good]);
  });

  it('skips a signal line with an unknown signal value', async () => {
    const good = shownEvent();
    await recordNudgeEvent(rootDir, good);
    await fs.appendFile(
      nudgeEventsFilePath(rootDir),
      `${JSON.stringify({ kind: 'signal', timestamp: new Date().toISOString(), sessionId: 's', signal: 'search_code' })}\n`,
      'utf-8',
    );
    expect(await readNudgeEvents(rootDir)).toEqual([good]);
  });

  it('skips a line missing sessionId (a plausible torn-write shape)', async () => {
    const good = shownEvent();
    await recordNudgeEvent(rootDir, good);
    await fs.appendFile(
      nudgeEventsFilePath(rootDir),
      `${JSON.stringify({ kind: 'shown', timestamp: new Date().toISOString(), nudge: 'annotate' })}\n`,
      'utf-8',
    );
    expect(await readNudgeEvents(rootDir)).toEqual([good]);
  });

  it('skips a line with an unrecognized kind', async () => {
    await fs.mkdir(path.dirname(nudgeEventsFilePath(rootDir)), { recursive: true });
    await fs.appendFile(
      nudgeEventsFilePath(rootDir),
      `${JSON.stringify({ kind: 'other', timestamp: new Date().toISOString(), sessionId: 's' })}\n`,
      'utf-8',
    );
    expect(await readNudgeEvents(rootDir)).toEqual([]);
  });
});

describe('kill switch + resilience', () => {
  it('LIEN_NUDGE_EVENTS=off disables recording entirely', async () => {
    process.env.LIEN_NUDGE_EVENTS = 'off';
    await recordNudgeShown(rootDir, { sessionId: 's', nudge: 'annotate' });
    expect(await readNudgeEvents(rootDir)).toEqual([]);
    await expect(fs.stat(nudgeEventsFilePath(rootDir))).rejects.toThrow();
  });

  it('never throws even if the index directory cannot be created', async () => {
    const blocker = path.join(home, 'blocker-file');
    await fs.writeFile(blocker, 'not a directory', 'utf-8');
    process.env.LIEN_HOME = blocker;
    await expect(
      recordNudgeShown(rootDir, { sessionId: 's', nudge: 'annotate' }),
    ).resolves.toBeUndefined();
  });
});

describe('truncation-from-front capping', () => {
  it('trims the oldest lines once the log exceeds the byte cap, keeping the newest', async () => {
    const filePath = nudgeEventsFilePath(rootDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const line = JSON.stringify(shownEvent({ timestamp: new Date(0).toISOString() }));
    const lineBytes = Buffer.byteLength(`${line}\n`, 'utf-8');
    const linesNeeded = Math.ceil(MAX_BYTES_BEFORE_TRIM / lineBytes) + 50;

    const seedLines: string[] = [];
    for (let i = 0; i < linesNeeded; i++) {
      seedLines.push(JSON.stringify(shownEvent({ timestamp: new Date(i).toISOString() })));
    }
    await fs.writeFile(filePath, `${seedLines.join('\n')}\n`, 'utf-8');

    const marker = shownEvent({ timestamp: new Date(linesNeeded).toISOString(), nudge: 'blast' });
    await recordNudgeEvent(rootDir, marker);

    const events = await readNudgeEvents(rootDir);
    expect(events.length).toBeLessThanOrEqual(KEEP_LINES_AFTER_TRIM + 1);
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)).toEqual(marker);
    expect(events[0].timestamp).not.toBe(new Date(0).toISOString());
  });

  it('does not trim while under the byte cap', async () => {
    for (let i = 0; i < 10; i++) {
      await recordNudgeEvent(rootDir, shownEvent({ timestamp: new Date(i).toISOString() }));
    }
    expect(await readNudgeEvents(rootDir)).toHaveLength(10);
  });
});

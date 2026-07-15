import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getIndexDir } from '@liendev/parser';
import {
  recordDeltaEvent,
  readDeltaEvents,
  deltaEventsFilePath,
  deltaEventsEnabled,
  MAX_BYTES_BEFORE_TRIM,
  KEEP_LINES_AFTER_TRIM,
  type DeltaEvent,
} from './delta-events.js';

let originalHome: string | undefined;
let originalKillSwitch: string | undefined;
let home: string;
const rootDir = '/fake/repo/for-delta-events-test';

function sampleEvent(overrides: Partial<DeltaEvent> = {}): DeltaEvent {
  return {
    timestamp: new Date().toISOString(),
    mode: 'normal',
    exitCode: 0,
    counts: { crossings: 0, newOverThreshold: 0, improved: 0 },
    flagged: [],
    ...overrides,
  };
}

beforeEach(async () => {
  originalHome = process.env.LIEN_HOME;
  originalKillSwitch = process.env.LIEN_DELTA_EVENTS;
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-delta-events-test-'));
  process.env.LIEN_HOME = home;
  delete process.env.LIEN_DELTA_EVENTS;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.LIEN_HOME;
  else process.env.LIEN_HOME = originalHome;
  if (originalKillSwitch === undefined) delete process.env.LIEN_DELTA_EVENTS;
  else process.env.LIEN_DELTA_EVENTS = originalKillSwitch;
  await fs.rm(home, { recursive: true, force: true });
});

describe('deltaEventsFilePath', () => {
  it('lives inside the per-repo index directory', () => {
    const filePath = deltaEventsFilePath(rootDir);
    expect(filePath).toBe(path.join(getIndexDir(rootDir), 'delta-events.jsonl'));
  });
});

describe('deltaEventsEnabled', () => {
  it('is enabled by default', () => {
    expect(deltaEventsEnabled()).toBe(true);
  });

  it('is disabled when LIEN_DELTA_EVENTS=off', () => {
    process.env.LIEN_DELTA_EVENTS = 'off';
    expect(deltaEventsEnabled()).toBe(false);
  });

  it('is enabled for any other value (only the literal "off" disables it)', () => {
    process.env.LIEN_DELTA_EVENTS = 'false';
    expect(deltaEventsEnabled()).toBe(true);
  });
});

describe('recordDeltaEvent + readDeltaEvents', () => {
  it('reading before any event is recorded yields an empty array', async () => {
    expect(await readDeltaEvents(rootDir)).toEqual([]);
  });

  it('appends one event that round-trips through readDeltaEvents', async () => {
    const event = sampleEvent({
      exitCode: 1,
      counts: { crossings: 1, newOverThreshold: 1, improved: 0 },
    });
    await recordDeltaEvent(rootDir, event);

    const events = await readDeltaEvents(rootDir);
    expect(events).toEqual([event]);
  });

  it('appends multiple events in order (oldest first)', async () => {
    const first = sampleEvent({ timestamp: new Date(1000).toISOString() });
    const second = sampleEvent({ timestamp: new Date(2000).toISOString(), exitCode: 1 });
    await recordDeltaEvent(rootDir, first);
    await recordDeltaEvent(rootDir, second);

    const events = await readDeltaEvents(rootDir);
    expect(events).toEqual([first, second]);
  });

  it('records the flagged (filepath, symbol, metric) rows verbatim', async () => {
    const event = sampleEvent({
      counts: { crossings: 1, newOverThreshold: 0, improved: 0 },
      flagged: [{ filepath: 'src/foo.ts', symbol: 'MyClass.doThing', metric: 'cognitive' }],
    });
    await recordDeltaEvent(rootDir, event);

    const [read] = await readDeltaEvents(rootDir);
    expect(read.flagged).toEqual(event.flagged);
  });

  it('skips a torn/corrupted line rather than failing the whole read', async () => {
    const good = sampleEvent();
    await recordDeltaEvent(rootDir, good);

    const filePath = deltaEventsFilePath(rootDir);
    await fs.appendFile(filePath, '{not valid json\n', 'utf-8');
    await recordDeltaEvent(rootDir, sampleEvent({ exitCode: 1 }));

    const events = await readDeltaEvents(rootDir);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(good);
    expect(events[1].exitCode).toBe(1);
  });

  it('skips a line that is valid JSON but the wrong shape, instead of crashing', async () => {
    const good = sampleEvent();
    await recordDeltaEvent(rootDir, good);

    const filePath = deltaEventsFilePath(rootDir);
    // Valid JSON, but missing `flagged` (and `counts` is empty) — a plausible
    // torn-write shape that must not reach a downstream `.flagged.map(...)`.
    await fs.appendFile(
      filePath,
      `${JSON.stringify({ timestamp: new Date().toISOString(), counts: {} })}\n`,
      'utf-8',
    );
    await recordDeltaEvent(rootDir, sampleEvent({ exitCode: 1 }));

    const events = await readDeltaEvents(rootDir);
    expect(events).toHaveLength(2);
    expect(events.every(e => Array.isArray(e.flagged))).toBe(true);
  });

  it('skips a line whose flagged array contains a malformed element (e.g. null)', async () => {
    const good = sampleEvent();
    await recordDeltaEvent(rootDir, good);

    const filePath = deltaEventsFilePath(rootDir);
    // Array.isArray(flagged) passes, but an element is null / missing fields —
    // must not reach functionKey's `f.filepath` destructure downstream.
    const malformed = {
      timestamp: new Date().toISOString(),
      mode: 'normal',
      exitCode: 0,
      counts: { crossings: 0, newOverThreshold: 0, improved: 0 },
      flagged: [null],
    };
    await fs.appendFile(filePath, `${JSON.stringify(malformed)}\n`, 'utf-8');
    await recordDeltaEvent(rootDir, sampleEvent({ exitCode: 1 }));

    const events = await readDeltaEvents(rootDir);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(good);
    expect(events[1].exitCode).toBe(1);
  });

  it('LIEN_DELTA_EVENTS=off disables recording entirely (kill switch)', async () => {
    process.env.LIEN_DELTA_EVENTS = 'off';
    await recordDeltaEvent(rootDir, sampleEvent());

    expect(await readDeltaEvents(rootDir)).toEqual([]);
    await expect(fs.stat(deltaEventsFilePath(rootDir))).rejects.toThrow();
  });

  it('never throws even if the index directory cannot be created', async () => {
    // Point LIEN_HOME at a path that is itself a file, so mkdir(recursive) underneath it fails.
    const blocker = path.join(home, 'blocker-file');
    await fs.writeFile(blocker, 'not a directory', 'utf-8');
    process.env.LIEN_HOME = blocker;

    await expect(recordDeltaEvent(rootDir, sampleEvent())).resolves.toBeUndefined();
  });
});

describe('truncation-from-front capping', () => {
  it('trims the oldest lines once the log exceeds the byte cap, keeping the newest', async () => {
    const filePath = deltaEventsFilePath(rootDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const line = JSON.stringify(sampleEvent({ timestamp: new Date(0).toISOString() }));
    const lineBytes = Buffer.byteLength(`${line}\n`, 'utf-8');
    const linesNeeded = Math.ceil(MAX_BYTES_BEFORE_TRIM / lineBytes) + 50;

    const seedLines: string[] = [];
    for (let i = 0; i < linesNeeded; i++) {
      seedLines.push(JSON.stringify(sampleEvent({ timestamp: new Date(i).toISOString() })));
    }
    await fs.writeFile(filePath, `${seedLines.join('\n')}\n`, 'utf-8');

    const marker = sampleEvent({ timestamp: new Date(linesNeeded).toISOString(), exitCode: 1 });
    await recordDeltaEvent(rootDir, marker);

    const events = await readDeltaEvents(rootDir);
    // Kept lines + the freshly appended marker, never unbounded.
    expect(events.length).toBeLessThanOrEqual(KEEP_LINES_AFTER_TRIM + 1);
    expect(events.length).toBeGreaterThan(0);
    // The newest event (just appended) must survive truncation-from-front.
    expect(events.at(-1)).toEqual(marker);
    // The very first seeded (oldest) event must have been dropped.
    expect(events[0].timestamp).not.toBe(new Date(0).toISOString());
  });

  it('does not trim while under the byte cap', async () => {
    for (let i = 0; i < 10; i++) {
      await recordDeltaEvent(rootDir, sampleEvent({ timestamp: new Date(i).toISOString() }));
    }
    const events = await readDeltaEvents(rootDir);
    expect(events).toHaveLength(10);
  });

  it('enforces the byte cap even when a few large lines stay well under the line-count cap', async () => {
    // A handful of oversized events (large flagged[] payloads) can blow the
    // byte budget while the file has far fewer than KEEP_LINES_AFTER_TRIM
    // lines — the line-count guard alone must not let this slip through.
    const filePath = deltaEventsFilePath(rootDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const bigFlagged = Array.from({ length: 10000 }, (_, i) => ({
      filepath: `src/file-${i}.ts`,
      symbol: `fn${i}`,
      metric: 'cognitive' as const,
    }));
    const bigLine = (timestamp: string) =>
      JSON.stringify(sampleEvent({ timestamp, flagged: bigFlagged }));

    // 5 large lines, comfortably under KEEP_LINES_AFTER_TRIM (2000), but each
    // one is big enough that a handful together exceed MAX_BYTES_BEFORE_TRIM.
    const seedTimestamps = [0, 1, 2, 3, 4].map(i => new Date(i).toISOString());
    const seed = seedTimestamps.map(bigLine).join('\n') + '\n';
    expect(Buffer.byteLength(seed, 'utf-8')).toBeGreaterThan(MAX_BYTES_BEFORE_TRIM);
    await fs.writeFile(filePath, seed, 'utf-8');

    const marker = sampleEvent({ timestamp: new Date(100).toISOString(), exitCode: 1 });
    await recordDeltaEvent(rootDir, marker);

    const stats = await fs.stat(filePath);
    expect(stats.size).toBeLessThanOrEqual(MAX_BYTES_BEFORE_TRIM);

    const events = await readDeltaEvents(rootDir);
    expect(events.length).toBeLessThan(seedTimestamps.length + 1);
    // The newest event (just appended) must survive.
    expect(events.at(-1)).toEqual(marker);
    // The oldest seeded event must have been dropped.
    expect(events.some(e => e.timestamp === seedTimestamps[0])).toBe(false);
  });
});

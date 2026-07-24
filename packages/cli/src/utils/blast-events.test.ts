import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getIndexDir } from '@liendev/parser';
import {
  recordBlastEvent,
  readBlastEvents,
  blastEventsFilePath,
  blastEventsEnabled,
  MAX_BYTES_BEFORE_TRIM,
  KEEP_LINES_AFTER_TRIM,
  type BlastEvent,
} from './blast-events.js';

let originalHome: string | undefined;
let originalKillSwitch: string | undefined;
let home: string;
const rootDir = '/fake/repo/for-blast-events-test';

function sampleEvent(overrides: Partial<BlastEvent> = {}): BlastEvent {
  return {
    timestamp: new Date().toISOString(),
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

beforeEach(async () => {
  originalHome = process.env.LIEN_HOME;
  originalKillSwitch = process.env.LIEN_BLAST_EVENTS;
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-blast-events-test-'));
  process.env.LIEN_HOME = home;
  delete process.env.LIEN_BLAST_EVENTS;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.LIEN_HOME;
  else process.env.LIEN_HOME = originalHome;
  if (originalKillSwitch === undefined) delete process.env.LIEN_BLAST_EVENTS;
  else process.env.LIEN_BLAST_EVENTS = originalKillSwitch;
  await fs.rm(home, { recursive: true, force: true });
});

describe('blastEventsFilePath', () => {
  it('lives inside the per-repo index directory', () => {
    const filePath = blastEventsFilePath(rootDir);
    expect(filePath).toBe(path.join(getIndexDir(rootDir), 'blast-events.jsonl'));
  });
});

describe('blastEventsEnabled', () => {
  it('is enabled by default', () => {
    expect(blastEventsEnabled()).toBe(true);
  });

  it('is disabled when LIEN_BLAST_EVENTS=off', () => {
    process.env.LIEN_BLAST_EVENTS = 'off';
    expect(blastEventsEnabled()).toBe(false);
  });

  it('is enabled for any other value (only the literal "off" disables it)', () => {
    process.env.LIEN_BLAST_EVENTS = 'false';
    expect(blastEventsEnabled()).toBe(true);
  });
});

describe('recordBlastEvent + readBlastEvents', () => {
  it('reading before any event is recorded yields an empty array', async () => {
    expect(await readBlastEvents(rootDir)).toEqual([]);
  });

  it('appends one event that round-trips through readBlastEvents', async () => {
    const event = sampleEvent();
    await recordBlastEvent(rootDir, event);

    const events = await readBlastEvents(rootDir);
    expect(events).toEqual([event]);
  });

  it('appends multiple events in order (oldest first)', async () => {
    const first = sampleEvent({ timestamp: new Date(1000).toISOString() });
    const second = sampleEvent({ timestamp: new Date(2000).toISOString(), filepath: 'src/bar.ts' });
    await recordBlastEvent(rootDir, first);
    await recordBlastEvent(rootDir, second);

    expect(await readBlastEvents(rootDir)).toEqual([first, second]);
  });

  it('records a degraded (unenriched) event verbatim', async () => {
    const degraded = sampleEvent({
      enriched: false,
      changes: [
        {
          symbol: 'foo',
          kind: 'removed',
          dependentCount: null,
          untestedDependentCount: null,
          riskLevel: null,
        },
      ],
    });
    await recordBlastEvent(rootDir, degraded);

    const [read] = await readBlastEvents(rootDir);
    expect(read).toEqual(degraded);
  });

  it('skips a torn/corrupted line rather than failing the whole read', async () => {
    const good = sampleEvent();
    await recordBlastEvent(rootDir, good);

    const filePath = blastEventsFilePath(rootDir);
    await fs.appendFile(filePath, '{not valid json\n', 'utf-8');
    await recordBlastEvent(rootDir, sampleEvent({ filepath: 'src/bar.ts' }));

    const events = await readBlastEvents(rootDir);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(good);
  });

  it('skips a line that is valid JSON but the wrong shape, instead of crashing', async () => {
    const good = sampleEvent();
    await recordBlastEvent(rootDir, good);

    const filePath = blastEventsFilePath(rootDir);
    // Valid JSON, but changes is empty — a BlastEvent is never recorded with
    // an empty changes array (see blast-events.ts), so this must not be
    // trusted even though the JSON itself parses.
    await fs.appendFile(
      filePath,
      `${JSON.stringify({ timestamp: new Date().toISOString(), filepath: 'x.ts', changes: [], enriched: true })}\n`,
      'utf-8',
    );
    await recordBlastEvent(rootDir, sampleEvent({ filepath: 'src/bar.ts' }));

    const events = await readBlastEvents(rootDir);
    expect(events).toHaveLength(2);
  });

  it('skips a line whose changes array contains a malformed element', async () => {
    const good = sampleEvent();
    await recordBlastEvent(rootDir, good);

    const filePath = blastEventsFilePath(rootDir);
    const malformed = {
      timestamp: new Date().toISOString(),
      filepath: 'x.ts',
      changes: [{ symbol: 'foo' }], // missing kind/dependentCount/etc.
      enriched: true,
    };
    await fs.appendFile(filePath, `${JSON.stringify(malformed)}\n`, 'utf-8');
    await recordBlastEvent(rootDir, sampleEvent({ filepath: 'src/bar.ts' }));

    const events = await readBlastEvents(rootDir);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(good);
  });

  it('LIEN_BLAST_EVENTS=off disables recording entirely (kill switch)', async () => {
    process.env.LIEN_BLAST_EVENTS = 'off';
    await recordBlastEvent(rootDir, sampleEvent());

    expect(await readBlastEvents(rootDir)).toEqual([]);
    await expect(fs.stat(blastEventsFilePath(rootDir))).rejects.toThrow();
  });

  it('never throws even if the index directory cannot be created', async () => {
    const blocker = path.join(home, 'blocker-file');
    await fs.writeFile(blocker, 'not a directory', 'utf-8');
    process.env.LIEN_HOME = blocker;

    await expect(recordBlastEvent(rootDir, sampleEvent())).resolves.toBeUndefined();
  });
});

describe('truncation-from-front capping', () => {
  it('trims the oldest lines once the log exceeds the byte cap, keeping the newest', async () => {
    const filePath = blastEventsFilePath(rootDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const line = JSON.stringify(sampleEvent({ timestamp: new Date(0).toISOString() }));
    const lineBytes = Buffer.byteLength(`${line}\n`, 'utf-8');
    const linesNeeded = Math.ceil(MAX_BYTES_BEFORE_TRIM / lineBytes) + 50;

    const seedLines: string[] = [];
    for (let i = 0; i < linesNeeded; i++) {
      seedLines.push(JSON.stringify(sampleEvent({ timestamp: new Date(i).toISOString() })));
    }
    await fs.writeFile(filePath, `${seedLines.join('\n')}\n`, 'utf-8');

    const marker = sampleEvent({
      timestamp: new Date(linesNeeded).toISOString(),
      filepath: 'marker.ts',
    });
    await recordBlastEvent(rootDir, marker);

    const events = await readBlastEvents(rootDir);
    expect(events.length).toBeLessThanOrEqual(KEEP_LINES_AFTER_TRIM + 1);
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)).toEqual(marker);
    expect(events[0].timestamp).not.toBe(new Date(0).toISOString());
  });

  it('does not trim while under the byte cap', async () => {
    for (let i = 0; i < 10; i++) {
      await recordBlastEvent(rootDir, sampleEvent({ timestamp: new Date(i).toISOString() }));
    }
    expect(await readBlastEvents(rootDir)).toHaveLength(10);
  });
});

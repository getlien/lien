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
import { getPackageVersion } from './version.js';

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

// The `rootDir` fake above never exists on disk, so it only exercises
// `canonicalizePath`'s final (identity) fallback — never actual symlink
// resolution. These use real temp directories to exercise the realpath path
// that macOS's `/tmp` -> `/private/tmp` boundary hits in production.
describe('toRepoRelativeFile (via recordNudgeShown/Signal) — realpath canonicalization', () => {
  let realRoot: string;

  beforeEach(async () => {
    realRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-nudge-realpath-test-'));
  });

  afterEach(async () => {
    await fs.rm(realRoot, { recursive: true, force: true });
  });

  it('resolves an absolute file through a symlinked root to the same repo-relative form (macOS /tmp -> /private/tmp shape)', async () => {
    await fs.mkdir(path.join(realRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(realRoot, 'src', 'foo.ts'), '', 'utf-8');

    const linkDir = path.join(os.tmpdir(), `lien-nudge-realpath-link-${process.pid}-${Date.now()}`);
    try {
      await fs.symlink(realRoot, linkDir, 'dir');
    } catch {
      return; // platform can't create symlinks — skip cleanly rather than fail
    }
    try {
      // rootDir is the CANONICAL root (as `resolveProjectRoot(process.cwd())`
      // would produce), while `file` arrives through the symlinked route (as
      // an MCP arg or hook `tool_input.file_path` would) — the exact mismatch
      // that produced the `../../../../tmp/...` bug.
      await recordNudgeShown(realRoot, {
        sessionId: 's',
        nudge: 'annotate',
        file: path.join(linkDir, 'src', 'foo.ts'),
      });
      const [e] = await readNudgeEvents(realRoot);
      expect(e).toMatchObject({ file: 'src/foo.ts' });
    } finally {
      await fs.rm(linkDir, { force: true }).catch(() => undefined);
    }
  });

  it('resolves an absolute file with no symlink involved to the same repo-relative form (no regression)', async () => {
    await fs.mkdir(path.join(realRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(realRoot, 'src', 'foo.ts'), '', 'utf-8');

    await recordNudgeSignal(realRoot, {
      sessionId: 's',
      signal: 'get_dependents',
      file: path.join(realRoot, 'src', 'foo.ts'),
    });
    const [e] = await readNudgeEvents(realRoot);
    expect(e).toMatchObject({ file: 'src/foo.ts' });
  });

  it('omits an absolute file that resolves outside the repo rather than recording a bogus in-repo path', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-nudge-outside-test-'));
    try {
      const outsideFile = path.join(outsideDir, 'evil.ts');
      await fs.writeFile(outsideFile, '', 'utf-8');

      await recordNudgeShown(realRoot, { sessionId: 's', nudge: 'annotate', file: outsideFile });
      const [e] = await readNudgeEvents(realRoot);
      expect('file' in e).toBe(false);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('still relativizes correctly when the file itself no longer exists but its parent directory does', async () => {
    await fs.mkdir(path.join(realRoot, 'src'), { recursive: true });

    await recordNudgeSignal(realRoot, {
      sessionId: 's',
      signal: 'get_files_context',
      file: path.join(realRoot, 'src', 'deleted.ts'),
    });
    const [e] = await readNudgeEvents(realRoot);
    expect(e).toMatchObject({ file: 'src/deleted.ts' });
  });
});

describe('build stamping (issue #916)', () => {
  it('recordNudgeShown always stamps a build with at least cliVersion', async () => {
    await recordNudgeShown(rootDir, { sessionId: 's-build-1', nudge: 'annotate' });
    const [e] = await readNudgeEvents(rootDir);
    expect(e).toMatchObject({ build: { cliVersion: getPackageVersion() } });
    expect((e as Extract<NudgeEvent, { kind: 'shown' }>).build?.hooksHash).toBeUndefined();
  });

  it('recordNudgeSignal always stamps a build with at least cliVersion', async () => {
    await recordNudgeSignal(rootDir, { sessionId: 's-build-2', signal: 'test_run' });
    const [e] = await readNudgeEvents(rootDir);
    expect(e).toMatchObject({ build: { cliVersion: getPackageVersion() } });
  });

  it('includes hooksHash when hooksDir is supplied', async () => {
    const hooksDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-nudge-hooks-'));
    await fs.writeFile(path.join(hooksDir, 'nudge-signal.sh'), '#!/bin/sh\n', 'utf-8');
    try {
      await recordNudgeShown(rootDir, { sessionId: 's-build-3', nudge: 'blast', hooksDir });
      const [e] = await readNudgeEvents(rootDir);
      const build = (e as Extract<NudgeEvent, { kind: 'shown' }>).build;
      expect(build?.cliVersion).toBe(getPackageVersion());
      expect(typeof build?.hooksHash).toBe('string');
    } finally {
      await fs.rm(hooksDir, { recursive: true, force: true });
    }
  });

  it('caches the build stamp across events in the same session', async () => {
    const hooksDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-nudge-hooks-'));
    await fs.writeFile(path.join(hooksDir, 'a.sh'), 'v1', 'utf-8');
    try {
      await recordNudgeShown(rootDir, { sessionId: 's-build-4', nudge: 'annotate', hooksDir });
      // Mutate the hooks dir after the first event — the second event in the
      // same session should still read the CACHED stamp, not re-hash.
      await fs.writeFile(path.join(hooksDir, 'a.sh'), 'v2', 'utf-8');
      await recordNudgeSignal(rootDir, {
        sessionId: 's-build-4',
        signal: 'get_dependents',
        hooksDir,
      });
      const events = await readNudgeEvents(rootDir);
      const stamps = events.map(
        e => (e as NudgeEvent & { build?: { hooksHash?: string } }).build?.hooksHash,
      );
      expect(stamps[0]).toBe(stamps[1]);
    } finally {
      await fs.rm(hooksDir, { recursive: true, force: true });
    }
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

  it('reads a legacy shown event with no `build` field at all (pre-#916 ledger, back-compat)', async () => {
    await fs.mkdir(path.dirname(nudgeEventsFilePath(rootDir)), { recursive: true });
    await fs.appendFile(
      nudgeEventsFilePath(rootDir),
      `${JSON.stringify({ kind: 'shown', timestamp: new Date().toISOString(), sessionId: 's', nudge: 'annotate' })}\n`,
      'utf-8',
    );
    const [e] = await readNudgeEvents(rootDir);
    expect(e).toBeDefined();
    expect('build' in e).toBe(false);
  });

  it('skips a line with a malformed `build` (never half-trusts a corrupt stamp as known-good)', async () => {
    const good = shownEvent();
    await recordNudgeEvent(rootDir, good);
    await fs.appendFile(
      nudgeEventsFilePath(rootDir),
      `${JSON.stringify({
        kind: 'shown',
        timestamp: new Date().toISOString(),
        sessionId: 's',
        nudge: 'annotate',
        build: { hooksHash: 'abc' }, // missing required cliVersion
      })}\n`,
      'utf-8',
    );
    expect(await readNudgeEvents(rootDir)).toEqual([good]);
  });

  it('reads a well-formed `build` field back intact', async () => {
    await fs.mkdir(path.dirname(nudgeEventsFilePath(rootDir)), { recursive: true });
    const withBuild = {
      kind: 'shown' as const,
      timestamp: new Date().toISOString(),
      sessionId: 's',
      nudge: 'annotate' as const,
      build: { cliVersion: '1.2.3', hooksHash: 'deadbeef1234' },
    };
    await fs.appendFile(nudgeEventsFilePath(rootDir), `${JSON.stringify(withBuild)}\n`, 'utf-8');
    expect(await readNudgeEvents(rootDir)).toEqual([withBuild]);
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

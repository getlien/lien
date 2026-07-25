import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getIndexDir } from '@liendev/parser';
import {
  recordEdit,
  recordRun,
  recordBlocked,
  readSession,
  clearSession,
  testSessionFilePath,
  testVerifyEnabled,
  recapEnabled,
  TEST_SESSIONS_DIRNAME,
} from './test-ledger.js';

let originalHome: string | undefined;
let originalKillSwitch: string | undefined;
let originalRecapSwitch: string | undefined;
let home: string;
const rootDir = '/fake/repo/for-test-ledger-test';
const sessionId = 'session-abc-123';

beforeEach(async () => {
  originalHome = process.env.LIEN_HOME;
  originalKillSwitch = process.env.LIEN_TEST_VERIFY;
  originalRecapSwitch = process.env.LIEN_RECAP;
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-ledger-test-'));
  process.env.LIEN_HOME = home;
  delete process.env.LIEN_TEST_VERIFY;
  delete process.env.LIEN_RECAP;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.LIEN_HOME;
  else process.env.LIEN_HOME = originalHome;
  if (originalKillSwitch === undefined) delete process.env.LIEN_TEST_VERIFY;
  else process.env.LIEN_TEST_VERIFY = originalKillSwitch;
  if (originalRecapSwitch === undefined) delete process.env.LIEN_RECAP;
  else process.env.LIEN_RECAP = originalRecapSwitch;
  await fs.rm(home, { recursive: true, force: true });
});

describe('testSessionFilePath', () => {
  it('lives inside the per-repo index directory under test-sessions/', () => {
    const filePath = testSessionFilePath(rootDir, sessionId);
    expect(filePath).toBe(
      path.join(getIndexDir(rootDir), TEST_SESSIONS_DIRNAME, `${sessionId}.jsonl`),
    );
  });

  it.each(['../evil', 'a/b', 'a b', 'a;rm -rf', '', 'a$(whoami)'])(
    'rejects an invalid sessionId %j (defense-in-depth against path interpolation)',
    invalid => {
      expect(testSessionFilePath(rootDir, invalid)).toBeNull();
    },
  );

  it.each(['abc123', 'session-abc_123', 'ABC-123_xyz'])('accepts a valid sessionId %j', valid => {
    expect(testSessionFilePath(rootDir, valid)).not.toBeNull();
  });
});

describe('testVerifyEnabled', () => {
  it('is enabled by default', () => {
    expect(testVerifyEnabled()).toBe(true);
  });

  it('is disabled when LIEN_TEST_VERIFY=off', () => {
    process.env.LIEN_TEST_VERIFY = 'off';
    expect(testVerifyEnabled()).toBe(false);
  });

  it('is enabled for any other value (only the literal "off" disables it)', () => {
    process.env.LIEN_TEST_VERIFY = 'false';
    expect(testVerifyEnabled()).toBe(true);
  });
});

describe('recapEnabled (the single switch governing the blocked-marker write)', () => {
  it('is enabled by default', () => {
    expect(recapEnabled()).toBe(true);
  });

  it('is disabled when LIEN_RECAP=off', () => {
    process.env.LIEN_RECAP = 'off';
    expect(recapEnabled()).toBe(false);
  });

  it('is enabled for any other value (only the literal "off" disables it)', () => {
    process.env.LIEN_RECAP = 'false';
    expect(recapEnabled()).toBe(true);
  });
});

describe('recordEdit + recordRun + readSession', () => {
  it('reading before any event is recorded yields an empty array', async () => {
    expect(await readSession(rootDir, sessionId)).toEqual([]);
  });

  it('round-trips an edit event', async () => {
    await recordEdit(rootDir, sessionId, 'src/foo.ts', ['src/foo.test.ts']);
    const events = await readSession(rootDir, sessionId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'edit',
      file: 'src/foo.ts',
      tests: ['src/foo.test.ts'],
    });
  });

  it('round-trips a run event', async () => {
    await recordRun(rootDir, sessionId, 'npm test');
    const events = await readSession(rootDir, sessionId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'run', command: 'npm test' });
  });

  it('round-trips a blocked event', async () => {
    await recordBlocked(rootDir, sessionId);
    const events = await readSession(rootDir, sessionId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'blocked' });
  });

  it('is append-only: interleaved edit/run events preserve insertion order', async () => {
    await recordEdit(rootDir, sessionId, 'src/foo.ts', ['src/foo.test.ts']);
    await recordRun(rootDir, sessionId, 'npm test');
    await recordEdit(rootDir, sessionId, 'src/bar.ts', ['src/bar.test.ts']);

    const events = await readSession(rootDir, sessionId);
    expect(events.map(e => e.kind)).toEqual(['edit', 'run', 'edit']);
  });

  it('two different sessions never share a ledger file', async () => {
    await recordEdit(rootDir, 'session-one', 'src/foo.ts', ['src/foo.test.ts']);
    await recordEdit(rootDir, 'session-two', 'src/bar.ts', ['src/bar.test.ts']);

    expect(await readSession(rootDir, 'session-one')).toHaveLength(1);
    expect(await readSession(rootDir, 'session-two')).toHaveLength(1);
  });

  it('an invalid sessionId is a no-op for recordEdit/recordRun/recordBlocked/readSession (fail-open, not thrown)', async () => {
    await expect(recordEdit(rootDir, '../evil', 'src/foo.ts', [])).resolves.toBeUndefined();
    await expect(recordRun(rootDir, '../evil', 'npm test')).resolves.toBeUndefined();
    await expect(recordBlocked(rootDir, '../evil')).resolves.toBeUndefined();
    await expect(readSession(rootDir, '../evil')).resolves.toEqual([]);
  });

  it('LIEN_TEST_VERIFY=off disables edit/run recording, but recordBlocked is exempt and reading always works', async () => {
    await recordEdit(rootDir, sessionId, 'src/foo.ts', ['src/foo.test.ts']);
    process.env.LIEN_TEST_VERIFY = 'off';
    await recordRun(rootDir, sessionId, 'npm test');
    await recordBlocked(rootDir, sessionId);

    // recordRun (a test-verify recording) never lands while the switch is off.
    // recordBlocked is DELIBERATELY exempt: the `blocked` event is the Stop-recap
    // loop-prevention marker, gated by LIEN_RECAP at the call site (recap-cmd.ts),
    // not by this switch — so it must survive LIEN_TEST_VERIFY=off. A delta/blast-only
    // recap (no test-verify recording at all) still needs to suppress its own re-nag.
    const events = await readSession(rootDir, sessionId);
    expect(events.map(e => e.kind)).toEqual(['edit', 'blocked']);
  });

  it('skips a torn/corrupted line rather than failing the whole read', async () => {
    await recordEdit(rootDir, sessionId, 'src/foo.ts', ['src/foo.test.ts']);
    const filePath = testSessionFilePath(rootDir, sessionId)!;
    await fs.appendFile(filePath, '{not valid json\n', 'utf-8');
    await recordRun(rootDir, sessionId, 'npm test');

    const events = await readSession(rootDir, sessionId);
    expect(events).toHaveLength(2);
  });

  it('skips a line that is valid JSON but the wrong shape, instead of crashing', async () => {
    await recordEdit(rootDir, sessionId, 'src/foo.ts', ['src/foo.test.ts']);
    const filePath = testSessionFilePath(rootDir, sessionId)!;
    await fs.appendFile(
      filePath,
      `${JSON.stringify({ kind: 'edit', timestamp: new Date().toISOString() })}\n`, // missing file/tests
      'utf-8',
    );
    await recordRun(rootDir, sessionId, 'npm test');

    const events = await readSession(rootDir, sessionId);
    expect(events).toHaveLength(2);
  });

  it('never throws even if the index directory cannot be created', async () => {
    const blocker = path.join(home, 'blocker-file');
    await fs.writeFile(blocker, 'not a directory', 'utf-8');
    process.env.LIEN_HOME = blocker;

    await expect(recordEdit(rootDir, sessionId, 'src/foo.ts', [])).resolves.toBeUndefined();
  });
});

describe('clearSession', () => {
  it('removes the session ledger file', async () => {
    await recordEdit(rootDir, sessionId, 'src/foo.ts', ['src/foo.test.ts']);
    expect(await readSession(rootDir, sessionId)).toHaveLength(1);

    await clearSession(rootDir, sessionId);
    expect(await readSession(rootDir, sessionId)).toEqual([]);
  });

  it('is a no-op when no ledger exists yet', async () => {
    await expect(clearSession(rootDir, sessionId)).resolves.toBeUndefined();
  });

  it('is a no-op for an invalid sessionId', async () => {
    await expect(clearSession(rootDir, '../evil')).resolves.toBeUndefined();
  });
});

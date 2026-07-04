import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { openDatabase, STRUCTURAL_DB_FILENAME } from '../vectordb/sqlite/schema.js';
import { getIndicesRoot, LEGACY_LANCE_DIRNAME } from './gc.js';
import { runAutoGc, GC_STAMP_FILE, GC_LOCK_FILE } from './auto-gc.js';

const DAY = 24 * 60 * 60 * 1000;

let originalHome: string | undefined;
let home: string;

async function makeIndex(
  name: string,
  opts: { sourceRoot?: string; withDb?: boolean; lance?: boolean; accessMs?: number } = {},
): Promise<string> {
  const dir = path.join(getIndicesRoot(), name);
  await fs.mkdir(dir, { recursive: true });
  const manifest: Record<string, unknown> = {
    formatVersion: 5,
    lienVersion: 'test',
    lastIndexed: Date.now(),
    files: {},
  };
  if (opts.sourceRoot) manifest.sourceRoot = opts.sourceRoot;
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
  if (opts.withDb) {
    const db = openDatabase(path.join(dir, STRUCTURAL_DB_FILENAME));
    db.close();
  }
  if (opts.lance) await fs.mkdir(path.join(dir, LEGACY_LANCE_DIRNAME), { recursive: true });
  if (opts.accessMs !== undefined) {
    await fs.writeFile(path.join(dir, '.lien-accessed'), String(opts.accessMs), 'utf-8');
  }
  return dir;
}

beforeEach(async () => {
  originalHome = process.env.LIEN_HOME;
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-autogc-test-'));
  process.env.LIEN_HOME = home;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.LIEN_HOME;
  else process.env.LIEN_HOME = originalHome;
  delete process.env.LIEN_AUTO_GC;
  await fs.rm(home, { recursive: true, force: true });
});

describe('runAutoGc', () => {
  it('runs orphan GC on the first invocation and throttles the immediate second', async () => {
    const dir = await makeIndex('orphan-auto', {
      sourceRoot: path.join(home, 'gone', 'auto'),
      withDb: true,
    });

    const first = await runAutoGc();
    expect(first.ran).toBe(true);
    expect(first.summary?.removedIndices).toBe(1);
    expect(fsSync.existsSync(dir)).toBe(false);
    expect(fsSync.existsSync(path.join(home, '.lien', GC_STAMP_FILE))).toBe(true);

    const second = await runAutoGc();
    expect(second.ran).toBe(false);
    expect(second.reason).toBe('throttled');
  });

  it('sweeps legacy lance dirs from surviving indices', async () => {
    const root = path.join(home, 'roots', 'keep');
    await fs.mkdir(root, { recursive: true });
    const dir = await makeIndex('keep-auto', { sourceRoot: root, withDb: true, lance: true });

    const res = await runAutoGc();

    expect(res.ran).toBe(true);
    expect(res.summary?.sweptLanceDirs).toBe(1);
    expect(fsSync.existsSync(path.join(dir, LEGACY_LANCE_DIRNAME))).toBe(false);
    expect(fsSync.existsSync(dir)).toBe(true);
  });

  it('never stale-GCs automatically — an old present-root index survives', async () => {
    const root = path.join(home, 'roots', 'old');
    await fs.mkdir(root, { recursive: true });
    const dir = await makeIndex('old-present', {
      sourceRoot: root,
      withDb: true,
      accessMs: Date.now() - 400 * DAY,
    });

    const res = await runAutoGc();

    expect(res.ran).toBe(true);
    expect(fsSync.existsSync(dir)).toBe(true); // stale is opt-in only, never automatic
  });

  it('is disabled by LIEN_AUTO_GC=off', async () => {
    process.env.LIEN_AUTO_GC = 'off';

    const res = await runAutoGc();

    expect(res).toEqual({ ran: false, reason: 'disabled' });
  });

  it('no-ops when another serve holds the lock', async () => {
    await fs.mkdir(path.join(home, '.lien'), { recursive: true });
    await fs.writeFile(path.join(home, '.lien', GC_LOCK_FILE), 'peer', 'utf-8');

    const res = await runAutoGc();

    expect(res.ran).toBe(false);
    expect(res.reason).toBe('locked');
  });
});

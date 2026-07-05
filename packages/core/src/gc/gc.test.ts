import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { openDatabase, STRUCTURAL_DB_FILENAME } from '../vectordb/sqlite/schema.js';
import { planGc, executeGc, runGc, getIndicesRoot, LEGACY_LANCE_DIRNAME } from './gc.js';
import { writeAccessStamp, readAccessStamp } from './access-stamp.js';
import { probeIndexLock } from './live-handle.js';

const DAY = 24 * 60 * 60 * 1000;

let originalHome: string | undefined;
let home: string;

interface FixtureOpts {
  /** Absolute source root to record in the manifest (undefined = legacy manifest with no sourceRoot). */
  sourceRoot?: string;
  lastIndexed?: number;
  withDb?: boolean;
  lance?: boolean;
  /** Access-stamp timestamp (epoch ms). */
  accessMs?: number;
}

/** Create a fixture index directory under the sandbox indices root. */
async function makeIndex(name: string, opts: FixtureOpts = {}): Promise<string> {
  const dir = path.join(getIndicesRoot(), name);
  await fs.mkdir(dir, { recursive: true });

  const manifest: Record<string, unknown> = {
    formatVersion: 5,
    lienVersion: 'test',
    lastIndexed: opts.lastIndexed ?? Date.now(),
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

/** A present (existing) source root inside the sandbox home. */
async function presentRoot(name: string): Promise<string> {
  const root = path.join(home, 'roots', name);
  await fs.mkdir(root, { recursive: true });
  return root;
}

/** A gone (non-existent) source root inside the sandbox home. */
function goneRoot(name: string): string {
  return path.join(home, 'gone', name);
}

beforeEach(async () => {
  originalHome = process.env.LIEN_HOME;
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-gc-test-'));
  process.env.LIEN_HOME = home;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.LIEN_HOME;
  else process.env.LIEN_HOME = originalHome;
  await fs.rm(home, { recursive: true, force: true });
});

describe('planGc — orphan detection', () => {
  it('flags an index whose source root is gone as orphan, keeps one whose root exists', async () => {
    await makeIndex('orphan-1', { sourceRoot: goneRoot('deleted-repo'), withDb: true });
    await makeIndex('present-1', { sourceRoot: await presentRoot('live-repo'), withDb: true });

    const plan = await planGc();

    expect(plan.removals.map(r => r.repoId)).toEqual(['orphan-1']);
    expect(plan.removals[0].kind).toBe('orphan');
    expect(plan.skipped.find(s => s.repoId === 'present-1')?.reason).toBe('present');
  });

  it('runGc deletes orphan dirs and reports freed space', async () => {
    const dir = await makeIndex('orphan-real', { sourceRoot: goneRoot('gone-real'), withDb: true });

    const { summary } = await runGc();

    expect(summary.removedIndices).toBe(1);
    expect(summary.dryRun).toBe(false);
    expect(fsSync.existsSync(dir)).toBe(false);
  });
});

describe('planGc — unknown provenance (legacy indices)', () => {
  it('skips a legacy index with no recorded source root', async () => {
    await makeIndex('legacy-1', { withDb: true });

    const plan = await planGc();

    expect(plan.removals).toHaveLength(0);
    expect(plan.skipped.find(s => s.repoId === 'legacy-1')?.reason).toBe('unknown-provenance');
  });

  it('removes an unknown-provenance index only when --stale and old enough', async () => {
    await makeIndex('legacy-old', { withDb: true, accessMs: Date.now() - 90 * DAY });

    const plan = await planGc({ staleDays: 60 });

    const removal = plan.removals.find(r => r.repoId === 'legacy-old');
    expect(removal?.kind).toBe('stale');
  });
});

describe('planGc — stale threshold + access stamp', () => {
  it('honors the stale threshold using the access stamp', async () => {
    const root = await presentRoot('shared');
    await makeIndex('stale-1', { sourceRoot: root, withDb: true, accessMs: Date.now() - 90 * DAY });
    await makeIndex('fresh-1', { sourceRoot: root, withDb: true, accessMs: Date.now() - 5 * DAY });

    const plan = await planGc({ staleDays: 60 });

    const removed = plan.removals.map(r => r.repoId);
    expect(removed).toContain('stale-1');
    expect(removed).not.toContain('fresh-1');
    expect(plan.skipped.find(s => s.repoId === 'fresh-1')?.reason).toBe('present');
  });

  it('does not treat a present index as stale without the --stale opt-in', async () => {
    const root = await presentRoot('old-but-no-optin');
    await makeIndex('old-1', { sourceRoot: root, withDb: true, accessMs: Date.now() - 400 * DAY });

    const plan = await planGc(); // no staleDays

    expect(plan.removals).toHaveLength(0);
  });

  it('refreshes the access stamp on write', async () => {
    const dir = await makeIndex('acc-1', { accessMs: 1000 });

    await writeAccessStamp(dir);

    const stamp = await readAccessStamp(dir);
    expect(stamp).toBeGreaterThan(1000);
  });
});

describe('planGc — legacy lance sweep', () => {
  it('sweeps code_chunks.lance from a surviving index, keeping the index dir', async () => {
    const root = await presentRoot('keep');
    const dir = await makeIndex('keep-1', { sourceRoot: root, withDb: true, lance: true });

    const plan = await planGc();
    expect(plan.lanceSweeps.map(s => s.repoId)).toEqual(['keep-1']);

    await executeGc(plan);

    expect(fsSync.existsSync(path.join(dir, LEGACY_LANCE_DIRNAME))).toBe(false);
    expect(fsSync.existsSync(dir)).toBe(true);
  });
});

describe('executeGc — dry run', () => {
  it('reports candidates but deletes nothing', async () => {
    const dir = await makeIndex('orphan-dry', { sourceRoot: goneRoot('dry'), withDb: true });

    const plan = await planGc({ dryRun: true });
    const summary = await executeGc(plan, { dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.removedIndices).toBe(1);
    expect(fsSync.existsSync(dir)).toBe(true); // untouched
  });
});

describe('planGc — safety rails', () => {
  it('skips an index a live process holds open (BEGIN IMMEDIATE busy)', async () => {
    const dir = await makeIndex('orphan-live', { sourceRoot: goneRoot('live'), withDb: true });

    // Second connection holds the write lock, simulating a live serve/index.
    const holder = new Database(path.join(dir, STRUCTURAL_DB_FILENAME));
    holder.pragma('busy_timeout = 0');
    holder.exec('BEGIN IMMEDIATE');
    try {
      expect(probeIndexLock(dir)).toBe('locked');

      const plan = await planGc();
      expect(plan.removals.find(r => r.repoId === 'orphan-live')).toBeUndefined();
      expect(plan.skipped.find(s => s.repoId === 'orphan-live')?.reason).toBe('in-use');
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
    }

    // Lock released → probe reports free again.
    expect(probeIndexLock(dir)).toBe('unlocked');
  });

  it('never removes a protected (current-project) index', async () => {
    const dir = await makeIndex('orphan-prot', { sourceRoot: goneRoot('prot'), withDb: true });

    const plan = await planGc({ protectedDirs: [dir] });

    expect(plan.removals).toHaveLength(0);
    expect(plan.skipped.find(s => s.repoId === 'orphan-prot')?.reason).toBe('current-project');
  });

  it('skips (does not orphan) an index whose source root is on an offline /Volumes mount', async () => {
    await makeIndex('vol-1', {
      sourceRoot: '/Volumes/NonexistentDrive12345/project',
      withDb: true,
    });

    const plan = await planGc();

    expect(plan.removals).toHaveLength(0);
    expect(plan.skipped.find(s => s.repoId === 'vol-1')?.reason).toBe('volume-offline');
  });

  it('recognizes Linux mount roots (/media, /mnt) split as POSIX paths regardless of host', async () => {
    await makeIndex('media-1', {
      sourceRoot: '/media/NonexistentDrive12345/project',
      withDb: true,
    });
    await makeIndex('mnt-1', {
      sourceRoot: '/mnt/NonexistentDrive12345/project',
      withDb: true,
    });

    const plan = await planGc();

    expect(plan.removals).toHaveLength(0);
    expect(plan.skipped.find(s => s.repoId === 'media-1')?.reason).toBe('volume-offline');
    expect(plan.skipped.find(s => s.repoId === 'mnt-1')?.reason).toBe('volume-offline');
  });

  it('does not misclassify an unrelated top-level dir as a mount root', async () => {
    await makeIndex('unrelated-1', {
      sourceRoot: goneRoot('unrelated/deep/nested'),
      withDb: true,
    });

    const plan = await planGc();

    // Not under /Volumes, /media, or /mnt — falls through to the ancestor-dir
    // guard and, since `home` (the nearest existing ancestor) is a real dir,
    // resolves as a genuine orphan rather than volume-offline.
    expect(plan.removals.map(r => r.repoId)).toContain('unrelated-1');
  });

  it('skips an index whose structural store cannot be probed (fails closed)', async () => {
    const dir = await makeIndex('unprobeable-1', {
      sourceRoot: goneRoot('unprobeable'),
      withDb: true,
    });
    const dbPath = path.join(dir, STRUCTURAL_DB_FILENAME);

    if (process.getuid && process.getuid() === 0) {
      // Running as root bypasses file permissions — chmod 000 is ineffective.
      return;
    }

    await fs.chmod(dbPath, 0o000);
    try {
      expect(probeIndexLock(dir)).toBe('unprobeable');

      const plan = await planGc();
      expect(plan.removals.find(r => r.repoId === 'unprobeable-1')).toBeUndefined();
      expect(plan.skipped.find(s => s.repoId === 'unprobeable-1')?.reason).toBe('unprobeable');
    } finally {
      await fs.chmod(dbPath, 0o600);
    }
  });
});

describe('classifyIndex — precedence', () => {
  it('volume-offline outranks a locked structural store', async () => {
    const dir = await makeIndex('vol-locked', {
      sourceRoot: '/Volumes/NonexistentDrive99999/project',
      withDb: true,
    });
    const holder = new Database(path.join(dir, STRUCTURAL_DB_FILENAME));
    holder.pragma('busy_timeout = 0');
    holder.exec('BEGIN IMMEDIATE');
    try {
      const plan = await planGc();
      // volume-offline is decided before the lock is ever probed.
      expect(plan.skipped.find(s => s.repoId === 'vol-locked')?.reason).toBe('volume-offline');
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
    }
  });

  it('a live lock outranks an orphaned source root — never removed while locked', async () => {
    const dir = await makeIndex('orphan-locked', {
      sourceRoot: goneRoot('orphan-locked'),
      withDb: true,
    });
    const holder = new Database(path.join(dir, STRUCTURAL_DB_FILENAME));
    holder.pragma('busy_timeout = 0');
    holder.exec('BEGIN IMMEDIATE');
    try {
      const plan = await planGc();
      expect(plan.removals.find(r => r.repoId === 'orphan-locked')).toBeUndefined();
      expect(plan.skipped.find(s => s.repoId === 'orphan-locked')?.reason).toBe('in-use');
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
    }
  });

  it('--stale reclaims an unknown-provenance index once old enough, not before', async () => {
    await makeIndex('legacy-not-old', { withDb: true, accessMs: Date.now() - 5 * DAY });
    await makeIndex('legacy-old-enough', { withDb: true, accessMs: Date.now() - 90 * DAY });

    const plan = await planGc({ staleDays: 60 });

    expect(plan.skipped.find(s => s.repoId === 'legacy-not-old')?.reason).toBe(
      'unknown-provenance',
    );
    const removal = plan.removals.find(r => r.repoId === 'legacy-old-enough');
    expect(removal?.kind).toBe('stale');
  });

  it('a present-root index that is not old enough is labeled "present", never "stale"', async () => {
    const root = await presentRoot('not-old-enough');
    await makeIndex('present-not-old', {
      sourceRoot: root,
      withDb: true,
      accessMs: Date.now() - 5 * DAY,
    });

    const plan = await planGc({ staleDays: 60 });

    expect(plan.removals.find(r => r.repoId === 'present-not-old')).toBeUndefined();
    expect(plan.skipped.find(s => s.repoId === 'present-not-old')?.reason).toBe('present');
  });
});

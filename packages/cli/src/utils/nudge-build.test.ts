import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { hashHooksDir, getBuildStamp, nudgeBuildCachePath } from './nudge-build.js';
import { getPackageVersion } from './version.js';

let home: string;
let originalHome: string | undefined;
const rootDir = '/fake/repo/for-nudge-build-test';

beforeEach(async () => {
  originalHome = process.env.LIEN_HOME;
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-nudge-build-test-'));
  process.env.LIEN_HOME = home;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.LIEN_HOME;
  else process.env.LIEN_HOME = originalHome;
  await fs.rm(home, { recursive: true, force: true });
});

async function makeHooksDir(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-hooks-dir-'));
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content, 'utf-8');
  }
  return dir;
}

describe('hashHooksDir', () => {
  it('is deterministic for the same directory content', async () => {
    const dir = await makeHooksDir({ 'a.sh': 'echo a', 'hooks.json': '{}' });
    const h1 = await hashHooksDir(dir);
    const h2 = await hashHooksDir(dir);
    expect(h1).toBeDefined();
    expect(h1).toBe(h2);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("changes when a file's content changes", async () => {
    const dir = await makeHooksDir({ 'a.sh': 'echo a' });
    const before = await hashHooksDir(dir);
    await fs.writeFile(path.join(dir, 'a.sh'), 'echo b', 'utf-8');
    const after = await hashHooksDir(dir);
    expect(after).not.toBe(before);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('changes when a file is added or removed', async () => {
    const dir = await makeHooksDir({ 'a.sh': 'echo a' });
    const before = await hashHooksDir(dir);
    await fs.writeFile(path.join(dir, 'b.sh'), 'echo b', 'utf-8');
    const after = await hashHooksDir(dir);
    expect(after).not.toBe(before);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('is insensitive to filesystem iteration order (sorted internally)', async () => {
    const dir1 = await makeHooksDir({ 'a.sh': '1', 'b.sh': '2', 'c.sh': '3' });
    const dir2 = await makeHooksDir({ 'c.sh': '3', 'a.sh': '1', 'b.sh': '2' });
    expect(await hashHooksDir(dir1)).toBe(await hashHooksDir(dir2));
    await fs.rm(dir1, { recursive: true, force: true });
    await fs.rm(dir2, { recursive: true, force: true });
  });

  it('returns undefined for a missing directory (fail-open)', async () => {
    expect(await hashHooksDir('/no/such/dir/anywhere')).toBeUndefined();
  });

  it('returns undefined for an empty directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-hooks-empty-'));
    expect(await hashHooksDir(dir)).toBeUndefined();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('ignores subdirectories (only hashes regular files)', async () => {
    const dir = await makeHooksDir({ 'a.sh': 'echo a' });
    await fs.mkdir(path.join(dir, 'subdir'));
    await fs.writeFile(path.join(dir, 'subdir', 'nested.sh'), 'ignored', 'utf-8');
    const withSubdir = await hashHooksDir(dir);
    const flatOnly = await hashHooksDir(await makeHooksDir({ 'a.sh': 'echo a' }));
    expect(withSubdir).toBe(flatOnly);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('getBuildStamp', () => {
  it('always includes the running CLI version, even with no hooksDir', async () => {
    const stamp = await getBuildStamp(rootDir, 'sess-1');
    expect(stamp.cliVersion).toBe(getPackageVersion());
    expect(stamp.hooksHash).toBeUndefined();
  });

  it('includes hooksHash when a hooksDir is supplied', async () => {
    const dir = await makeHooksDir({ 'a.sh': 'echo a' });
    const stamp = await getBuildStamp(rootDir, 'sess-2', dir);
    expect(stamp.hooksHash).toBeDefined();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('caches the stamp across calls in the same session (mutating hooksDir after first call has no effect)', async () => {
    const dir = await makeHooksDir({ 'a.sh': 'echo a' });
    const first = await getBuildStamp(rootDir, 'sess-3', dir);
    await fs.writeFile(path.join(dir, 'a.sh'), 'echo changed', 'utf-8');
    const second = await getBuildStamp(rootDir, 'sess-3', dir);
    expect(second).toEqual(first);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('does not mix stamps across different sessions', async () => {
    const dirA = await makeHooksDir({ 'a.sh': 'A' });
    const dirB = await makeHooksDir({ 'a.sh': 'B' });
    const a = await getBuildStamp(rootDir, 'sess-a', dirA);
    const b = await getBuildStamp(rootDir, 'sess-b', dirB);
    expect(a.hooksHash).not.toBe(b.hooksHash);
    await fs.rm(dirA, { recursive: true, force: true });
    await fs.rm(dirB, { recursive: true, force: true });
  });

  it('tops up a cached partial stamp (cliVersion-only) once a hooksDir is later supplied', async () => {
    const partial = await getBuildStamp(rootDir, 'sess-4');
    expect(partial.hooksHash).toBeUndefined();
    const dir = await makeHooksDir({ 'a.sh': 'echo a' });
    const topped = await getBuildStamp(rootDir, 'sess-4', dir);
    expect(topped.hooksHash).toBeDefined();
    expect(topped.cliVersion).toBe(partial.cliVersion);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes a per-session cache file at nudgeBuildCachePath', async () => {
    const dir = await makeHooksDir({ 'a.sh': 'echo a' });
    await getBuildStamp(rootDir, 'sess-5', dir);
    const cachePath = nudgeBuildCachePath(rootDir, 'sess-5');
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
    expect(cached.cliVersion).toBe(getPackageVersion());
    expect(typeof cached.hooksHash).toBe('string');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('never throws even when the cache directory cannot be created', async () => {
    const blocker = path.join(home, 'blocker-file');
    await fs.writeFile(blocker, 'not a directory', 'utf-8');
    process.env.LIEN_HOME = blocker;
    await expect(getBuildStamp(rootDir, 'sess-6')).resolves.toMatchObject({
      cliVersion: getPackageVersion(),
    });
  });
});

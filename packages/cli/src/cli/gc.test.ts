import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { gcCommand } from './gc.js';

let originalHome: string | undefined;
let home: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

function indicesRoot(): string {
  return path.join(home, '.lien', 'indices');
}

async function makeOrphan(name: string): Promise<string> {
  const dir = path.join(indicesRoot(), name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      formatVersion: 5,
      lienVersion: 'test',
      lastIndexed: Date.now(),
      files: {},
      sourceRoot: path.join(home, 'gone', name),
    }),
    'utf-8',
  );
  return dir;
}

/** Concatenate everything printed to stdout during a command. */
function loggedText(): string {
  return logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
}

beforeEach(async () => {
  originalHome = process.env.LIEN_HOME;
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-gc-cli-test-'));
  process.env.LIEN_HOME = home;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.LIEN_HOME;
  else process.env.LIEN_HOME = originalHome;
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

describe('gcCommand', () => {
  it('--dry-run lists the orphan candidate and deletes nothing', async () => {
    const dir = await makeOrphan('orphan-cli');

    await gcCommand({ dryRun: true });

    const out = loggedText();
    expect(out).toContain('orphan-cli');
    expect(out).toContain('orphan');
    expect(out).toContain('dry run');
    expect(fsSync.existsSync(dir)).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('deletes the orphan on a real run and prints a summary', async () => {
    const dir = await makeOrphan('orphan-cli-real');

    await gcCommand({});

    expect(fsSync.existsSync(dir)).toBe(false);
    expect(loggedText()).toMatch(/Removed 1 index/);
  });

  it('--format json emits machine-readable plan + summary', async () => {
    await makeOrphan('orphan-json');

    await gcCommand({ dryRun: true, format: 'json' });

    const parsed = JSON.parse(loggedText());
    expect(parsed.plan.removals).toHaveLength(1);
    expect(parsed.plan.removals[0].kind).toBe('orphan');
    expect(parsed.summary.dryRun).toBe(true);
  });

  it('rejects an invalid --stale value', async () => {
    await gcCommand({ stale: 'not-a-number' });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects an invalid --format', async () => {
    await gcCommand({ format: 'yaml' });

    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

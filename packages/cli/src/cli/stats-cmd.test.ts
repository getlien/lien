import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { recordDeltaEvent, type DeltaEvent } from '../utils/delta-events.js';
import { statsCommand } from './stats-cmd.js';

const execFileAsync = promisify(execFile);
const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

function event(overrides: Partial<DeltaEvent> = {}): DeltaEvent {
  return {
    timestamp: new Date().toISOString(),
    mode: 'normal',
    exitCode: 0,
    counts: { crossings: 0, newOverThreshold: 0, improved: 0 },
    flagged: [],
    ...overrides,
  };
}

describe('statsCommand', () => {
  let dir: string;
  let home: string;
  let originalCwd: string;
  let originalHome: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  async function git(...args: string[]): Promise<void> {
    await execFileAsync('git', args, { cwd: dir });
  }

  async function initRepo(): Promise<void> {
    await git('init', '-q');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await fs.writeFile(path.join(dir, 'README.md'), 'x', 'utf-8');
    await git('add', '-A');
    await git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
  }

  /** Run statsCommand and resolve to the exit code, instead of throwing the sentinel. */
  async function runStats(options: Parameters<typeof statsCommand>[0] = {}): Promise<number> {
    try {
      await statsCommand(options);
    } catch (error) {
      const match = /__exit__:(\d+)/.exec(error instanceof Error ? error.message : String(error));
      if (match) return Number(match[1]);
      throw error;
    }
    return 0;
  }

  function lastJsonLog(): Record<string, unknown> {
    const call = logSpy.mock.calls.at(-1);
    return JSON.parse(String(call?.[0]));
  }

  function loggedText(): string {
    return stripAnsi(logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n'));
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-stats-cmd-'));
    dir = await fs.realpath(dir);
    originalCwd = process.cwd();
    process.chdir(dir);

    originalHome = process.env.LIEN_HOME;
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-stats-home-'));
    process.env.LIEN_HOME = home;

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.LIEN_HOME;
    else process.env.LIEN_HOME = originalHome;
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('exits 1 on an invalid --format', async () => {
    await initRepo();
    const exitCode = await runStats({ format: 'yaml' });
    expect(exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('invalid --format'));
  });

  it('exits 1 outside a git repository', async () => {
    // dir was never git-initialized here.
    const exitCode = await runStats({ format: 'json' });
    expect(exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('not a git repository'));
  });

  it('reports zero runs when no events have been recorded yet', async () => {
    await initRepo();
    const exitCode = await runStats({ format: 'json' });
    expect(exitCode).toBe(0);
    const result = lastJsonLog() as { totalEvents: number; windows: Array<{ runs: number }> };
    expect(result.totalEvents).toBe(0);
    expect(result.windows.every(w => w.runs === 0)).toBe(true);
  });

  it('text format prints a friendly empty state instead of a windows table', async () => {
    await initRepo();
    await runStats({ format: 'text' });
    expect(loggedText()).toContain('No lien delta runs recorded yet');
  });

  it('aggregates recorded events into the 7 and 30 day windows', async () => {
    await initRepo();
    const rootDir = dir;

    // A flagged run 3 days ago (within both windows) ...
    await recordDeltaEvent(
      rootDir,
      event({
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        exitCode: 1,
        counts: { crossings: 1, newOverThreshold: 1, improved: 0 },
        flagged: [{ filepath: 'a.ts', symbol: 'foo', metric: 'cognitive' }],
      }),
    );
    // ... resolved by a clean run 1 day ago.
    await recordDeltaEvent(
      rootDir,
      event({
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        exitCode: 0,
      }),
    );
    // A run 40 days ago falls outside both windows.
    await recordDeltaEvent(
      rootDir,
      event({ timestamp: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() }),
    );

    const exitCode = await runStats({ format: 'json' });
    expect(exitCode).toBe(0);
    const result = lastJsonLog() as {
      totalEvents: number;
      windows: Array<{
        windowDays: number;
        runs: number;
        runsWithCrossings: number;
        distinctFunctionsFlagged: number;
        resolvedAfterFlag: number;
      }>;
    };

    expect(result.totalEvents).toBe(3);
    const win7 = result.windows.find(w => w.windowDays === 7)!;
    expect(win7.runs).toBe(2);
    expect(win7.runsWithCrossings).toBe(1);
    expect(win7.distinctFunctionsFlagged).toBe(1);
    expect(win7.resolvedAfterFlag).toBe(1);

    const win30 = result.windows.find(w => w.windowDays === 30)!;
    expect(win30.runs).toBe(2); // the 40-day-old run is still outside the 30-day window
  });

  it('text format prints the resolved-after-flag disclaimer, not a causal claim', async () => {
    await initRepo();
    await recordDeltaEvent(dir, event({ exitCode: 0 }));
    await runStats({ format: 'text' });
    const text = loggedText();
    expect(text).toContain('not proof');
    expect(text).not.toMatch(/warnings heeded/i);
  });
});

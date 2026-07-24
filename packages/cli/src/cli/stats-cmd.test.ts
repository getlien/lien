import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { recordDeltaEvent, type DeltaEvent } from '../utils/delta-events.js';
import { recordBlastEvent, type BlastEvent } from '../utils/blast-events.js';
import { recordNudgeShown, recordNudgeSignal } from '../utils/nudge-events.js';
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

function blastEvent(overrides: Partial<BlastEvent> = {}): BlastEvent {
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

describe('statsCommand — exported-signature nudge (blast-radius) section', () => {
  let dir: string;
  let home: string;
  let originalCwd: string;
  let originalHome: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

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

  async function runStats(options: Parameters<typeof statsCommand>[0] = {}): Promise<void> {
    await statsCommand(options);
  }

  function lastJsonLog(): Record<string, unknown> {
    const call = logSpy.mock.calls.at(-1);
    return JSON.parse(String(call?.[0]));
  }

  function loggedText(): string {
    return stripAnsi(logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n'));
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-stats-blast-cmd-'));
    dir = await fs.realpath(dir);
    originalCwd = process.cwd();
    process.chdir(dir);

    originalHome = process.env.LIEN_HOME;
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-stats-blast-home-'));
    process.env.LIEN_HOME = home;

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.LIEN_HOME;
    else process.env.LIEN_HOME = originalHome;
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('JSON output nests blast-radius stats under `blastRadius`, additive to the pre-existing shape', async () => {
    await initRepo();
    await recordBlastEvent(dir, blastEvent());
    await runStats({ format: 'json' });

    const result = lastJsonLog() as {
      totalEvents: number;
      windows: unknown[];
      blastRadius: { totalEvents: number; windows: Array<{ windowDays: number; runs: number }> };
    };
    // Pre-existing top-level shape is untouched.
    expect(result.totalEvents).toBe(0);
    expect(result.windows).toHaveLength(2);
    // New, additive section.
    expect(result.blastRadius.totalEvents).toBe(1);
    const win7 = result.blastRadius.windows.find(w => w.windowDays === 7)!;
    expect(win7.runs).toBe(1);
  });

  it('text output prints the exported-signature nudge section with distinct symbols and risk buckets', async () => {
    await initRepo();
    await recordBlastEvent(dir, blastEvent());
    await recordBlastEvent(
      dir,
      blastEvent({
        filepath: 'src/bar.ts',
        changes: [
          {
            symbol: 'Widget.render',
            kind: 'removed',
            dependentCount: 12,
            untestedDependentCount: 3,
            riskLevel: 'high',
          },
        ],
      }),
    );
    await runStats({ format: 'text' });

    const text = loggedText();
    expect(text).toContain('Exported-signature nudge');
    expect(text).toContain('Distinct symbols changed: 2');
    expect(text).toContain('high 1');
  });

  it('still prints the friendly empty state when neither delta nor blast events exist', async () => {
    await initRepo();
    await runStats({ format: 'text' });
    expect(loggedText()).toContain('No lien delta runs recorded yet');
  });

  it('prints both sections once only a blast event exists (delta log stays empty)', async () => {
    await initRepo();
    await recordBlastEvent(dir, blastEvent());
    await runStats({ format: 'text' });

    const text = loggedText();
    expect(text).not.toContain('No lien delta runs recorded yet');
    expect(text).toContain('lien delta — nudge-loop stats');
    expect(text).toContain('Exported-signature nudge');
  });
});

describe('statsCommand — nudge funnels (telemetry v2) section', () => {
  let dir: string;
  let home: string;
  let originalCwd: string;
  let originalHome: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

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

  function lastJsonLog(): Record<string, unknown> {
    return JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
  }

  function loggedText(): string {
    return stripAnsi(logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n'));
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-stats-funnel-cmd-'));
    dir = await fs.realpath(dir);
    originalCwd = process.cwd();
    process.chdir(dir);

    originalHome = process.env.LIEN_HOME;
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-stats-funnel-home-'));
    process.env.LIEN_HOME = home;

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.LIEN_HOME;
    else process.env.LIEN_HOME = originalHome;
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('JSON output nests funnels under `nudgeFunnels`, additive to the pre-existing shape', async () => {
    await initRepo();
    // A shown → acted pair in one session.
    await recordNudgeShown(dir, { sessionId: 's1', nudge: 'blast', file: 'a.ts' });
    await recordNudgeSignal(dir, { sessionId: 's1', signal: 'get_dependents' });

    await statsCommand({ format: 'json' });

    const result = lastJsonLog() as {
      totalEvents: number;
      blastRadius: unknown;
      nudgeFunnels: {
        totalEvents: number;
        windows: Array<Array<{ nudge: string; shown: number; acted: number }>>;
      };
    };
    // Pre-existing shape untouched.
    expect(result.totalEvents).toBe(0);
    expect(result.blastRadius).toBeDefined();
    // New additive section.
    expect(result.nudgeFunnels.totalEvents).toBe(2);
    const blast7 = result.nudgeFunnels.windows[0].find(f => f.nudge === 'blast')!;
    expect(blast7).toMatchObject({ shown: 1, acted: 1 });
  });

  it('text output prints the funnel section with a correlation-not-causation disclaimer', async () => {
    await initRepo();
    await recordNudgeShown(dir, { sessionId: 's1', nudge: 'test-verify' });
    await recordNudgeSignal(dir, { sessionId: 's1', signal: 'test_run' });

    await statsCommand({ format: 'text' });

    const text = loggedText();
    expect(text).toContain('Nudge funnels (shown → acted-on)');
    expect(text).toContain('did-you-run-tests');
    expect(text).toContain('NOT proof the nudge caused');
    expect(text).toContain('LIEN_NUDGE_EVENTS=off');
  });

  it('prints the funnel section even when only nudge events exist (delta/blast logs empty)', async () => {
    await initRepo();
    await recordNudgeShown(dir, { sessionId: 's1', nudge: 'annotate', file: 'a.ts' });

    await statsCommand({ format: 'text' });
    const text = loggedText();
    expect(text).not.toContain('No lien delta runs recorded yet');
    expect(text).toContain('Nudge funnels (shown → acted-on)');
  });
});

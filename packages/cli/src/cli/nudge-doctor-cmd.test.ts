import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  computeNudgeDoctorReport,
  nudgeDoctorCommand,
  TELEMETRY_CANARY_FILE,
} from './nudge-doctor-cmd.js';
import { recordNudgeShown } from '../utils/nudge-events.js';
import { getPackageVersion } from '../utils/version.js';

const execFileAsync = promisify(execFile);

describe('nudge doctor (issue #916, part 3)', () => {
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

  async function makeHooksDir(files: Record<string, string>): Promise<string> {
    const hooksDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-doctor-hooks-'));
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(hooksDir, name), content, 'utf-8');
    }
    return hooksDir;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-doctor-cmd-'));
    dir = await fs.realpath(dir);
    originalCwd = process.cwd();
    process.chdir(dir);

    originalHome = process.env.LIEN_HOME;
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-doctor-home-'));
    process.env.LIEN_HOME = home;

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.LIEN_HOME;
    else process.env.LIEN_HOME = originalHome;
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('critical: the live hooks dir is missing the telemetry canary file (the exact #916 incident)', async () => {
    await initRepo();
    const hooksDir = await makeHooksDir({ 'annotate-read.sh': 'echo hi' }); // no nudge-signal.sh
    const report = await computeNudgeDoctorReport({ hooksDir });
    expect(report.status).toBe('critical');
    expect(report.canaryMissing).toBe(true);
    expect(report.findings.join(' ')).toContain(TELEMETRY_CANARY_FILE);
  });

  it('ok: the live hooks dir has the canary and matches the last recorded stamp', async () => {
    await initRepo();
    const hooksDir = await makeHooksDir({ 'nudge-signal.sh': 'echo hi' });
    await recordNudgeShown(dir, { sessionId: 's1', nudge: 'annotate', hooksDir });

    const report = await computeNudgeDoctorReport({ hooksDir });
    expect(report.status).toBe('ok');
    expect(report.canaryMissing).toBe(false);
    expect(report.lastKnownBuild).toMatchObject({ cliVersion: getPackageVersion() });
    // A real comparison DID run and DID match, so the "matches" claim is honest here.
    expect(report.findings.join(' ')).toContain('matches the live hooks directory');
  });

  it('ok, but does NOT claim a match it never ran: live hash could not be computed', async () => {
    await initRepo();
    const recordHooksDir = await makeHooksDir({ 'nudge-signal.sh': 'echo hi' });
    await recordNudgeShown(dir, { sessionId: 's1', nudge: 'annotate', hooksDir: recordHooksDir });

    // `nudge-signal.sh` as a DIRECTORY (not a file): `fs.access` (existence
    // only) still finds it, so the canary check passes — but hashHooksDir's
    // `e.isFile()` filter excludes it, so with no OTHER entries the hooks
    // directory hashes to undefined. Portable (no reliance on permission
    // bits, which root-run CI containers can bypass) way to reproduce
    // "canary present, hash uncomputable".
    const liveHooksDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-doctor-hooks-'));
    await fs.mkdir(path.join(liveHooksDir, 'nudge-signal.sh'));

    const report = await computeNudgeDoctorReport({ hooksDir: liveHooksDir });
    expect(report.canaryMissing).toBe(false);
    expect(report.liveHooksHash).toBeNull();
    expect(report.findings.join(' ')).not.toContain('matches the live hooks directory');
    expect(report.findings.join(' ')).toContain('no comparison was made');
  });

  it('ok, but does NOT claim a match it never ran: the last recorded stamp has no hooks hash', async () => {
    await initRepo();
    // Recorded with NO --hooks-dir, so the stamp has cliVersion only.
    await recordNudgeShown(dir, { sessionId: 's1', nudge: 'annotate' });

    const liveHooksDir = await makeHooksDir({ 'nudge-signal.sh': 'echo hi' });
    const report = await computeNudgeDoctorReport({ hooksDir: liveHooksDir });
    expect(report.canaryMissing).toBe(false);
    expect(report.lastKnownBuild?.hooksHash).toBeUndefined();
    expect(report.findings.join(' ')).not.toContain('matches the live hooks directory');
    expect(report.findings.join(' ')).toContain('no comparison was made');
  });

  it('warn: never recorded — the ledger has no build-stamped event at all', async () => {
    await initRepo();
    const report = await computeNudgeDoctorReport({});
    expect(report.status).toBe('warn');
    expect(report.lastKnownBuild).toBeNull();
    expect(report.findings.join(' ')).toContain('No recording-capable build');
  });

  it("warn: the live hooks content hash differs from the last recorded session's stamp", async () => {
    await initRepo();
    const hooksDirAtRecordTime = await makeHooksDir({ 'nudge-signal.sh': 'v1' });
    await recordNudgeShown(dir, {
      sessionId: 's1',
      nudge: 'annotate',
      hooksDir: hooksDirAtRecordTime,
    });

    // Live hooks dir now has DIFFERENT content (simulates the plugin being updated/changed).
    const liveHooksDir = await makeHooksDir({ 'nudge-signal.sh': 'v2' });
    const report = await computeNudgeDoctorReport({ hooksDir: liveHooksDir });
    expect(report.status).toBe('warn');
    expect(report.canaryMissing).toBe(false);
    expect(report.findings.join(' ')).toContain('content hash');
  });

  it('warn: the CLI version that recorded the last stamp differs from the one running now', async () => {
    await initRepo();
    // Manually inject an event stamped by a different CLI version — recordNudgeShown
    // always stamps the ACTUAL running version, so simulate drift via a raw event.
    const { nudgeEventsFilePath } = await import('../utils/nudge-events.js');
    const eventsPath = nudgeEventsFilePath(dir);
    await fs.mkdir(path.dirname(eventsPath), { recursive: true });
    await fs.appendFile(
      eventsPath,
      `${JSON.stringify({
        kind: 'shown',
        timestamp: new Date().toISOString(),
        sessionId: 's1',
        nudge: 'annotate',
        build: { cliVersion: '0.1.0-old', hooksHash: 'aaaaaaaaaaaa' },
      })}\n`,
      'utf-8',
    );

    const report = await computeNudgeDoctorReport({});
    expect(report.status).toBe('warn');
    expect(report.findings.join(' ')).toContain('0.1.0-old');
  });

  it('no --hooks-dir given: only the ledger-history checks run (no canary/hash checks)', async () => {
    await initRepo();
    await recordNudgeShown(dir, { sessionId: 's1', nudge: 'annotate' });
    const report = await computeNudgeDoctorReport({});
    expect(report.canaryMissing).toBeNull();
    expect(report.liveHooksDir).toBeNull();
    expect(report.status).toBe('ok');
  });

  it('nudgeDoctorCommand prints text output and never throws', async () => {
    await initRepo();
    await expect(nudgeDoctorCommand({})).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalled();
  });

  it('nudgeDoctorCommand prints valid JSON with --format json', async () => {
    await initRepo();
    await nudgeDoctorCommand({ format: 'json' });
    const parsed = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
    expect(parsed.status).toBeDefined();
  });

  it('rejects an invalid --format without throwing', async () => {
    await initRepo();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(nudgeDoctorCommand({ format: 'yaml' })).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('invalid --format'));
  });
});

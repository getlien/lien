/**
 * `lien nudge doctor [--hooks-dir <path>] [--format text|json]` — a manual
 * drift/health check for the nudge-telemetry recording chain (issue #916,
 * part 3). It complements the `lien stats` recording-status footnote
 * (`computeNudgeRecordingStatus` in `../utils/nudge-stats.ts`): that answers
 * "was any capable build seen recently, from ledger history alone?"; this
 * answers "is the build wired up RIGHT NOW?" by inspecting the LIVE hooks
 * directory when one is given (`--hooks-dir`, the same argument the plugin
 * hooks pass to `note-shown`/`note-signal`/`recap` — see `nudge-build.ts`).
 *
 * Scope, deliberately narrowed: this checks for the single clearest
 * fingerprint of the incident that motivated #916 — `nudge-signal.sh`, the
 * file the telemetry-v2 instrumentation added, missing from the live hooks
 * directory entirely (a pre-instrumentation checkout, exactly what happened:
 * a directory-source plugin install pinned to a stale branch) — plus
 * version/hash drift against the ledger's own history. It does NOT verify
 * byte-for-byte that the live hooks match this CLI's exact expected content;
 * that would need a content manifest published inside the npm package,
 * generated at build time from `plugins/claude/hooks/` and shipped across a
 * package boundary this repo doesn't currently cross — judged out of scope
 * for this PR (see its description for the filed follow-up).
 *
 * Purely advisory: always exits 0, like `lien stats`. Not wired into a hook
 * by default — run it by hand (or from an agent) when telemetry looks off.
 */

import path from 'path';
import fs from 'fs/promises';
import chalk from 'chalk';
import { resolveProjectRoot } from './project-root.js';
import { toAbsolutePath } from '../types/paths.js';
import { readNudgeEvents } from '../utils/nudge-events.js';
import { latestBuildStampedEvent } from '../utils/nudge-stats.js';
import { hashHooksDir, type BuildStamp } from '../utils/nudge-build.js';
import { getPackageVersion } from '../utils/version.js';

export interface NudgeDoctorOptions {
  hooksDir?: string;
  format?: string;
}

const VALID_FORMATS = ['text', 'json'];

/** Added by the telemetry-v2 instrumentation (PR #847) — its absence from a
 *  live hooks directory is a direct, deterministic fingerprint of a
 *  pre-instrumentation plugin snapshot. */
export const TELEMETRY_CANARY_FILE = 'nudge-signal.sh';

export type DoctorStatus = 'ok' | 'warn' | 'critical';

export interface NudgeDoctorReport {
  status: DoctorStatus;
  findings: string[];
  currentCliVersion: string;
  lastKnownBuild: BuildStamp | null;
  lastSeenAt: string | null;
  liveHooksDir: string | null;
  liveHooksHash: string | null;
  /** true = canary missing (critical); false = present; null = no --hooks-dir given, not checked. */
  canaryMissing: boolean | null;
}

function resolveRootDir(): string {
  return resolveProjectRoot(toAbsolutePath(process.cwd()));
}

function escalate(current: DoctorStatus, next: DoctorStatus): DoctorStatus {
  const rank: Record<DoctorStatus, number> = { ok: 0, warn: 1, critical: 2 };
  return rank[next] > rank[current] ? next : current;
}

async function hooksDirHasCanary(hooksDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(hooksDir, TELEMETRY_CANARY_FILE));
    return true;
  } catch {
    return false;
  }
}

type LatestStamp = { build: BuildStamp; atMs: number };
type LiveHooks = { hooksDir: string; hash: string | undefined; canaryPresent: boolean };
type Finding = { status: DoctorStatus; message: string };

/** The exact incident #916 documents: the telemetry-instrumentation canary is
 *  missing from the live hooks directory — recording is flatly impossible. */
function checkCanary(live: LiveHooks | null): Finding | null {
  if (!live || live.canaryPresent) return null;
  return {
    status: 'critical',
    message:
      `${TELEMETRY_CANARY_FILE} is missing from the live hooks directory (${live.hooksDir}) — ` +
      'this plugin install predates nudge-telemetry instrumentation (issue #916) entirely. ' +
      'Recording is impossible until the plugin is updated.',
  };
}

/** The ledger has never once seen a build-stamped event — recording may never have run at all. */
function checkNeverRecorded(latest: LatestStamp | null): Finding | null {
  if (latest) return null;
  return {
    status: 'warn',
    message:
      'No recording-capable build has ever been observed in this repo’s nudge-events ledger.',
  };
}

/** The live hooks directory's content changed since the ledger's last recorded session. */
function checkHashDrift(latest: LatestStamp | null, live: LiveHooks | null): Finding | null {
  if (!latest || !live?.hash || !latest.build.hooksHash) return null;
  if (live.hash === latest.build.hooksHash) return null;
  return {
    status: 'warn',
    message:
      `The live hooks directory's content hash (${live.hash}) differs from the last recorded ` +
      `session's stamp (${latest.build.hooksHash}) — hooks changed since the last recorded session.`,
  };
}

/** The CLI recording the last session's stamp isn't the one running `doctor` now. */
function checkVersionDrift(latest: LatestStamp | null, currentCliVersion: string): Finding | null {
  if (!latest || latest.build.cliVersion === currentCliVersion) return null;
  return {
    status: 'warn',
    message:
      `The CLI version that recorded the last session's stamp (${latest.build.cliVersion}) ` +
      `differs from the one running now (${currentCliVersion}).`,
  };
}

function okMessage(latest: LatestStamp, live: LiveHooks | null): string {
  const liveNote = live ? ', matches the live hooks directory' : '';
  return (
    `Nudge telemetry looks current: last recorded build ${latest.build.cliVersion} ` +
    `(hooks ${latest.build.hooksHash ?? 'unknown'})${liveNote}.`
  );
}

/** Compose the report — the pure decision logic, no I/O (already gathered by the caller). */
function buildReport(
  currentCliVersion: string,
  latest: LatestStamp | null,
  live: LiveHooks | null,
): NudgeDoctorReport {
  const findings = [
    checkCanary(live),
    checkNeverRecorded(latest),
    checkHashDrift(latest, live),
    checkVersionDrift(latest, currentCliVersion),
  ].filter((f): f is Finding => f !== null);

  const status = findings.reduce((acc, f) => escalate(acc, f.status), 'ok' as DoctorStatus);
  const messages =
    latest && findings.length === 0 ? [okMessage(latest, live)] : findings.map(f => f.message);

  return {
    status,
    findings: messages,
    currentCliVersion,
    lastKnownBuild: latest?.build ?? null,
    lastSeenAt: latest ? new Date(latest.atMs).toISOString() : null,
    liveHooksDir: live?.hooksDir ?? null,
    liveHooksHash: live?.hash ?? null,
    canaryMissing: live ? !live.canaryPresent : null,
  };
}

/** Gather ledger + (optionally) live-hooks-dir facts, then hand off to the pure decision logic. */
export async function computeNudgeDoctorReport(
  options: NudgeDoctorOptions,
): Promise<NudgeDoctorReport> {
  const rootDir = resolveRootDir();
  const events = await readNudgeEvents(rootDir);
  const latest = latestBuildStampedEvent(events);
  const currentCliVersion = getPackageVersion();

  let live: { hooksDir: string; hash: string | undefined; canaryPresent: boolean } | null = null;
  if (options.hooksDir) {
    const [canaryPresent, hash] = await Promise.all([
      hooksDirHasCanary(options.hooksDir),
      hashHooksDir(options.hooksDir),
    ]);
    live = { hooksDir: options.hooksDir, hash, canaryPresent };
  }

  return buildReport(currentCliVersion, latest, live);
}

const STATUS_COLOR: Record<DoctorStatus, (s: string) => string> = {
  ok: chalk.green,
  warn: chalk.yellow,
  critical: chalk.red,
};

function renderText(report: NudgeDoctorReport): string {
  const lines = [
    STATUS_COLOR[report.status](`lien nudge doctor: ${report.status.toUpperCase()}`),
    '',
    ...report.findings.map(f => `  - ${f}`),
  ];
  return lines.join('\n');
}

/** `nudge doctor [--hooks-dir <path>] [--format text|json]`. Always exits 0 — purely advisory. */
export async function nudgeDoctorCommand(options: NudgeDoctorOptions = {}): Promise<void> {
  const format = options.format ?? 'text';
  if (!VALID_FORMATS.includes(format)) {
    console.error(
      chalk.red(`lien nudge doctor: invalid --format "${format}". Must be text or json.`),
    );
    return;
  }

  const report = await computeNudgeDoctorReport(options);
  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderText(report));
  }
}

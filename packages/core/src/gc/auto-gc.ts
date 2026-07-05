import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getLienHome } from '@liendev/parser';
import { runGc, type GcSummary } from './gc.js';

/** Stamp file recording the epoch-ms of the last machine-wide auto-GC run. */
export const GC_STAMP_FILE = 'gc-last-run';
/** Exclusive-create lock so piled-up serves don't stampede or double-delete. */
export const GC_LOCK_FILE = 'gc.lock';

/** At most one auto-GC across ALL serves per this window. */
export const AUTO_GC_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** A lock older than this is assumed abandoned by a crashed serve and reclaimed. */
const STALE_LOCK_MS = 60 * 60 * 1000;
/** How often the lock holder refreshes its mtime while GC runs, so a live but
 *  unusually slow run is never mistaken for a crashed one and reclaimed out
 *  from under it. Well under STALE_LOCK_MS. The lock is otherwise held only
 *  for the duration of a single GC run. */
const LOCK_HEARTBEAT_MS = 5 * 60 * 1000;

export interface AutoGcOptions {
  /** Index dirs to never touch (absolute paths; e.g. the serving project's). */
  protectedDirs?: string[];
  /** One-line logger used only when something was actually collected. */
  log?: (message: string) => void;
}

/** Outcome of an auto-GC attempt (returned mainly for tests). */
export interface AutoGcResult {
  /** True if this call actually ran GC (acquired the lock, past the throttle). */
  ran: boolean;
  /** Why it did not run, when `ran` is false. */
  reason?: 'disabled' | 'throttled' | 'locked';
  summary?: GcSummary;
}

async function readStampMs(stampPath: string): Promise<number> {
  try {
    const raw = await fs.readFile(stampPath, 'utf-8');
    const value = parseInt(raw.trim(), 10);
    return Number.isNaN(value) ? 0 : value;
  } catch {
    return 0;
  }
}

/**
 * After renaming a presumed-stale lock aside, confirm we moved the SAME file
 * we inspected (by inode) rather than a fresh lock a peer recreated in the
 * gap between our stat and our rename. Restores the file on a mismatch so we
 * don't clobber a peer's live lock.
 */
async function verifyReclaimedLock(
  reclaimPath: string,
  lockPath: string,
  originalIno: number,
): Promise<boolean> {
  try {
    const moved = await fs.stat(reclaimPath);
    if (moved.ino === originalIno) return true;
  } catch {
    return false;
  }
  await fs.rename(reclaimPath, lockPath).catch(() => {});
  return false;
}

/**
 * Try to grab the machine-wide GC lock via exclusive create. Returns a handle
 * on success, or null when a peer holds it. Reclaims a lock left behind by a
 * crashed serve once it is older than STALE_LOCK_MS.
 *
 * Reclaiming is race-prone: two peers can both stat the same stale lock and
 * decide to reclaim it. An unconditional rm+open lets the second peer's rm
 * delete the first peer's brand-new lock, so both end up believing they hold
 * it. Renaming the stale file aside instead of removing it is atomic — the
 * rename only succeeds for whichever caller finds the file still at
 * `lockPath`, so at most one caller proceeds to recreate the lock. A caller
 * that loses the rename (or the subsequent open, if it's beaten to that too)
 * treats the lock as held.
 *
 * That alone isn't sufficient: a rename doesn't check WHICH file is at
 * `lockPath`, only that something is. If caller A reclaims, recreates a fresh
 * lock, and finishes before caller B's own (later) rename runs, B's rename
 * would yank A's brand-new live lock out from under it and both would end up
 * holding a handle. Comparing the inode captured by the initial stat against
 * the inode actually moved detects this: a mismatch means a peer replaced the
 * file between our stat and our rename, so we restore it (rename back) and
 * treat the lock as held rather than stealing a live one.
 *
 * Exported for the concurrency test — not part of the public GC surface.
 */
export async function acquireLock(lockPath: string): Promise<fs.FileHandle | null> {
  try {
    return await fs.open(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return null;
    return await reclaimIfStale(lockPath);
  }
}

/** The EEXIST branch of {@link acquireLock}, split out to keep each function's
 *  branching manageable. */
async function reclaimIfStale(lockPath: string): Promise<fs.FileHandle | null> {
  let stat;
  try {
    stat = await fs.stat(lockPath);
  } catch {
    // A peer released it between our open and this stat — retry once.
    return await fs.open(lockPath, 'wx').catch(() => null);
  }
  if (Date.now() - stat.mtimeMs <= STALE_LOCK_MS) return null; // held, not stale

  // Unique per call, not just per pid — two racing reclaims from the SAME
  // process (e.g. concurrent runAutoGc invocations) would otherwise compute
  // an identical reclaim path and could both end up believing they hold the
  // lock (one renames the other's freshly-created lock file out from under it).
  const reclaimPath = `${lockPath}.reclaim-${process.pid}-${randomUUID()}`;
  try {
    await fs.rename(lockPath, reclaimPath);
  } catch {
    return null; // lost the reclaim race — a peer now owns the lock
  }

  // Verify we actually moved the file we inspected, not a fresh lock a peer
  // recreated in the gap between our stat and our rename.
  if (!(await verifyReclaimedLock(reclaimPath, lockPath, stat.ino))) return null;

  try {
    return await fs.open(lockPath, 'wx');
  } catch {
    // A peer's fresh acquire (or reclaim) beat us to recreating the file.
    return null;
  } finally {
    await fs.rm(reclaimPath, { force: true });
  }
}

/**
 * Periodically refresh the lock's mtime so a live GC run isn't reclaimed
 * mid-run by a peer that only sees an old mtime. Unref'd so it can never keep
 * the process alive if `clearInterval` is somehow skipped.
 *
 * Exported (with a configurable interval) for the heartbeat test — not part
 * of the public GC surface.
 */
export function startLockHeartbeat(
  lockPath: string,
  intervalMs: number = LOCK_HEARTBEAT_MS,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    const now = new Date();
    fs.utimes(lockPath, now, now).catch(() => {
      // Best-effort — if this fails the lock just ages normally.
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
}

async function releaseLock(handle: fs.FileHandle, lockPath: string): Promise<void> {
  try {
    await handle.close();
  } catch {
    // ignore
  }
  try {
    await fs.rm(lockPath, { force: true });
  } catch {
    // ignore
  }
}

/** True when the throttle window has not yet elapsed since the last run. */
async function isThrottled(stampPath: string): Promise<boolean> {
  return Date.now() - (await readStampMs(stampPath)) < AUTO_GC_INTERVAL_MS;
}

/** Emit the single summary line, only when something was actually collected. */
function logCollected(summary: GcSummary, log?: (message: string) => void): void {
  if (summary.removedIndices === 0 && summary.sweptLanceDirs === 0) return;
  const indices = `${summary.removedIndices} orphaned ${summary.removedIndices === 1 ? 'index' : 'indices'}`;
  const lance =
    summary.sweptLanceDirs > 0 ? ` + ${summary.sweptLanceDirs} legacy lance dir(s)` : '';
  const freedMb = (summary.freedBytes / (1024 * 1024)).toFixed(1);
  log?.(`[Lien] auto-GC: removed ${indices}${lance}, freed ${freedMb} MB`);
}

/**
 * Run orphan GC + legacy lance sweep in the background on serve start — never
 * stale GC (that stays opt-in via the CLI). Safe to fire-and-forget:
 *
 *  - Machine-wide throttle: at most once per ~24h across ALL serves, via a
 *    stamp file plus an atomic exclusive-create lock in the lien home. Serves
 *    demonstrably pile up (multiple per root), so they must not stampede or
 *    double-delete — a peer already holding the lock simply no-ops here.
 *  - Opt-out: `LIEN_AUTO_GC=off` (env only, KISS).
 *  - Never throws — any failure resolves to `{ ran: false }`.
 *
 * Logs a single line only when something was collected; silent otherwise.
 */
export async function runAutoGc(options: AutoGcOptions = {}): Promise<AutoGcResult> {
  if (process.env.LIEN_AUTO_GC === 'off') {
    return { ran: false, reason: 'disabled' };
  }

  const lienDir = path.join(getLienHome(), '.lien');
  const stampPath = path.join(lienDir, GC_STAMP_FILE);
  const lockPath = path.join(lienDir, GC_LOCK_FILE);

  try {
    await fs.mkdir(lienDir, { recursive: true });

    // Throttle check (cheap, lock-free) before contending for the lock.
    if (await isThrottled(stampPath)) return { ran: false, reason: 'throttled' };

    const lock = await acquireLock(lockPath);
    if (!lock) return { ran: false, reason: 'locked' };

    const heartbeat = startLockHeartbeat(lockPath);
    try {
      // Re-check under the lock: a peer may have just finished.
      if (await isThrottled(stampPath)) return { ran: false, reason: 'throttled' };

      // Orphan + lance only. NEVER stale automatically.
      const { summary } = await runGc({ protectedDirs: options.protectedDirs, dryRun: false });
      await fs.writeFile(stampPath, Date.now().toString(), 'utf-8');
      logCollected(summary, options.log);
      return { ran: true, summary };
    } finally {
      clearInterval(heartbeat);
      await releaseLock(lock, lockPath);
    }
  } catch {
    // Auto-GC is best-effort and must never disrupt serve.
    return { ran: false, reason: 'locked' };
  }
}

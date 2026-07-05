import fs from 'fs/promises';
import path from 'path';
import { getLienHome } from '@liendev/parser';
import { readVersionFile } from '../vectordb/version.js';
import type { IndexManifest } from '../indexer/manifest.js';
import { readAccessStamp } from './access-stamp.js';
import { computeDirSize } from './dir-size.js';
import { probeIndexLock } from './live-handle.js';

const MANIFEST_FILE = 'manifest.json';

/** Legacy LanceDB chunk store, dead weight since the embeddings/LanceDB removal
 *  (#661). No code writes or reads it anymore — safe to sweep from surviving
 *  index dirs to reclaim disk. */
export const LEGACY_LANCE_DIRNAME = 'code_chunks.lance';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default staleness window for `lien gc --stale` when no value is given. */
export const DEFAULT_STALE_DAYS = 60;

/** Why an index dir is scheduled for removal. */
export type GcRemovalKind = 'orphan' | 'stale';

/** Why a surviving index dir was left in place. */
export type GcSkipReason =
  | 'current-project' // the cwd's own project — never deleted
  | 'in-use' // a live process holds its structural store open
  | 'unprobeable' // couldn't verify the store is free — fail closed, skip
  | 'volume-offline' // source root's backing volume is unavailable (not orphan)
  | 'unknown-provenance' // legacy index with no recorded source root
  | 'present'; // source root still exists on disk

/** An index directory scheduled for whole-directory removal. */
export interface GcRemoval {
  /** Absolute path of the index directory. */
  dir: string;
  /** repoId (directory basename under `indices/`). */
  repoId: string;
  kind: GcRemovalKind;
  /** Human-readable explanation for the report. */
  detail: string;
  /** Bytes that will be freed by removing this directory. */
  sizeBytes: number;
}

/** A legacy `code_chunks.lance` directory to sweep from a surviving index dir. */
export interface GcLanceSweep {
  /** Absolute path of the `code_chunks.lance` directory. */
  dir: string;
  /** repoId of the parent index directory. */
  repoId: string;
  sizeBytes: number;
}

/** A surviving index directory and why it was skipped. */
export interface GcSkip {
  dir: string;
  repoId: string;
  reason: GcSkipReason;
  detail: string;
}

/** The set of actions GC would take. Pure data — computed without deleting. */
export interface GcPlan {
  indicesRoot: string;
  removals: GcRemoval[];
  lanceSweeps: GcLanceSweep[];
  skipped: GcSkip[];
}

/** Outcome of executing (or previewing) a GC plan. */
export interface GcSummary {
  removedIndices: number;
  sweptLanceDirs: number;
  freedBytes: number;
  skipped: number;
  dryRun: boolean;
}

/** Plan + execution outcome. */
export interface GcResult {
  plan: GcPlan;
  summary: GcSummary;
}

export interface GcOptions {
  /**
   * Also remove indices not accessed within this many days. Opt-in — when
   * undefined, only orphaned indices are removed. Legacy "unknown provenance"
   * and present-root indices are removable ONLY via this option.
   */
  staleDays?: number;
  /** Index directories to never touch (absolute paths; e.g. the cwd's own). */
  protectedDirs?: string[];
  /** Preview only — executeGc deletes nothing when true. */
  dryRun?: boolean;
  /** Clock injection for deterministic tests. */
  now?: number;
}

/** The indices root Lien enumerates for GC: `<LIEN_HOME>/.lien/indices`. */
export function getIndicesRoot(): string {
  return path.join(getLienHome(), '.lien', 'indices');
}

/** List repoId directory names directly under the indices root. */
export async function enumerateIndexDirs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(getIndicesRoot(), { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

/**
 * Read an index dir's manifest.json directly (NOT via ManifestManager, whose
 * load() deletes the manifest on a format-version mismatch — GC must never
 * mutate the indices it inspects).
 */
async function readManifest(indexDir: string): Promise<Partial<IndexManifest> | null> {
  try {
    const raw = await fs.readFile(path.join(indexDir, MANIFEST_FILE), 'utf-8');
    return JSON.parse(raw) as Partial<IndexManifest>;
  } catch {
    return null;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Well-known removable-media mount-root prefixes, checked as POSIX ('/'-
 *  separated) paths regardless of the host OS's `path.sep` — a manifest's
 *  `sourceRoot` is a recorded string that may have been captured on a
 *  different OS than the one GC is currently running on (e.g. a macOS
 *  `/Volumes/...` path inspected from a Linux CI runner). */
const MOUNT_ROOT_PREFIXES = ['Volumes', 'media', 'mnt'] as const;

/**
 * Whether a missing source root sits on a currently-unavailable volume rather
 * than having been deleted — the pragmatic mitigation against the
 * unmounted-drive false positive.
 *
 * Two guards (documented design choice):
 *  1. Removable-media mount roots (macOS `/Volumes/<name>`, Linux
 *     `/media/<name>`, `/mnt/<name>`); if the source root is under one and
 *     that mount point is absent, the drive is unplugged.
 *  2. General: we only trust a "gone" verdict when the nearest EXISTING
 *     ancestor is a real directory. If the nearest existing ancestor is the
 *     filesystem root (an entire network/volume mount vanished), we decline.
 */
async function isSourceRootUnavailable(sourceRoot: string): Promise<boolean> {
  // Guard 1: removable-media mount-root check. Always split on '/' — the
  // recorded path's separator reflects where it was captured, not the host
  // GC is running on.
  const segments = sourceRoot.split('/');
  const mountRoot = segments[1];
  if (mountRoot && (MOUNT_ROOT_PREFIXES as readonly string[]).includes(mountRoot) && segments[2]) {
    const mountPoint = `/${mountRoot}/${segments[2]}`;
    if (!(await pathExists(mountPoint))) return true;
  }

  // Guard 2: nearest existing ancestor must be a real directory.
  const root = path.parse(sourceRoot).root;
  let dir = path.dirname(sourceRoot);
  while (dir !== root) {
    if (await pathExists(dir)) {
      return !(await isDirectory(dir)); // ancestor exists but isn't a dir → unsafe
    }
    dir = path.dirname(dir);
  }
  // Nearest existing ancestor is the filesystem root only → an entire mount is
  // missing; decline to treat as a confident orphan.
  return true;
}

type Provenance = 'orphan' | 'offline' | 'present' | 'unknown';

async function analyzeProvenance(sourceRoot: string | undefined): Promise<Provenance> {
  if (!sourceRoot) return 'unknown';
  if (await pathExists(sourceRoot)) return 'present';
  if (await isSourceRootUnavailable(sourceRoot)) return 'offline';
  return 'orphan';
}

/**
 * Resolve when an index was last used. Prefers the access stamp (written on
 * serve start); falls back to the newest of manifest.lastIndexed, the version
 * file, and the directory mtime so legacy indices without a stamp still have a
 * sensible staleness signal.
 */
async function resolveLastAccess(
  indexDir: string,
  manifest: Partial<IndexManifest> | null,
): Promise<number> {
  const stamp = await readAccessStamp(indexDir);
  if (stamp !== null) return stamp;

  const candidates: number[] = [];
  if (typeof manifest?.lastIndexed === 'number') candidates.push(manifest.lastIndexed);
  const version = await readVersionFile(indexDir);
  if (version > 0) candidates.push(version);
  try {
    candidates.push((await fs.stat(indexDir)).mtimeMs);
  } catch {
    // ignore
  }
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

type Classification =
  | { type: 'remove'; kind: GcRemovalKind; detail: string }
  | { type: 'skip'; reason: GcSkipReason; detail: string };

interface ClassifyContext {
  now: number;
  staleDays?: number;
  protectedSet: Set<string>;
}

/**
 * Decide the fate of a single index dir. Never deletes — pure decision.
 *
 * Precedence is deliberate and deletion-safety-first:
 *   current-project > volume-offline > live-handle-locked/unprobeable >
 *   orphan > stale (age-eligible, regardless of provenance) > skip-with-reason.
 *
 * volume-offline is checked before the lock probe because it is itself a skip
 * (never a removal), so nothing unsafe happens by not probing the lock first.
 * The lock probe then runs before orphan/stale so a live process always wins
 * over any removal reason, even an orphaned source root. Stale eligibility is
 * evaluated identically for 'present' and 'unknown' provenance — --stale must
 * be able to reclaim a legacy (unknown-provenance) index once it is actually
 * old enough, not just a present-root one; provenance only decides the *label*
 * when an index is left in place because it isn't old enough yet.
 */
async function classifyIndex(indexDir: string, ctx: ClassifyContext): Promise<Classification> {
  if (ctx.protectedSet.has(path.resolve(indexDir))) {
    return { type: 'skip', reason: 'current-project', detail: 'current project' };
  }

  const manifest = await readManifest(indexDir);
  const sourceRoot = manifest?.sourceRoot;
  const provenance = await analyzeProvenance(sourceRoot);

  if (provenance === 'offline') {
    return {
      type: 'skip',
      reason: 'volume-offline',
      detail: `source root on an unavailable volume: ${sourceRoot}`,
    };
  }

  const lockProbe = probeIndexLock(indexDir);
  if (lockProbe === 'locked') {
    return { type: 'skip', reason: 'in-use', detail: 'held open by a live process' };
  }
  if (lockProbe === 'unprobeable') {
    return {
      type: 'skip',
      reason: 'unprobeable',
      detail: 'could not verify the structural store is free — skipping to be safe',
    };
  }

  if (provenance === 'orphan') {
    return {
      type: 'remove',
      kind: 'orphan',
      detail: `source root no longer exists: ${sourceRoot}`,
    };
  }

  // 'present' or 'unknown' → age-eligible removal only via --stale.
  if (ctx.staleDays !== undefined) {
    const lastAccess = await resolveLastAccess(indexDir, manifest);
    const ageDays = Math.floor((ctx.now - lastAccess) / DAY_MS);
    if (ageDays > ctx.staleDays) {
      return { type: 'remove', kind: 'stale', detail: `not accessed in ${ageDays}d` };
    }
  }

  if (provenance === 'unknown') {
    return {
      type: 'skip',
      reason: 'unknown-provenance',
      detail: 'no recorded source root (legacy index)',
    };
  }
  return { type: 'skip', reason: 'present', detail: `source root exists: ${sourceRoot}` };
}

/**
 * Build the GC plan: classify every index dir into a removal or a skip, and
 * queue legacy lance sweeps on surviving dirs. Computes sizes only for the
 * things that free space (removals + lance dirs), keeping the scan cheap.
 */
export async function planGc(options: GcOptions = {}): Promise<GcPlan> {
  const now = options.now ?? Date.now();
  const protectedSet = new Set((options.protectedDirs ?? []).map(d => path.resolve(d)));
  const indicesRoot = getIndicesRoot();
  const names = await enumerateIndexDirs();

  const removals: GcRemoval[] = [];
  const lanceSweeps: GcLanceSweep[] = [];
  const skipped: GcSkip[] = [];

  for (const repoId of names) {
    const dir = path.join(indicesRoot, repoId);
    const decision = await classifyIndex(dir, { now, staleDays: options.staleDays, protectedSet });

    if (decision.type === 'remove') {
      removals.push({
        dir,
        repoId,
        kind: decision.kind,
        detail: decision.detail,
        sizeBytes: await computeDirSize(dir),
      });
      continue;
    }

    skipped.push({ dir, repoId, reason: decision.reason, detail: decision.detail });

    // Surviving dir: sweep a leftover legacy lance store if present.
    const lanceDir = path.join(dir, LEGACY_LANCE_DIRNAME);
    if (await isDirectory(lanceDir)) {
      lanceSweeps.push({ dir: lanceDir, repoId, sizeBytes: await computeDirSize(lanceDir) });
    }
  }

  return { indicesRoot, removals, lanceSweeps, skipped };
}

/**
 * Execute a plan (or preview it under dryRun). Deletions happen one directory
 * at a time with explicit absolute paths — never a glob — and a failed delete
 * is counted as not-freed rather than aborting the run.
 */
export async function executeGc(plan: GcPlan, options: GcOptions = {}): Promise<GcSummary> {
  const dryRun = options.dryRun ?? false;

  if (dryRun) {
    const freedBytes =
      sumSizes(plan.removals) + plan.lanceSweeps.reduce((n, s) => n + s.sizeBytes, 0);
    return {
      removedIndices: plan.removals.length,
      sweptLanceDirs: plan.lanceSweeps.length,
      freedBytes,
      skipped: plan.skipped.length,
      dryRun: true,
    };
  }

  let removedIndices = 0;
  let sweptLanceDirs = 0;
  let freedBytes = 0;

  for (const removal of plan.removals) {
    try {
      await fs.rm(removal.dir, { recursive: true, force: true });
      removedIndices++;
      freedBytes += removal.sizeBytes;
    } catch {
      // Leave it for the next run rather than aborting the whole GC.
    }
  }

  for (const sweep of plan.lanceSweeps) {
    try {
      await fs.rm(sweep.dir, { recursive: true, force: true });
      sweptLanceDirs++;
      freedBytes += sweep.sizeBytes;
    } catch {
      // best-effort
    }
  }

  return {
    removedIndices,
    sweptLanceDirs,
    freedBytes,
    skipped: plan.skipped.length,
    dryRun: false,
  };
}

function sumSizes(removals: GcRemoval[]): number {
  return removals.reduce((n, r) => n + r.sizeBytes, 0);
}

/** Convenience: plan then execute (respecting dryRun). */
export async function runGc(options: GcOptions = {}): Promise<GcResult> {
  const plan = await planGc(options);
  const summary = await executeGc(plan, options);
  return { plan, summary };
}

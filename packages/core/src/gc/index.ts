/**
 * Index garbage collection.
 *
 * `~/.lien/indices` accumulates one directory per project root ever opened and
 * nothing removes them. This module reclaims that space:
 *  - orphan GC: an index whose recorded source root no longer exists on disk,
 *  - legacy lance sweep: dead `code_chunks.lance` dirs left by the removed
 *    LanceDB backend (#661),
 *  - stale GC (opt-in): indices not accessed within N days.
 *
 * The `lien gc` CLI command and the throttled serve-start auto-GC both build on
 * the engine here. Post-embeddings a full reindex is seconds with zero
 * downloads, so reclaiming is nearly free — GC can be aggressive by design.
 */

export {
  planGc,
  executeGc,
  runGc,
  getIndicesRoot,
  enumerateIndexDirs,
  LEGACY_LANCE_DIRNAME,
  DEFAULT_STALE_DAYS,
} from './gc.js';
export type {
  GcOptions,
  GcPlan,
  GcResult,
  GcSummary,
  GcRemoval,
  GcRemovalKind,
  GcLanceSweep,
  GcSkip,
  GcSkipReason,
} from './gc.js';

export { runAutoGc, AUTO_GC_INTERVAL_MS, GC_STAMP_FILE, GC_LOCK_FILE } from './auto-gc.js';
export type { AutoGcOptions, AutoGcResult } from './auto-gc.js';

export { writeAccessStamp, readAccessStamp, ACCESS_STAMP_FILE } from './access-stamp.js';
export { probeIndexLock } from './live-handle.js';
export type { LockProbeResult } from './live-handle.js';
export { computeDirSize, formatBytes } from './dir-size.js';

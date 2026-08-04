/**
 * Core indexing module - programmatic API without CLI dependencies.
 *
 * This module provides the core indexing functionality that can be used by:
 * - @liendev/cli (with UI wrapper)
 * - @liendev/action (directly)
 * - @liendev/cloud (worker processes)
 * - Third-party integrations
 */

import fs from 'fs/promises';
import pLimit from 'p-limit';
import path from 'path';
import type { ProgressTracker } from './progress-tracker.js';
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CONCURRENCY,
  getParseStageConcurrency,
} from '../constants.js';
import { createVectorDB } from '../vectordb/factory.js';
import { writeVersionFile } from '../vectordb/version.js';
import { ManifestManager } from './manifest.js';
import { isGitAvailable, isGitRepo } from '../git/utils.js';
import { GitStateTracker } from '../git/tracker.js';
import { detectChanges } from './change-detector.js';
import type { ChangeDetectionResult } from './change-detector.js';
import { indexMultipleFiles, normalizeToRelativePath } from './incremental.js';
import { ChunkBatchProcessor } from './chunk-batch-processor.js';
import { buildOverlay } from './overlay-index.js';
import type { VectorDBInterface } from '../vectordb/types.js';
import type { OverlayBackend } from '../vectordb/overlay-backend.js';
import {
  scanCodebase,
  detectEcosystems,
  getEcosystemExcludePatterns,
  chunkFile,
  computeContentHash,
  DEFAULT_INDEX_INCLUDE_PATTERNS,
} from '@liendev/parser';

/**
 * Options for indexing a codebase
 */
export interface IndexingOptions {
  /** Root directory to index (defaults to cwd) */
  rootDir?: string;
  /** Show verbose output */
  verbose?: boolean;
  /** Force full reindex, skip incremental */
  force?: boolean;
  /** Progress callback for external UI */
  onProgress?: (progress: IndexingProgress) => void;
}

/**
 * Progress information during indexing
 */
export interface IndexingProgress {
  phase: 'initializing' | 'scanning' | 'indexing' | 'saving' | 'complete';
  message: string;
  filesTotal?: number;
  filesProcessed?: number;
  chunksProcessed?: number;
}

/**
 * Result of indexing operation
 */
export interface IndexingResult {
  success: boolean;
  filesIndexed: number;
  chunksCreated: number;
  durationMs: number;
  incremental: boolean;
  error?: string;
}

/** Extracted config values with defaults for indexing */
interface IndexingConfig {
  chunkSize: number;
  chunkOverlap: number;
  useAST: boolean;
  astFallback: 'line-based' | 'error';
}

/** Extract indexing config values using defaults */
function getIndexingConfig(_rootDir: string): IndexingConfig {
  // Use defaults for all settings - no config needed!
  return {
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    useAST: true, // Always use AST-based chunking
    astFallback: 'line-based' as const,
  };
}

/** Scan files by auto-detecting ecosystem presets */
export async function scanFilesToIndex(rootDir: string): Promise<string[]> {
  const ecosystems = await detectEcosystems(rootDir);
  const ecosystemExcludes = getEcosystemExcludePatterns(ecosystems);

  return scanCodebase({
    rootDir,
    includePatterns: DEFAULT_INDEX_INCLUDE_PATTERNS,
    excludePatterns: ecosystemExcludes,
  });
}

/**
 * Finalize the manifest after indexing: record provenance (the absolute source
 * root, so `lien gc` can detect orphaned indices) and, when in a git repo, the
 * current git state.
 */
async function finalizeManifest(
  rootDir: string,
  vectorDB: VectorDBInterface,
  manifest: ManifestManager,
): Promise<void> {
  // Provenance: always record the absolute root this index was built from,
  // regardless of git — orphan GC depends on it.
  await manifest.recordSourceRoot(path.resolve(rootDir));

  const gitAvailable = await isGitAvailable();
  const isRepo = await isGitRepo(rootDir);

  if (!gitAvailable || !isRepo) {
    return;
  }

  const gitTracker = new GitStateTracker(rootDir, vectorDB.dbPath);
  await gitTracker.initialize();
  const gitState = gitTracker.getState();

  if (gitState) {
    await manifest.updateGitState(gitState);
  }
}

/**
 * Complete the `dependent_counts` migration for a standalone store that has never
 * had its reverse-dependency counts computed (#1084).
 *
 * `refreshDependentCounts` runs at the end of a FULL index. That is not the path
 * a user upgrading from ≤ 0.75.2 actually takes: `lien index` finds no content
 * changes, reports "Index is up to date", and returns — so the note #1072 prints
 * ("Run `lien index` to populate them") was advice that provably did not work,
 * and only `--force` did. A caveat that tells the user how to fix it and is wrong
 * about how spends their trust on a failed instruction, which is worse than
 * saying nothing at all.
 *
 * So this is a MIGRATION-completion step, not an indexing step, and the
 * distinction is the whole design:
 *
 * - Gated on `hasDependentCounts()` — stored state, never "the table looks
 *   empty" — so it runs at most once per store, ever. The next `lien index`
 *   after an upgrade pays it; every one after that skips it on one meta lookup.
 * - #1071's freshness contract is untouched. Normal incremental editing still
 *   does NOT recompute whole-corpus counts (that would be absurd for a soft
 *   ranking tie-breaker: ~1.8 s per save on a 53k-chunk corpus), so counts still
 *   "lag by at most one full index run". This does not make them fresher, only
 *   PRESENT — the difference between a wrong answer and a stale one.
 *
 * The overlay path has its own equivalent —
 * `OverlayBackend.backfillDependentCounts` — because a worktree's counts must be
 * composed over `(base − masked) ∪ overlay` and only that backend can do it.
 * `performOverlayIndex` calls that instead of this.
 *
 * The version file is bumped only when a backfill actually ran, so a live
 * `lien serve` reconnects and picks the new counts up. Without that its cached
 * per-connection count map would stay empty while `hasDependentCounts()` started
 * answering true — clearing the note and then asserting corpus-wide zeros as
 * fact, which is #1072's defect restored.
 *
 * Deliberately NOT error-tolerant, unlike `OverlayBackend.backfillDependentCounts`
 * (review finding on this PR, and correct — the asymmetry it flagged was real, and
 * the swallow was the wrong half). `refreshDependentCounts` is the same call
 * `saveIndexResults` makes uncaught at the end of every full index, so a genuine
 * failure here must surface exactly as it already does there rather than leaving
 * `success: true` over a migration that did not happen. The overlay's busy-skip is
 * specific and earns itself: piled-up `lien serve` processes on one worktree are a
 * documented reality, and a peer holding the write lock is doing this very work on
 * our behalf. Neither is true of a standalone store, whose incremental path already
 * writes (and can already contend) on any run that indexes anything at all — and
 * this runs at most once per store, ever.
 */
async function backfillDependentCounts(
  vectorDB: VectorDBInterface,
  options: IndexingOptions,
): Promise<void> {
  if (await vectorDB.hasDependentCounts()) return;

  options.onProgress?.({
    phase: 'saving',
    message: 'Backfilling reverse-dependency counts (one-time)...',
  });
  await vectorDB.refreshDependentCounts();
  await writeVersionFile(vectorDB.dbPath);
}

/**
 * Handle file deletions during incremental indexing.
 */
async function handleDeletions(
  deletedFiles: string[],
  vectorDB: VectorDBInterface,
  manifest: ManifestManager,
): Promise<number> {
  if (deletedFiles.length === 0) {
    return 0;
  }

  const removedFiles: string[] = [];

  for (const filepath of deletedFiles) {
    try {
      await vectorDB.deleteByFile(filepath);
      removedFiles.push(filepath);
    } catch {
      // Continue on error, just count failures
    }
  }

  // Batch manifest removal: one read+write instead of one per file
  await manifest.removeFiles(removedFiles);

  return removedFiles.length;
}

/**
 * Handle file updates (additions and modifications) during incremental indexing.
 */
async function handleUpdates(
  addedFiles: string[],
  modifiedFiles: string[],
  vectorDB: VectorDBInterface,
  options: IndexingOptions,
  rootDir: string,
): Promise<number> {
  const filesToIndex = [...addedFiles, ...modifiedFiles];

  if (filesToIndex.length === 0) {
    return 0;
  }

  const count = await indexMultipleFiles(filesToIndex, vectorDB, {
    verbose: options.verbose,
    rootDir,
  });

  await writeVersionFile(vectorDB.dbPath);
  return count;
}

/** Result of checking whether incremental indexing is possible */
interface IncrementalChanges {
  changes: ChangeDetectionResult;
  manifest: ManifestManager;
}

/**
 * Check if incremental indexing is possible and detect what changed.
 * Returns null if a full index is needed.
 */
async function detectIncrementalChanges(
  rootDir: string,
  vectorDB: VectorDBInterface,
): Promise<IncrementalChanges | null> {
  const manifest = new ManifestManager(vectorDB.dbPath);
  const savedManifest = await manifest.load();

  if (!savedManifest) {
    return null;
  }

  const changes = await detectChanges(rootDir, vectorDB);

  if (changes.reason === 'full') {
    return null;
  }

  return { changes, manifest };
}

/**
 * Try incremental indexing if a manifest exists.
 * Returns result if incremental completed, null if full index needed.
 */
async function tryIncrementalIndex(
  rootDir: string,
  vectorDB: VectorDBInterface,
  options: IndexingOptions,
  startTime: number,
): Promise<IndexingResult | null> {
  const detected = await detectIncrementalChanges(rootDir, vectorDB);

  if (!detected) {
    return null;
  }

  // Before the change branches, not after each of them: this is a migration, and
  // a migration runs whether or not there is anything to index (#1084 — the
  // "no changes detected" exit below is the exact path that left the note stuck).
  // One call site covers all three exits, and it lands before any `complete`
  // progress event so the spinner isn't restarted after it has succeeded.
  // Ordering costs nothing real: counts computed here miss this run's own edits,
  // which is precisely the documented "lags by at most one full index run".
  await backfillDependentCounts(vectorDB, options);

  const { changes, manifest } = detected;
  const totalChanges = changes.added.length + changes.modified.length;
  const totalDeleted = changes.deleted.length;

  if (totalChanges === 0 && totalDeleted === 0) {
    options.onProgress?.({
      phase: 'complete',
      message: 'Index is up to date - no changes detected',
      filesTotal: 0,
      filesProcessed: 0,
    });
    return {
      success: true,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: true,
    };
  }

  // Fast path: deletions-only — no need to initialize embeddings
  if (totalChanges === 0 && totalDeleted > 0) {
    await handleDeletions(changes.deleted, vectorDB, manifest);
    await finalizeManifest(rootDir, vectorDB, manifest);

    options.onProgress?.({
      phase: 'complete',
      message: `Updated 0 files, removed ${totalDeleted}`,
      filesTotal: totalDeleted,
      filesProcessed: totalDeleted,
    });

    return {
      success: true,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: true,
    };
  }

  options.onProgress?.({
    phase: 'indexing',
    message: `Detected ${totalChanges} files to index, ${totalDeleted} to remove`,
  });

  await handleDeletions(changes.deleted, vectorDB, manifest);
  const indexedCount = await handleUpdates(
    changes.added,
    changes.modified,
    vectorDB,
    options,
    rootDir,
  );

  await finalizeManifest(rootDir, vectorDB, manifest);

  options.onProgress?.({
    phase: 'complete',
    message: `Updated ${indexedCount} file${indexedCount !== 1 ? 's' : ''}, removed ${totalDeleted}`,
    filesTotal: totalChanges + totalDeleted,
    filesProcessed: indexedCount + totalDeleted,
  });

  return {
    success: true,
    filesIndexed: indexedCount,
    chunksCreated: 0, // Not tracked in incremental mode
    durationMs: Date.now() - startTime,
    incremental: true,
  };
}

/**
 * Process a single file for indexing.
 * Extracts chunks and adds them to the batch processor.
 *
 * @returns true if file was processed successfully, false if skipped
 */
async function processFileForIndexing(
  file: string,
  rootDir: string,
  batchProcessor: ChunkBatchProcessor,
  indexConfig: IndexingConfig,
  progressTracker: { incrementFiles: () => void },
  _verbose: boolean,
): Promise<boolean> {
  try {
    // Resolve relative paths against rootDir for file I/O
    const absolutePath = path.isAbsolute(file) ? file : path.join(rootDir, file);
    // Normalize to relative path for consistent storage in the index
    const relativePath = normalizeToRelativePath(file, rootDir);
    // Get file stats to capture actual modification time
    const stats = await fs.stat(absolutePath);
    const content = await fs.readFile(absolutePath, 'utf-8');

    const chunks = chunkFile(relativePath, content, {
      chunkSize: indexConfig.chunkSize,
      chunkOverlap: indexConfig.chunkOverlap,
      useAST: indexConfig.useAST,
      astFallback: indexConfig.astFallback,
      workspaceRoot: rootDir,
    });

    if (chunks.length === 0) {
      progressTracker.incrementFiles();
      return false;
    }

    // Compute content hash for change detection
    const contentHash = await computeContentHash(absolutePath);

    // Add chunks to batch processor (handles mutex internally)
    await batchProcessor.addChunks(chunks, relativePath, stats.mtimeMs, contentHash);
    progressTracker.incrementFiles();

    return true;
  } catch (error) {
    console.error(
      `[indexer] Failed to process ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
    progressTracker.incrementFiles();
    return false;
  }
}

/**
 * Create progress tracker for full indexing
 */
function createProgressTracker(
  files: string[],
  onProgress?: (progress: IndexingProgress) => void,
): ProgressTracker {
  const processedCount = { value: 0 };

  return {
    incrementFiles: () => {
      processedCount.value++;
      onProgress?.({
        phase: 'indexing',
        message: `Processing files...`,
        filesTotal: files.length,
        filesProcessed: processedCount.value,
      });
    },
    incrementChunks: () => {},
    getProcessedCount: () => processedCount.value,
    start: () => {},
    stop: () => {},
  };
}

/**
 * Save indexing results to manifest and write version file
 */
async function saveIndexResults(
  batchProcessor: ChunkBatchProcessor,
  vectorDB: VectorDBInterface,
  rootDir: string,
): Promise<void> {
  const { indexedFiles } = batchProcessor.getResults();

  const manifest = new ManifestManager(vectorDB.dbPath);
  await manifest.updateFiles(
    indexedFiles.map(entry => ({
      filepath: entry.filepath,
      lastModified: entry.mtime,
      chunkCount: entry.chunkCount,
      contentHash: entry.contentHash,
    })),
  );

  // Save git state if in a git repo
  await finalizeManifest(rootDir, vectorDB, manifest);

  // #1071: precompute the per-file reverse-dependency counts that feed
  // search_code's structural ranking boost. Runs once here, at the end of a
  // full index, rather than on the query path (see
  // vectordb/sqlite/dependent-counts.ts for the cost measurements and the
  // "lags by at most one full index" freshness contract). Before the version
  // file is written, so a serve that reconnects on the bump never observes a
  // completed index with counts from the previous run.
  await vectorDB.refreshDependentCounts();

  // Write version file to mark successful completion
  await writeVersionFile(vectorDB.dbPath);
}

/**
 * Process all files through chunking and structural-store insertion.
 */
async function batchProcessFiles(
  files: string[],
  rootDir: string,
  vectorDB: VectorDBInterface,
  progressTracker: ProgressTracker,
  verbose: boolean,
): Promise<ChunkBatchProcessor> {
  const indexConfig = getIndexingConfig(rootDir);

  const bp = new ChunkBatchProcessor(vectorDB, { batchThreshold: 100 }, progressTracker);

  // CPU-bound parse stage (chunkFile below) — capped independent of
  // DEFAULT_CONCURRENCY; see getParseStageConcurrency's doc comment / ADR-013.
  const limit = pLimit(getParseStageConcurrency(DEFAULT_CONCURRENCY));
  await Promise.all(
    files.map(file =>
      limit(() => processFileForIndexing(file, rootDir, bp, indexConfig, progressTracker, verbose)),
    ),
  );

  await bp.flush();
  return bp;
}

/**
 * Build/refresh a worktree overlay instead of full-indexing the whole tree.
 *
 * buildOverlay is idempotent and cheap (hash every worktree file, chunk only
 * the files that diverge from the shared base), so it doubles as the refresh
 * path — no separate incremental branch is needed here. The watcher keeps the
 * overlay current within a serve session via `indexMultipleFiles`.
 */
async function performOverlayIndex(
  overlay: OverlayBackend,
  options: IndexingOptions,
  startTime: number,
): Promise<IndexingResult> {
  options.onProgress?.({
    phase: 'scanning',
    message: 'Diffing worktree against the shared base index...',
  });

  const res = await buildOverlay(overlay, { verbose: options.verbose });
  const filesIndexed = res.added + res.modified;

  // The worktree's half of #1084, and NOT `backfillDependentCounts` above: an
  // overlay composes its own counts (the base's table can't describe a diverged
  // corpus), so the migration lives on the backend that owns that composition.
  // `applyRebuild` only refreshes on a real swap and `buildOverlay` returns
  // before it when the signature already matches, so an overlay that has never
  // composed counts had no path to them — see the method's doc comment.
  if (overlay.backfillDependentCounts()) await overlay.bumpVersion();

  options.onProgress?.({
    phase: 'complete',
    message:
      `Overlay ready: ${res.added} added, ${res.modified} modified, ` +
      `${res.deleted} deleted, ${res.unchanged} shared with base`,
    filesTotal: filesIndexed,
    filesProcessed: filesIndexed,
  });

  return {
    success: true,
    filesIndexed,
    chunksCreated: 0,
    durationMs: Date.now() - startTime,
    incremental: false,
  };
}

/**
 * Perform full indexing of the codebase
 */
async function performFullIndex(
  rootDir: string,
  vectorDB: VectorDBInterface,
  options: IndexingOptions,
  startTime: number,
): Promise<IndexingResult> {
  // 1. Clear existing index
  options.onProgress?.({ phase: 'initializing', message: 'Clearing existing index...' });
  await vectorDB.clear();

  // 2. Scan for files
  options.onProgress?.({ phase: 'scanning', message: 'Scanning codebase...' });
  const files = await scanFilesToIndex(rootDir);

  if (files.length === 0) {
    return {
      success: false,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: false,
      error: 'No files found to index',
    };
  }

  const progressTracker = createProgressTracker(files, options.onProgress);

  try {
    // 3. Process files (chunk + persist)
    options.onProgress?.({
      phase: 'indexing',
      message: `Processing ${files.length} files...`,
      filesTotal: files.length,
      filesProcessed: 0,
    });

    const batchProcessor = await batchProcessFiles(
      files,
      rootDir,
      vectorDB,
      progressTracker,
      options.verbose ?? false,
    );

    // 4. Save results
    options.onProgress?.({ phase: 'saving', message: 'Saving index manifest...' });
    await saveIndexResults(batchProcessor, vectorDB, rootDir);

    const { processedChunks } = batchProcessor.getResults();
    options.onProgress?.({
      phase: 'complete',
      message: 'Indexing complete',
      filesTotal: files.length,
      filesProcessed: progressTracker.getProcessedCount(),
      chunksProcessed: processedChunks,
    });

    return {
      success: true,
      filesIndexed: progressTracker.getProcessedCount(),
      chunksCreated: processedChunks,
      durationMs: Date.now() - startTime,
      incremental: false,
    };
  } catch (error) {
    return {
      success: false,
      filesIndexed: progressTracker.getProcessedCount(),
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Index a codebase into the structural store.
 *
 * This is the main entry point for indexing. It:
 * - Tries incremental indexing first (if not forced)
 * - Falls back to full indexing if needed
 * - Provides progress callbacks for UI integration
 *
 * Indexing chunks each file and persists structural metadata to the SQLite
 * store; search is lexical FTS5. No embeddings are computed and nothing is
 * downloaded.
 *
 * @param options - Indexing options
 * @returns Indexing result with stats
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = await indexCodebase({ rootDir: '/path/to/project' });
 *
 * // With progress callback
 * const result = await indexCodebase({
 *   rootDir: '/path/to/project',
 *   onProgress: (p) => console.log(`${p.phase}: ${p.message}`)
 * });
 * ```
 */
export async function indexCodebase(options: IndexingOptions = {}): Promise<IndexingResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const startTime = Date.now();

  try {
    options.onProgress?.({ phase: 'initializing', message: 'Loading configuration...' });

    // Initialize the structural store (factory selects the backend from global config)
    options.onProgress?.({ phase: 'initializing', message: 'Initializing structural store...' });
    const vectorDB = await createVectorDB(rootDir);
    await vectorDB.initialize();

    // Worktree overlay mode: (re)build the small per-worktree overlay against
    // the shared base instead of full-indexing the whole tree.
    if (vectorDB.isOverlay) {
      return await performOverlayIndex(vectorDB as OverlayBackend, options, startTime);
    }

    // Try incremental indexing first (unless forced)
    if (!options.force) {
      const incrementalResult = await tryIncrementalIndex(rootDir, vectorDB, options, startTime);
      if (incrementalResult) {
        return incrementalResult;
      }
    }

    // Fall back to full index
    return await performFullIndex(rootDir, vectorDB, options, startTime);
  } catch (error) {
    return {
      success: false,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Re-export types for convenience
export type { FileIndexEntry } from './chunk-batch-processor.js';

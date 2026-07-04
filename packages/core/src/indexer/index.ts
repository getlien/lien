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
import type { LienConfig } from '../config/schema.js';
import type { ProgressTracker } from './progress-tracker.js';
import { DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP, DEFAULT_CONCURRENCY } from '../constants.js';
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
  extractRepoId,
  scanCodebase,
  detectEcosystems,
  getEcosystemExcludePatterns,
  chunkFile,
  computeContentHash,
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
  /** Pre-loaded config (skip loading from disk) */
  config?: LienConfig;
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
  concurrency: number;
  chunkSize: number;
  chunkOverlap: number;
  useAST: boolean;
  astFallback: 'line-based' | 'error';
  repoId?: string;
  orgId?: string;
}

/** Extract indexing config values using defaults */
function getIndexingConfig(rootDir: string): IndexingConfig {
  // Use defaults for all settings - no config needed!
  const repoId = extractRepoId(rootDir);

  // orgId is now handled in createVectorDB() via global config and git remote detection
  // No need to extract it here anymore

  return {
    concurrency: DEFAULT_CONCURRENCY,
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    useAST: true, // Always use AST-based chunking
    astFallback: 'line-based' as const,
    repoId,
    orgId: undefined, // Not needed here - handled in VectorDB factory
  };
}

/** Scan files by auto-detecting ecosystem presets */
export async function scanFilesToIndex(rootDir: string): Promise<string[]> {
  const ecosystems = await detectEcosystems(rootDir);
  const ecosystemExcludes = getEcosystemExcludePatterns(ecosystems);

  return scanCodebase({
    rootDir,
    includePatterns: [
      '**/*.{ts,tsx,js,jsx,mjs,cjs,vue,py,php,go,rs,java,kt,swift,rb,cs,liquid,scala,c,cpp,cc,cxx,h,hpp}',
      '**/*.md',
      '**/*.mdx',
      '**/*.markdown',
    ],
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
      repoId: indexConfig.repoId,
      orgId: indexConfig.orgId,
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

  const limit = pLimit(indexConfig.concurrency);
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

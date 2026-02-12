import fs from 'fs/promises';
import type { VectorDBInterface, EmbeddingService } from '@liendev/core';
import {
  indexMultipleFiles,
  indexSingleFile,
  ManifestManager,
  computeContentHash,
  normalizeToRelativePath,
  createGitignoreFilter,
} from '@liendev/core';
import type { FileChangeHandler, FileChangeEvent } from '../watcher/index.js';
import type { createReindexStateManager } from './reindex-state-manager.js';
import type { LogFn } from './types.js';

/**
 * Handle file deletion (remove from index and manifest)
 * Throws error on failure to allow batch operations to track partial failures.
 */
async function handleFileDeletion(
  filepath: string,
  vectorDB: VectorDBInterface,
  manifest: ManifestManager,
  log: LogFn,
): Promise<void> {
  log(`🗑️  File deleted: ${filepath}`);

  try {
    await vectorDB.deleteByFile(filepath);
    await manifest.removeFile(filepath);
    log(`✓ Removed ${filepath} from index`);
  } catch (error) {
    log(`Failed to remove ${filepath}: ${error}`, 'warning');
    throw error; // Propagate error to allow batch handler to track failures
  }
}

/**
 * Handle batch deletions, removing files from both the vector DB and manifest.
 */
async function handleBatchDeletions(
  deletedFiles: string[],
  vectorDB: VectorDBInterface,
  manifest: ManifestManager,
  log: LogFn,
): Promise<void> {
  const failures: string[] = [];

  for (const filepath of deletedFiles) {
    log(`🗑️  File deleted: ${filepath}`);
    try {
      await vectorDB.deleteByFile(filepath);
      await manifest.removeFile(filepath);
      log(`✓ Removed ${filepath} from index`);
    } catch (error) {
      log(`Failed to remove ${filepath}: ${error}`, 'warning');
      failures.push(filepath);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Failed to delete ${failures.length} file(s): ${failures.join(', ')}`);
  }
}

/**
 * Check if a changed file can skip reindexing based on content hash.
 * Returns true if the file should be skipped (content unchanged).
 */
async function canSkipReindex(
  filepath: string,
  rootDir: string,
  manifest: ManifestManager,
  log: LogFn,
): Promise<boolean> {
  const normalizedPath = normalizeToRelativePath(filepath, rootDir);

  const manifestData = await manifest.load();
  const existingEntry = manifestData?.files[normalizedPath];

  const { shouldReindex, newMtime } = await shouldReindexFile(filepath, existingEntry, log);

  if (!shouldReindex && newMtime !== undefined && existingEntry) {
    const skipped = await manifest.transaction(async data => {
      const entry = data.files[normalizedPath];
      if (entry) {
        entry.lastModified = newMtime;
        return true;
      }
      return false;
    });
    return !!skipped;
  }

  return false;
}

/**
 * Handle single file change (reindex one file).
 * Uses content hash to skip reindexing if file content hasn't actually changed.
 */
async function handleSingleFileChange(
  filepath: string,
  type: 'add' | 'change',
  rootDir: string,
  vectorDB: VectorDBInterface,
  embeddings: EmbeddingService,
  manifest: ManifestManager,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
): Promise<void> {
  const action = type === 'add' ? 'added' : 'changed';

  if (type === 'change') {
    try {
      if (await canSkipReindex(filepath, rootDir, manifest, log)) return;
    } catch (error) {
      log(`Content hash check failed, will reindex: ${error}`, 'warning');
    }
  }

  const startTime = Date.now();
  reindexStateManager.startReindex([filepath]);
  log(`📝 File ${action}: ${filepath}`);

  try {
    await indexSingleFile(filepath, vectorDB, embeddings, { verbose: false, rootDir });
    const duration = Date.now() - startTime;
    reindexStateManager.completeReindex(duration);
  } catch (error) {
    reindexStateManager.failReindex();
    log(`Failed to reindex ${filepath}: ${error}`, 'warning');
  }
}

/**
 * Check if a modified file's content has actually changed using hash comparison.
 * Returns true if file should be reindexed, false if content unchanged.
 */
async function shouldReindexFile(
  filepath: string,
  existingEntry: { contentHash?: string; lastModified: number } | undefined,
  log: LogFn,
): Promise<{ shouldReindex: boolean; newMtime?: number }> {
  // No existing entry or no hash - reindex to be safe
  if (!existingEntry?.contentHash) {
    return { shouldReindex: true };
  }

  // Compute current content hash
  const currentHash = await computeContentHash(filepath);

  if (currentHash && currentHash === existingEntry.contentHash) {
    // Content hasn't changed, just update lastModified
    log(`⏭️  File mtime changed but content unchanged: ${filepath}`, 'debug');
    try {
      const stats = await fs.stat(filepath);
      return { shouldReindex: false, newMtime: stats.mtimeMs };
    } catch {
      // If stat fails, reindex to be safe
      return { shouldReindex: true };
    }
  }

  // Content changed, needs reindexing
  return { shouldReindex: true };
}

interface FileCheckResult {
  filepath: string;
  normalizedPath: string;
  shouldReindex: boolean;
  newMtime?: number;
}

/**
 * Check each modified file against the manifest to determine if reindexing is needed.
 */
async function checkFilesAgainstManifest(
  files: string[],
  rootDir: string,
  manifestFiles: Record<string, { contentHash?: string; lastModified: number }>,
  log: LogFn,
): Promise<FileCheckResult[]> {
  const results: FileCheckResult[] = [];

  for (const filepath of files) {
    const normalizedPath = normalizeToRelativePath(filepath, rootDir);
    const existingEntry = manifestFiles[normalizedPath];
    const { shouldReindex, newMtime } = await shouldReindexFile(filepath, existingEntry, log);
    results.push({ filepath, normalizedPath, shouldReindex, newMtime });
  }

  return results;
}

/**
 * Batch-update manifest mtimes for files whose content hasn't changed.
 */
async function updateUnchangedMtimes(
  manifest: ManifestManager,
  results: FileCheckResult[],
): Promise<void> {
  const hasUpdates = results.some(r => !r.shouldReindex && r.newMtime !== undefined);
  if (!hasUpdates) return;

  await manifest.transaction(async data => {
    for (const result of results) {
      if (!result.shouldReindex && result.newMtime !== undefined) {
        const entry = data.files[result.normalizedPath];
        if (entry) {
          entry.lastModified = result.newMtime;
        }
      }
    }
    return null;
  });
}

/**
 * Filter modified files based on content hash, updating manifest for unchanged files.
 * Returns array of files that need reindexing.
 */
async function filterModifiedFilesByHash(
  modifiedFiles: string[],
  rootDir: string,
  manifest: ManifestManager,
  log: LogFn,
): Promise<string[]> {
  if (modifiedFiles.length === 0) return [];

  const manifestData = await manifest.load();
  if (!manifestData) return modifiedFiles;

  const checkResults = await checkFilesAgainstManifest(
    modifiedFiles,
    rootDir,
    manifestData.files,
    log,
  );
  await updateUnchangedMtimes(manifest, checkResults);

  return checkResults.filter(r => r.shouldReindex).map(r => r.filepath);
}

/**
 * Prepare files for reindexing by filtering based on content hash.
 * Returns files that need to be indexed and deleted files.
 */
async function prepareFilesForReindexing(
  event: FileChangeEvent,
  rootDir: string,
  manifest: ManifestManager,
  log: LogFn,
): Promise<{ filesToIndex: string[]; deletedFiles: string[] }> {
  const addedFiles = event.added || [];
  const modifiedFiles = event.modified || [];
  const deletedFiles = event.deleted || [];

  // Filter modified files by content hash, with error handling
  let modifiedFilesToReindex: string[] = [];
  try {
    modifiedFilesToReindex = await filterModifiedFilesByHash(modifiedFiles, rootDir, manifest, log);
  } catch (error) {
    // If hash-based filtering fails, fall back to reindexing all modified files
    log(`Hash-based filtering failed, will reindex all modified files: ${error}`, 'warning');
    modifiedFilesToReindex = modifiedFiles;
  }

  const filesToIndex = [...addedFiles, ...modifiedFilesToReindex];

  return { filesToIndex, deletedFiles };
}

/**
 * Execute reindex operations for files to index and deletions.
 * Processes both in parallel for efficiency.
 */
async function executeReindexOperations(
  filesToIndex: string[],
  deletedFiles: string[],
  rootDir: string,
  vectorDB: VectorDBInterface,
  embeddings: EmbeddingService,
  manifest: ManifestManager,
  log: LogFn,
): Promise<void> {
  const operations: Promise<unknown>[] = [];

  if (filesToIndex.length > 0) {
    log(`📁 ${filesToIndex.length} file(s) changed, reindexing...`);
    operations.push(
      indexMultipleFiles(filesToIndex, vectorDB, embeddings, { verbose: false, rootDir }),
    );
  }

  if (deletedFiles.length > 0) {
    operations.push(handleBatchDeletions(deletedFiles, vectorDB, manifest, log));
  }

  await Promise.all(operations);
}

/**
 * Handle batch file change event (additions, modifications, and deletions)
 * Uses content hash to skip reindexing files whose content hasn't actually changed.
 */
async function handleBatchEvent(
  event: FileChangeEvent,
  rootDir: string,
  vectorDB: VectorDBInterface,
  embeddings: EmbeddingService,
  manifest: ManifestManager,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
): Promise<void> {
  // Prepare files for reindexing
  const { filesToIndex, deletedFiles } = await prepareFilesForReindexing(
    event,
    rootDir,
    manifest,
    log,
  );
  const allFiles = [...filesToIndex, ...deletedFiles];

  if (allFiles.length === 0) {
    return; // Nothing to process
  }

  // Execute with state tracking
  const startTime = Date.now();
  reindexStateManager.startReindex(allFiles);

  try {
    await executeReindexOperations(
      filesToIndex,
      deletedFiles,
      rootDir,
      vectorDB,
      embeddings,
      manifest,
      log,
    );

    const duration = Date.now() - startTime;
    reindexStateManager.completeReindex(duration);
    log(
      `✓ Processed ${filesToIndex.length} file(s) + ${deletedFiles.length} deletion(s) in ${duration}ms`,
    );
  } catch (error) {
    reindexStateManager.failReindex();
    log(`Batch reindex failed: ${error}`, 'warning');
  }
}

/**
 * Handle single file deletion event
 */
async function handleUnlinkEvent(
  filepath: string,
  vectorDB: VectorDBInterface,
  manifest: ManifestManager,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
): Promise<void> {
  const startTime = Date.now();
  reindexStateManager.startReindex([filepath]);

  try {
    await handleFileDeletion(filepath, vectorDB, manifest, log);
    const duration = Date.now() - startTime;
    reindexStateManager.completeReindex(duration);
  } catch (error) {
    reindexStateManager.failReindex();
    log(`Failed to process deletion for ${filepath}: ${error}`, 'warning');
  }
}

/**
 * Check if a file should be excluded based on gitignore rules.
 */
export function isFileIgnored(
  filepath: string,
  rootDir: string,
  isIgnored: (relativePath: string) => boolean,
): boolean {
  return isIgnored(normalizeToRelativePath(filepath, rootDir));
}

/**
 * Filter a batch file change event, removing gitignored files from additions
 * and modifications. Deletions are never filtered — a previously-indexed file
 * that gets added to .gitignore and then deleted must still be removed from
 * the index to avoid stale entries.
 */
function filterFileChangeEvent(
  event: FileChangeEvent,
  ignoreFilter: (relativePath: string) => boolean,
  rootDir: string,
): FileChangeEvent {
  return {
    ...event,
    added: (event.added || []).filter(f => !isFileIgnored(f, rootDir, ignoreFilter)),
    modified: (event.modified || []).filter(f => !isFileIgnored(f, rootDir, ignoreFilter)),
    deleted: event.deleted || [],
  };
}

/** Check if a filepath is a .gitignore file (basename match, not suffix) */
export function isGitignoreFile(filepath: string): boolean {
  const name = filepath.split(/[/\\]/).pop() ?? filepath;
  return name === '.gitignore';
}

/** Check if an event includes a .gitignore file change */
function hasGitignoreChange(event: FileChangeEvent): boolean {
  if (event.type === 'batch') {
    const allFiles = [...(event.added || []), ...(event.modified || []), ...(event.deleted || [])];
    return allFiles.some(isGitignoreFile);
  }
  return event.filepath ? isGitignoreFile(event.filepath) : false;
}

/**
 * Create file change event handler.
 * Filters out gitignored files before processing to prevent
 * indexing files that should be excluded according to .gitignore.
 */
export function createFileChangeHandler(
  rootDir: string,
  vectorDB: VectorDBInterface,
  embeddings: EmbeddingService,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  checkAndReconnect: () => Promise<void>,
): FileChangeHandler {
  let ignoreFilter: ((relativePath: string) => boolean) | null = null;
  const manifest = new ManifestManager(vectorDB.dbPath);

  return async event => {
    // Invalidate filter when a .gitignore file changes so nested patterns take effect
    if (hasGitignoreChange(event)) {
      ignoreFilter = null;
    }

    // Lazy-init gitignore filter on first event (or after invalidation)
    if (!ignoreFilter) {
      ignoreFilter = await createGitignoreFilter(rootDir);
    }

    const { type } = event;

    if (type === 'batch') {
      const filtered = filterFileChangeEvent(event, ignoreFilter, rootDir);
      const totalToProcess =
        filtered.added!.length + filtered.modified!.length + filtered.deleted!.length;
      if (totalToProcess === 0) return;
      await checkAndReconnect();
      await handleBatchEvent(
        filtered,
        rootDir,
        vectorDB,
        embeddings,
        manifest,
        log,
        reindexStateManager,
      );
    } else if (type === 'unlink') {
      // Always process deletions — a previously-indexed file must be removed
      // from the index even if it's now gitignored
      await checkAndReconnect();
      await handleUnlinkEvent(event.filepath, vectorDB, manifest, log, reindexStateManager);
    } else {
      // Fallback for single file add/change (backwards compatibility)
      if (isFileIgnored(event.filepath, rootDir, ignoreFilter)) return;
      await checkAndReconnect();
      await handleSingleFileChange(
        event.filepath,
        type,
        rootDir,
        vectorDB,
        embeddings,
        manifest,
        log,
        reindexStateManager,
      );
    }
  };
}

/** @internal — exported for testing only */
export const _testing = { hasGitignoreChange, isGitignoreFile };

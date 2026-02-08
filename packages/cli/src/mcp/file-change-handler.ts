import { resolve } from 'path';
import fs from 'fs/promises';
import {
  indexMultipleFiles,
  indexSingleFile,
  ManifestManager,
  computeContentHash,
  normalizeToRelativePath,
  createGitignoreFilter,
  VectorDBInterface,
  LocalEmbeddings,
} from '@liendev/core';
import type { FileChangeHandler, FileChangeEvent } from '../watcher/index.js';
import { createReindexStateManager } from './reindex-state-manager.js';
import type { LogFn } from './types.js';

/**
 * Derive the project root directory from the vector database path.
 *
 * This centralizes the path structure assumption: dbPath is .lien/indices/<hash>
 * If the directory structure changes, only this function needs updating.
 *
 * @param dbPath - Path to the vector database (typically .lien/indices/<hash>)
 * @returns Absolute path to project root directory
 */
export function getRootDirFromDbPath(dbPath: string): string {
  // dbPath structure: <rootDir>/.lien/indices/<hash>
  // Therefore rootDir is 3 levels up from dbPath
  return resolve(dbPath, '../../..');
}

/**
 * Handle file deletion (remove from index and manifest)
 * Throws error on failure to allow batch operations to track partial failures.
 */
async function handleFileDeletion(
  filepath: string,
  vectorDB: VectorDBInterface,
  log: LogFn
): Promise<void> {
  log(`🗑️  File deleted: ${filepath}`);

  // Initialize manifest manager before any operations to ensure consistency
  const manifest = new ManifestManager(vectorDB.dbPath);

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
 * Handle single file change (reindex one file)
 * Uses content hash to skip reindexing if file content hasn't actually changed.
 * Uses atomic manifest operations to prevent race conditions.
 */
async function handleSingleFileChange(
  filepath: string,
  type: 'add' | 'change',
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  _verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
): Promise<void> {
  const action = type === 'add' ? 'added' : 'changed';

  // Derive rootDir from dbPath using helper function
  const rootDir = getRootDirFromDbPath(vectorDB.dbPath);

  // For 'change' events, check content hash to avoid unnecessary reindexing
  if (type === 'change') {
    const manifest = new ManifestManager(vectorDB.dbPath);
    const normalizedPath = normalizeToRelativePath(filepath, rootDir);

    try {
      // Step 1: Read existing entry without triggering a manifest write
      const manifestData = await manifest.load();
      const existingEntry = manifestData?.files[normalizedPath];

      // Step 2: Perform file I/O outside of any transaction to avoid holding the lock
      const { shouldReindex, newMtime } = await shouldReindexFile(filepath, existingEntry, log);

      // Step 3: If content hasn't changed, update mtime in a short transaction
      if (!shouldReindex && newMtime && existingEntry) {
        const skipReindex = await manifest.transaction(async (manifestData) => {
          const entry = manifestData.files[normalizedPath];
          if (entry) {
            entry.lastModified = newMtime;
            return true; // Skip reindex
          }
          return false; // No entry to update, proceed with reindex
        });

        if (skipReindex) {
          return;
        }
      }
    } catch (error) {
      // If transaction fails, log warning and proceed with reindex
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
  log: LogFn
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

/**
 * Filter modified files based on content hash, updating manifest for unchanged files.
 * Returns array of files that need reindexing.
 * Uses atomic manifest operations to prevent race conditions.
 */
async function filterModifiedFilesByHash(
  modifiedFiles: string[],
  vectorDB: VectorDBInterface,
  log: LogFn
): Promise<string[]> {
  if (modifiedFiles.length === 0) {
    return [];
  }

  const manifest = new ManifestManager(vectorDB.dbPath);

  // Derive rootDir from dbPath using helper function
  const rootDir = getRootDirFromDbPath(vectorDB.dbPath);

  // Step 1: Read manifest entries without triggering a write
  const manifestData = await manifest.load();

  if (!manifestData) {
    // No manifest - all files need reindexing
    return modifiedFiles;
  }

  // Step 2: Check all files outside of any transaction (file I/O here)
  interface FileCheckResult {
    filepath: string;
    normalizedPath: string;
    shouldReindex: boolean;
    newMtime?: number;
  }

  const checkResults: FileCheckResult[] = [];

  for (const filepath of modifiedFiles) {
    const normalizedPath = normalizeToRelativePath(filepath, rootDir);
    const existingEntry = manifestData.files[normalizedPath];
    const { shouldReindex, newMtime } = await shouldReindexFile(filepath, existingEntry, log);

    checkResults.push({
      filepath,
      normalizedPath,
      shouldReindex,
      newMtime,
    });
  }

  // Step 3: Update all mtimes in a single short transaction (skip if nothing to update)
  const hasMtimeUpdates = checkResults.some(r => !r.shouldReindex && r.newMtime);
  if (hasMtimeUpdates) {
    await manifest.transaction(async (data) => {
      for (const result of checkResults) {
        if (!result.shouldReindex && result.newMtime) {
          const entry = data.files[result.normalizedPath];
          if (entry) {
            entry.lastModified = result.newMtime;
          }
        }
      }
      return null;
    });
  }

  // Return only files that need reindexing
  return checkResults.filter(r => r.shouldReindex).map(r => r.filepath);
}

/**
 * Prepare files for reindexing by filtering based on content hash.
 * Returns files that need to be indexed and deleted files.
 */
async function prepareFilesForReindexing(
  event: FileChangeEvent,
  vectorDB: VectorDBInterface,
  log: LogFn
): Promise<{ filesToIndex: string[]; deletedFiles: string[] }> {
  const addedFiles = event.added || [];
  const modifiedFiles = event.modified || [];
  const deletedFiles = event.deleted || [];

  // Filter modified files by content hash, with error handling
  let modifiedFilesToReindex: string[] = [];
  try {
    modifiedFilesToReindex = await filterModifiedFilesByHash(modifiedFiles, vectorDB, log);
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
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  log: LogFn
): Promise<void> {
  const operations: Promise<unknown>[] = [];

  if (filesToIndex.length > 0) {
    log(`📁 ${filesToIndex.length} file(s) changed, reindexing...`);
    operations.push(indexMultipleFiles(filesToIndex, vectorDB, embeddings, { verbose: false }));
  }

  if (deletedFiles.length > 0) {
    operations.push(
      Promise.all(
        deletedFiles.map((deleted: string) => handleFileDeletion(deleted, vectorDB, log))
      )
    );
  }

  await Promise.all(operations);
}

/**
 * Handle batch file change event (additions, modifications, and deletions)
 * Uses content hash to skip reindexing files whose content hasn't actually changed.
 */
async function handleBatchEvent(
  event: FileChangeEvent,
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  _verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
): Promise<void> {
  // Prepare files for reindexing
  const { filesToIndex, deletedFiles } = await prepareFilesForReindexing(event, vectorDB, log);
  const allFiles = [...filesToIndex, ...deletedFiles];

  if (allFiles.length === 0) {
    return; // Nothing to process
  }

  // Execute with state tracking
  const startTime = Date.now();
  reindexStateManager.startReindex(allFiles);

  try {
    await executeReindexOperations(filesToIndex, deletedFiles, vectorDB, embeddings, log);

    const duration = Date.now() - startTime;
    reindexStateManager.completeReindex(duration);
    log(`✓ Processed ${filesToIndex.length} file(s) + ${deletedFiles.length} deletion(s) in ${duration}ms`);
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
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
): Promise<void> {
  const startTime = Date.now();
  reindexStateManager.startReindex([filepath]);

  try {
    await handleFileDeletion(filepath, vectorDB, log);
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
  isIgnored: (relativePath: string) => boolean
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
  rootDir: string
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
  const name = filepath.split('/').pop() ?? filepath.split('\\').pop() ?? filepath;
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
  embeddings: LocalEmbeddings,
  verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
): FileChangeHandler {
  let ignoreFilter: ((relativePath: string) => boolean) | null = null;

  return async (event) => {
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
      const totalToProcess = (filtered.added!.length + filtered.modified!.length + filtered.deleted!.length);
      if (totalToProcess === 0) return;
      await handleBatchEvent(filtered, vectorDB, embeddings, verbose, log, reindexStateManager);
    } else if (type === 'unlink') {
      // Always process deletions — a previously-indexed file must be removed
      // from the index even if it's now gitignored
      await handleUnlinkEvent(event.filepath, vectorDB, log, reindexStateManager);
    } else {
      // Fallback for single file add/change (backwards compatibility)
      if (isFileIgnored(event.filepath, rootDir, ignoreFilter)) return;
      await handleSingleFileChange(event.filepath, type, vectorDB, embeddings, verbose, log, reindexStateManager);
    }
  };
}

/** @internal — exported for testing only */
export const _testing = { hasGitignoreChange, isGitignoreFile };

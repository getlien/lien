import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import fs from 'fs/promises';
import {
  LocalEmbeddings,
  GitStateTracker,
  indexMultipleFiles,
  indexSingleFile,
  ManifestManager,
  isGitAvailable,
  isGitRepo,
  VERSION_CHECK_INTERVAL_MS,
  DEFAULT_GIT_POLL_INTERVAL_MS,
  createVectorDB,
  VectorDBInterface,
  computeContentHash,
  normalizeToRelativePath,
  createGitignoreFilter,
} from '@liendev/core';
import { FileWatcher, type FileChangeHandler, type FileChangeEvent } from '../watcher/index.js';
import { createMCPServerConfig, registerMCPHandlers } from './server-config.js';
import { createReindexStateManager } from './reindex-state-manager.js';
import type { ToolContext, LogFn, LogLevel } from './types.js';

// Get version from package.json dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

let packageJson: { name: string; version: string };
try {
  packageJson = require(join(__dirname, '../package.json'));
} catch {
  packageJson = require(join(__dirname, '../../package.json'));
}

export interface MCPServerOptions {
  rootDir: string;
  verbose?: boolean;
  watch?: boolean;
}

/**
 * Derive the project root directory from the vector database path.
 * 
 * This centralizes the path structure assumption: dbPath is .lien/indices/<hash>
 * If the directory structure changes, only this function needs updating.
 * 
 * @param dbPath - Path to the vector database (typically .lien/indices/<hash>)
 * @returns Absolute path to project root directory
 */
function getRootDirFromDbPath(dbPath: string): string {
  // dbPath structure: <rootDir>/.lien/indices/<hash>
  // Therefore rootDir is 3 levels up from dbPath
  return resolve(dbPath, '../../..');
}

/**
 * Initialize embeddings and vector database.
 * Uses factory to select backend (LanceDB or Qdrant) based on config.
 */
async function initializeDatabase(
  rootDir: string,
  log: LogFn
): Promise<{ embeddings: LocalEmbeddings; vectorDB: VectorDBInterface }> {
  const embeddings = new LocalEmbeddings();
  
  // Create vector DB using global config (auto-detects backend and orgId)
  log('Creating vector database...');
  const vectorDB = await createVectorDB(rootDir);
  
  // Verify we got a valid instance
  if (!vectorDB) {
    throw new Error('createVectorDB returned undefined or null');
  }
  
  if (typeof vectorDB.initialize !== 'function') {
    throw new Error(`Invalid vectorDB instance: ${vectorDB.constructor?.name || 'unknown'}. Expected VectorDBInterface but got: ${JSON.stringify(Object.keys(vectorDB))}`);
  }

  log('Loading embedding model...');
  await embeddings.initialize();

  log('Loading vector database...');
  await vectorDB.initialize();

  log('Embeddings and vector DB ready');
  return { embeddings, vectorDB };
}

/**
 * Run auto-indexing if needed (first run with no index).
 * Always enabled by default - no config needed.
 */
async function handleAutoIndexing(
  vectorDB: VectorDBInterface,
  rootDir: string,
  log: LogFn
): Promise<void> {
  const hasIndex = await vectorDB.hasData();

  if (!hasIndex) {
    log('📦 No index found - running initial indexing...');
    log('⏱️  This may take 5-20 minutes depending on project size');

    try {
      const { indexCodebase } = await import('@liendev/core');
      await indexCodebase({ rootDir, verbose: true });
      log('✅ Initial indexing complete!');
    } catch (error) {
      log(`⚠️  Initial indexing failed: ${error}`, 'warning');
      log('You can manually run: lien index', 'warning');
    }
  }
}

/**
 * Handle git changes detected on startup.
 * Filters out gitignored files before indexing.
 *
 * **Error Handling:** Calls failReindex() before re-throwing to ensure proper cleanup.
 * Caller should catch and log but NOT call failReindex() again (already handled here).
 */
async function handleGitStartup(
  rootDir: string,
  gitTracker: GitStateTracker,
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  _verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  checkAndReconnect: () => Promise<void>
): Promise<void> {
  log('Checking for git changes...');
  const changedFiles = await gitTracker.initialize();

  if (changedFiles && changedFiles.length > 0) {
    const isIgnored = await createGitignoreFilter(rootDir);
    const filteredFiles = await filterGitChangedFiles(changedFiles, rootDir, isIgnored);

    if (filteredFiles.length === 0) {
      log('✓ Index is up to date with git state');
      return;
    }

    const startTime = Date.now();
    reindexStateManager.startReindex(filteredFiles);
    log(`🌿 Git changes detected: ${filteredFiles.length} files changed`);

    try {
      await checkAndReconnect();
      const count = await indexMultipleFiles(filteredFiles, vectorDB, embeddings, { verbose: false });
      const duration = Date.now() - startTime;
      reindexStateManager.completeReindex(duration);
      log(`✓ Reindexed ${count} files in ${duration}ms`);
    } catch (error) {
      reindexStateManager.failReindex();
      throw error;
    }
  } else {
    log('✓ Index is up to date with git state');
  }
}

/**
 * Create background polling interval for git changes.
 * Uses reindexStateManager to track and prevent concurrent operations.
 * Filters out gitignored files before indexing.
 *
 * **Error Handling:** Background poll errors are caught and logged as warnings (non-fatal).
 * This differs from handleGitStartup() which re-throws (fatal). Background failures
 * should not crash the server - just log and continue polling.
 */
function createGitPollInterval(
  rootDir: string,
  gitTracker: GitStateTracker,
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  _verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  checkAndReconnect: () => Promise<void>
): NodeJS.Timeout {
  let isIgnored: ((relativePath: string) => boolean) | null = null;

  return setInterval(async () => {
    try {
      const changedFiles = await gitTracker.detectChanges();
      if (changedFiles && changedFiles.length > 0) {
        // Check if a reindex is already in progress (file watch or previous git poll)
        const currentState = reindexStateManager.getState();
        if (currentState.inProgress) {
          log(
            `Background reindex already in progress (${currentState.pendingFiles.length} files pending), skipping git poll cycle`,
            'debug'
          );
          return;
        }

        // Invalidate filter when .gitignore files change
        if (changedFiles.some(isGitignoreFile)) {
          isIgnored = null;
        }

        // Lazy-init gitignore filter
        if (!isIgnored) {
          isIgnored = await createGitignoreFilter(rootDir);
        }

        const filteredFiles = await filterGitChangedFiles(changedFiles, rootDir, isIgnored!);
        if (filteredFiles.length === 0) return;

        const startTime = Date.now();
        reindexStateManager.startReindex(filteredFiles);
        log(`🌿 Git change detected: ${filteredFiles.length} files changed`);

        try {
          await checkAndReconnect();
          const count = await indexMultipleFiles(filteredFiles, vectorDB, embeddings, { verbose: false });
          const duration = Date.now() - startTime;
          reindexStateManager.completeReindex(duration);
          log(`✓ Background reindex complete: ${count} files in ${duration}ms`);
        } catch (error) {
          reindexStateManager.failReindex();
          log(`Git background reindex failed: ${error}`, 'warning');
        }
      }
    } catch (error) {
      log(`Git detection check failed: ${error}`, 'warning');
    }
  }, DEFAULT_GIT_POLL_INTERVAL_MS);
}

/**
 * Create a git change handler for event-driven detection.
 * Handles cooldown and concurrent operation prevention.
 * Filters out gitignored files before indexing.
 */
function createGitChangeHandler(
  rootDir: string,
  gitTracker: GitStateTracker,
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  _verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  checkAndReconnect: () => Promise<void>
): () => Promise<void> {
  let isIgnored: ((relativePath: string) => boolean) | null = null;
  let gitReindexInProgress = false;
  let lastGitReindexTime = 0;
  const GIT_REINDEX_COOLDOWN_MS = 5000; // 5 second cooldown

  return async () => {
    // Prevent concurrent git reindex operations (check both local and global state)
    const { inProgress: globalInProgress } = reindexStateManager.getState();
    if (gitReindexInProgress || globalInProgress) {
      log('Git reindex already in progress, skipping', 'debug');
      return;
    }

    // Cooldown check - don't reindex again too soon
    const timeSinceLastReindex = Date.now() - lastGitReindexTime;
    if (timeSinceLastReindex < GIT_REINDEX_COOLDOWN_MS) {
      log(`Git change ignored (cooldown: ${GIT_REINDEX_COOLDOWN_MS - timeSinceLastReindex}ms remaining)`, 'debug');
      return;
    }

    log('🌿 Git change detected (event-driven)');
    const changedFiles = await gitTracker.detectChanges();

    if (!changedFiles || changedFiles.length === 0) {
      return;
    }

    // Invalidate filter when .gitignore files change
    if (changedFiles.some(isGitignoreFile)) {
      isIgnored = null;
    }

    // Lazy-init gitignore filter
    if (!isIgnored) {
      isIgnored = await createGitignoreFilter(rootDir);
    }

    const filteredFiles = await filterGitChangedFiles(changedFiles, rootDir, isIgnored!);
    if (filteredFiles.length === 0) {
      return;
    }

    gitReindexInProgress = true;
    const startTime = Date.now();
    reindexStateManager.startReindex(filteredFiles);
    log(`Reindexing ${filteredFiles.length} files from git change`);

    try {
      await checkAndReconnect();
      const count = await indexMultipleFiles(filteredFiles, vectorDB, embeddings, { verbose: false });
      const duration = Date.now() - startTime;
      reindexStateManager.completeReindex(duration);
      log(`✓ Reindexed ${count} files in ${duration}ms`);
      lastGitReindexTime = Date.now();
    } catch (error) {
      reindexStateManager.failReindex();
      log(`Git reindex failed: ${error}`, 'warning');
    } finally {
      gitReindexInProgress = false;
    }
  };
}

/**
 * Setup git detection for the MCP server.
 * Uses event-driven detection if file watcher available, otherwise falls back to polling.
 */
async function setupGitDetection(
  rootDir: string,
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  fileWatcher: FileWatcher | null,
  checkAndReconnect: () => Promise<void>
): Promise<{ gitTracker: GitStateTracker | null; gitPollInterval: NodeJS.Timeout | null }> {
  const gitAvailable = await isGitAvailable();
  const isRepo = await isGitRepo(rootDir);

  if (!gitAvailable) {
    log('Git not available - git detection disabled');
    return { gitTracker: null, gitPollInterval: null };
  }
  if (!isRepo) {
    log('Not a git repository - git detection disabled');
    return { gitTracker: null, gitPollInterval: null };
  }

  log('✓ Detected git repository');
  const gitTracker = new GitStateTracker(rootDir, vectorDB.dbPath);

  // Check for git changes on startup
  try {
    await handleGitStartup(rootDir, gitTracker, vectorDB, embeddings, verbose, log, reindexStateManager, checkAndReconnect);
  } catch (error) {
    // handleGitStartup already calls failReindex() before re-throwing, no need to call again
    log(`Failed to check git state on startup: ${error}`, 'warning');
  }

  // If file watcher is available, use event-driven detection
  if (fileWatcher) {
    const gitChangeHandler = createGitChangeHandler(
      rootDir,
      gitTracker,
      vectorDB,
      embeddings,
      verbose,
      log,
      reindexStateManager,
      checkAndReconnect
    );
    fileWatcher.watchGit(gitChangeHandler);
    
    log('✓ Git detection enabled (event-driven via file watcher)');
    return { gitTracker, gitPollInterval: null };
  }
  
  // Fallback to polling if no file watcher (--no-watch mode)
  const pollIntervalSeconds = DEFAULT_GIT_POLL_INTERVAL_MS / 1000;
  log(`✓ Git detection enabled (polling fallback every ${pollIntervalSeconds}s)`);
  const gitPollInterval = createGitPollInterval(rootDir, gitTracker, vectorDB, embeddings, verbose, log, reindexStateManager, checkAndReconnect);
  return { gitTracker, gitPollInterval };
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
      // Step 1: Read existing entry in a fast transaction (no file I/O)
      const existingEntry = await manifest.transaction(async (manifestData) => {
        return manifestData.files[normalizedPath];
      });
      
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
      const fs = await import('fs/promises');
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
  
  // Step 1: Read manifest entries in a fast transaction (no file I/O)
  const manifestData = await manifest.transaction(async (data) => data);
  
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
  
  // Step 3: Update all mtimes in a single short transaction
  await manifest.transaction(async (data) => {
    for (const result of checkResults) {
      if (!result.shouldReindex && result.newMtime) {
        const entry = data.files[result.normalizedPath];
        if (entry) {
          entry.lastModified = result.newMtime;
        }
      }
    }
    return null; // No return value needed, manifest is mutated in place
  });
  
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
function isFileIgnored(
  filepath: string,
  rootDir: string,
  isIgnored: (relativePath: string) => boolean
): boolean {
  return isIgnored(normalizeToRelativePath(filepath, rootDir));
}

/**
 * Filter a flat list of changed files by gitignore, but preserve files that
 * no longer exist on disk (deletions). Git handlers return a flat list without
 * distinguishing adds from deletes — filtering deleted files would leave stale
 * entries in the index.
 */
async function filterGitChangedFiles(
  changedFiles: string[],
  rootDir: string,
  ignoreFilter: (relativePath: string) => boolean
): Promise<string[]> {
  const results: string[] = [];

  for (const filepath of changedFiles) {
    if (!isFileIgnored(filepath, rootDir, ignoreFilter)) {
      results.push(filepath);
      continue;
    }
    // Keep ignored files that no longer exist — they need cleanup from the index.
    // Only treat ENOENT as non-existence; other errors (e.g. EACCES) mean the
    // file exists but is unreadable and should stay filtered.
    try {
      await fs.access(filepath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        results.push(filepath);
      }
    }
  }

  return results;
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
function isGitignoreFile(filepath: string): boolean {
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
function createFileChangeHandler(
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

/**
 * Setup file watching for real-time updates.
 * Enabled by default (or via --watch flag).
 */
async function setupFileWatching(
  watch: boolean | undefined,
  rootDir: string,
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
): Promise<FileWatcher | null> {
  // Enable by default, or use --watch flag
  const fileWatchingEnabled = watch !== undefined ? watch : true;
  if (!fileWatchingEnabled) {
    return null;
  }

  log('👀 Starting file watcher...');
  const fileWatcher = new FileWatcher(rootDir);

  try {
    const handler = createFileChangeHandler(rootDir, vectorDB, embeddings, verbose, log, reindexStateManager);
    await fileWatcher.start(handler);
    log(`✓ File watching enabled (watching ${fileWatcher.getWatchedFiles().length} files)`);
    return fileWatcher;
  } catch (error) {
    log(`Failed to start file watcher: ${error}`, 'warning');
    return null;
  }
}

/**
 * Setup transport for MCP server.
 */
function setupTransport(log: LogFn): StdioServerTransport {
  const transport = new StdioServerTransport();
  
  transport.onclose = () => { 
    log('Transport closed'); 
  };
  transport.onerror = (error) => {
    log(`Transport error: ${error}`);
  };
  
  return transport;
}

/**
 * Setup cleanup handlers for graceful shutdown.
 */
function setupCleanupHandlers(
  versionCheckInterval: NodeJS.Timeout,
  gitPollInterval: NodeJS.Timeout | null,
  fileWatcher: FileWatcher | null,
  log: LogFn
): () => Promise<void> {
  return async () => {
    log('Shutting down MCP server...');
    clearInterval(versionCheckInterval);
    if (gitPollInterval) clearInterval(gitPollInterval);
    if (fileWatcher) await fileWatcher.stop();
    process.exit(0);
  };
}

/**
 * Version checking result with index metadata getter
 */
interface VersionCheckingResult {
  interval: NodeJS.Timeout;
  checkAndReconnect: () => Promise<void>;
  getIndexMetadata: () => {
    indexVersion: number;
    indexDate: string;
    reindexInProgress?: boolean;
    pendingFileCount?: number;
    lastReindexDurationMs?: number | null;
    msSinceLastReindex?: number | null;
  };
}

/**
 * Setup version checking and reconnection logic.
 */
function setupVersionChecking(
  vectorDB: VectorDBInterface,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
): VersionCheckingResult {
  const checkAndReconnect = async () => {
    try {
      if (await vectorDB.checkVersion()) {
        log('Index version changed, reconnecting...');
        await vectorDB.reconnect();
      }
    } catch (error) {
      log(`Version check failed: ${error}`, 'warning');
    }
  };

  const getIndexMetadata = () => {
    const reindex = reindexStateManager.getState();
    return {
      indexVersion: vectorDB.getCurrentVersion(),
      indexDate: vectorDB.getVersionDate(),
      reindexInProgress: reindex.inProgress,
      pendingFileCount: reindex.pendingFiles.length,
      lastReindexDurationMs: reindex.lastReindexDurationMs,
      // Note: msSinceLastReindex is computed at call time, not cached.
      // This ensures AI assistants always get current freshness info.
      msSinceLastReindex: reindex.lastReindexTimestamp 
        ? Date.now() - reindex.lastReindexTimestamp 
        : null,
    };
  };

  const interval = setInterval(checkAndReconnect, VERSION_CHECK_INTERVAL_MS);

  return { interval, checkAndReconnect, getIndexMetadata };
}

/**
 * Create early log function before server is ready (falls back to stderr).
 */
function createEarlyLog(verbose: boolean | undefined): LogFn {
  return (message, level = 'info') => {
    if (verbose || level === 'warning' || level === 'error') {
      console.error(`[Lien MCP] [${level}] ${message}`);
    }
  };
}

/**
 * Create MCP log function that uses server logging notifications.
 * - In verbose mode: all levels (debug, info, notice, warning, error)
 * - In non-verbose mode: only warnings and errors
 */
function createMCPLog(server: Server, verbose: boolean | undefined): LogFn {
  return (message, level: LogLevel = 'info') => {
    if (verbose || level === 'warning' || level === 'error') {
      server.sendLoggingMessage({
        level,
        logger: 'lien',
        data: message,
      }).catch(() => {
        // Fallback to stderr if MCP notification fails (e.g., not connected yet)
        console.error(`[Lien MCP] [${level}] ${message}`);
      });
    }
  };
}

/**
 * Initialize core components (embeddings and vector database) with error handling.
 */
async function initializeComponents(
  rootDir: string,
  earlyLog: LogFn
): Promise<{ embeddings: LocalEmbeddings; vectorDB: VectorDBInterface }> {
  try {
    const result = await initializeDatabase(rootDir, earlyLog);
    
    // Verify vectorDB has required methods
    if (!result.vectorDB || typeof result.vectorDB.initialize !== 'function') {
      throw new Error(`Invalid vectorDB instance: ${result.vectorDB?.constructor?.name || 'undefined'}. Missing initialize method.`);
    }
    
    return result;
  } catch (error) {
    console.error(`Failed to initialize: ${error}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Create and configure MCP server instance.
 */
function createMCPServer(): Server {
  const serverConfig = createMCPServerConfig('lien', packageJson.version);
  return new Server(
    { name: serverConfig.name, version: serverConfig.version },
    { capabilities: serverConfig.capabilities }
  );
}

/**
 * Setup server features and connect transport.
 */
async function setupAndConnectServer(
  server: Server,
  toolContext: ToolContext,
  log: LogFn,
  versionCheckInterval: NodeJS.Timeout,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  options: { rootDir: string; verbose: boolean | undefined; watch: boolean | undefined }
): Promise<void> {
  const { rootDir, verbose, watch } = options;
  const { vectorDB, embeddings } = toolContext;

  // Register all MCP handlers
  registerMCPHandlers(server, toolContext, log);
  
  // Setup features
  await handleAutoIndexing(vectorDB, rootDir, log);
  
  // Setup file watching first (needed for event-driven git detection)
  const fileWatcher = await setupFileWatching(watch, rootDir, vectorDB, embeddings, verbose, log, reindexStateManager);
  
  // Setup git detection (will use event-driven approach if fileWatcher is available)
  const { gitPollInterval } = await setupGitDetection(rootDir, vectorDB, embeddings, verbose, log, reindexStateManager, fileWatcher, toolContext.checkAndReconnect);

  // Setup cleanup handlers
  const cleanup = setupCleanupHandlers(versionCheckInterval, gitPollInterval, fileWatcher, log);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Setup and connect transport
  const transport = setupTransport(log);
  transport.onclose = () => {
    cleanup().catch(() => process.exit(0));
  };

  try {
    await server.connect(transport);
    log('MCP server started and listening on stdio');
  } catch (error) {
    console.error(`Failed to connect MCP transport: ${error}`);
    process.exit(1);
  }
}

export async function startMCPServer(options: MCPServerOptions): Promise<void> {
  const { rootDir, verbose, watch } = options;
  
  const earlyLog = createEarlyLog(verbose);
  earlyLog('Initializing MCP server...');

  const { embeddings, vectorDB } = await initializeComponents(rootDir, earlyLog);
  const server = createMCPServer();
  const log = createMCPLog(server, verbose);

  // Create reindex state manager
  const reindexStateManager = createReindexStateManager();

  const { interval: versionCheckInterval, checkAndReconnect, getIndexMetadata } = setupVersionChecking(vectorDB, log, reindexStateManager);
  const toolContext: ToolContext = { 
    vectorDB, 
    embeddings, 
    rootDir, 
    log, 
    checkAndReconnect, 
    getIndexMetadata,
    getReindexState: () => reindexStateManager.getState(),
  };

  await setupAndConnectServer(server, toolContext, log, versionCheckInterval, reindexStateManager, { rootDir, verbose, watch });
}

/** @internal — exported for testing only */
export const _testing = { handleGitStartup, createGitPollInterval, createGitChangeHandler, isGitignoreFile, hasGitignoreChange };

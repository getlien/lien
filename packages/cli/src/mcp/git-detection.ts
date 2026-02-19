import fs from 'fs/promises';
import type { VectorDBInterface, EmbeddingService } from '@liendev/core';
import {
  GitStateTracker,
  indexMultipleFiles,
  isGitAvailable,
  isGitRepo,
  DEFAULT_GIT_POLL_INTERVAL_MS,
} from '@liendev/core';
import { createGitignoreFilter } from '@liendev/parser';
import type { FileWatcher } from '../watcher/index.js';
import type { createReindexStateManager } from './reindex-state-manager.js';
import type { LogFn } from './types.js';
import { isFileIgnored, isGitignoreFile } from './file-change-handler.js';

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
  embeddings: EmbeddingService,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  checkAndReconnect: () => Promise<void>,
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
      const count = await indexMultipleFiles(filteredFiles, vectorDB, embeddings, {
        verbose: false,
      });
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
  embeddings: EmbeddingService,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  checkAndReconnect: () => Promise<void>,
): NodeJS.Timeout {
  let isIgnored: ((relativePath: string) => boolean) | null = null;
  let pollInProgress = false;

  return setInterval(async () => {
    if (pollInProgress) return;
    pollInProgress = true;
    try {
      const changedFiles = await gitTracker.detectChanges();
      if (changedFiles && changedFiles.length > 0) {
        // Check if a reindex is already in progress (file watch or previous git poll)
        const currentState = reindexStateManager.getState();
        if (currentState.inProgress) {
          log(
            `Background reindex already in progress (${currentState.pendingFiles.length} files pending), skipping git poll cycle`,
            'debug',
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
          const count = await indexMultipleFiles(filteredFiles, vectorDB, embeddings, {
            verbose: false,
          });
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
    } finally {
      pollInProgress = false;
    }
  }, DEFAULT_GIT_POLL_INTERVAL_MS);
}

/** Check if a git reindex should be skipped due to concurrency or cooldown */
function shouldSkipGitReindex(
  gitReindexInProgress: boolean,
  lastGitReindexTime: number,
  cooldownMs: number,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  log: LogFn,
): boolean {
  const { inProgress: globalInProgress } = reindexStateManager.getState();
  if (gitReindexInProgress || globalInProgress) {
    log('Git reindex already in progress, skipping', 'debug');
    return true;
  }
  const timeSinceLastReindex = Date.now() - lastGitReindexTime;
  if (timeSinceLastReindex < cooldownMs) {
    log(`Git change ignored (cooldown: ${cooldownMs - timeSinceLastReindex}ms remaining)`, 'debug');
    return true;
  }
  return false;
}

/**
 * Detect and filter git changes, refreshing gitignore filter as needed.
 * Returns filtered files ready for reindexing, or null if nothing to do.
 */
async function detectAndFilterGitChanges(
  gitTracker: GitStateTracker,
  rootDir: string,
  getIgnoreFilter: () => ((relativePath: string) => boolean) | null,
  setIgnoreFilter: (f: ((relativePath: string) => boolean) | null) => void,
  log: LogFn,
): Promise<string[] | null> {
  log('🌿 Git change detected (event-driven)');
  const changedFiles = await gitTracker.detectChanges();

  if (!changedFiles || changedFiles.length === 0) return null;

  if (changedFiles.some(isGitignoreFile)) {
    setIgnoreFilter(null);
  }

  let filter = getIgnoreFilter();
  if (!filter) {
    filter = await createGitignoreFilter(rootDir);
    setIgnoreFilter(filter);
  }

  const filteredFiles = await filterGitChangedFiles(changedFiles, rootDir, filter);
  return filteredFiles.length > 0 ? filteredFiles : null;
}

/**
 * Execute git reindex with state tracking.
 */
async function executeGitReindex(
  filteredFiles: string[],
  vectorDB: VectorDBInterface,
  embeddings: EmbeddingService,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  checkAndReconnect: () => Promise<void>,
  log: LogFn,
): Promise<void> {
  const startTime = Date.now();
  reindexStateManager.startReindex(filteredFiles);
  log(`Reindexing ${filteredFiles.length} files from git change`);

  try {
    await checkAndReconnect();
    const count = await indexMultipleFiles(filteredFiles, vectorDB, embeddings, { verbose: false });
    const duration = Date.now() - startTime;
    reindexStateManager.completeReindex(duration);
    log(`✓ Reindexed ${count} files in ${duration}ms`);
  } catch (error) {
    reindexStateManager.failReindex();
    log(`Git reindex failed: ${error}`, 'warning');
    throw error;
  }
}

/**
 * Create a git change handler for event-driven detection.
 * Handles cooldown and concurrent operation prevention.
 */
function createGitChangeHandler(
  rootDir: string,
  gitTracker: GitStateTracker,
  vectorDB: VectorDBInterface,
  embeddings: EmbeddingService,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  checkAndReconnect: () => Promise<void>,
): () => Promise<void> {
  let isIgnored: ((relativePath: string) => boolean) | null = null;
  let gitReindexInProgress = false;
  let lastGitReindexTime = 0;
  const GIT_REINDEX_COOLDOWN_MS = 5000; // 5 second cooldown

  return async () => {
    if (
      shouldSkipGitReindex(
        gitReindexInProgress,
        lastGitReindexTime,
        GIT_REINDEX_COOLDOWN_MS,
        reindexStateManager,
        log,
      )
    ) {
      return;
    }

    gitReindexInProgress = true;
    try {
      const filteredFiles = await detectAndFilterGitChanges(
        gitTracker,
        rootDir,
        () => isIgnored,
        f => {
          isIgnored = f;
        },
        log,
      );

      if (!filteredFiles) return;

      await executeGitReindex(
        filteredFiles,
        vectorDB,
        embeddings,
        reindexStateManager,
        checkAndReconnect,
        log,
      );
      lastGitReindexTime = Date.now();
    } catch (error) {
      log(`Git change handler failed: ${error}`, 'warning');
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
  embeddings: EmbeddingService,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  fileWatcher: FileWatcher | null,
  checkAndReconnect: () => Promise<void>,
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
    await handleGitStartup(
      rootDir,
      gitTracker,
      vectorDB,
      embeddings,
      log,
      reindexStateManager,
      checkAndReconnect,
    );
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
      log,
      reindexStateManager,
      checkAndReconnect,
    );
    fileWatcher.watchGit(gitChangeHandler);

    log('✓ Git detection enabled (event-driven via file watcher)');
    return { gitTracker, gitPollInterval: null };
  }

  // Fallback to polling if no file watcher (--no-watch mode)
  const pollIntervalSeconds = DEFAULT_GIT_POLL_INTERVAL_MS / 1000;
  log(`✓ Git detection enabled (polling fallback every ${pollIntervalSeconds}s)`);
  const gitPollInterval = createGitPollInterval(
    rootDir,
    gitTracker,
    vectorDB,
    embeddings,
    log,
    reindexStateManager,
    checkAndReconnect,
  );
  return { gitTracker, gitPollInterval };
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
  ignoreFilter: (relativePath: string) => boolean,
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

export { setupGitDetection };

/** @internal — exported for testing only */
export const _testing = { handleGitStartup, createGitPollInterval, createGitChangeHandler };

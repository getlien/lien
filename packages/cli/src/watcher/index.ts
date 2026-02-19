import chokidar from 'chokidar';
import path from 'path';
import {
  detectEcosystems,
  getEcosystemExcludePatterns,
  ALWAYS_IGNORE_PATTERNS,
} from '@liendev/lien-parser';

/**
 * File change event emitted by the watcher.
 *
 * For individual events (add/change/unlink), use the `filepath` field.
 * For batch events, use the array fields (added/modified/deleted).
 *
 * @property type - Event type: 'add', 'change', 'unlink', or 'batch'
 * @property filepath - Single file path. For batch events, this contains the first
 *                      file from the batch **for backwards compatibility only**.
 *
 *                      **IMPORTANT**: Batch events should use the array fields (added/modified/deleted).
 *                      This field exists only to maintain backwards compatibility with existing
 *                      consumers that expect a filepath field. New code should NOT rely on this field
 *                      for batch events and should migrate to using the array fields.
 *
 *                      If the guard fails (all arrays empty), an internal error is logged and the
 *                      handler is not called.
 * @property added - Array of added files (batch events only, empty array for non-batch)
 * @property modified - Array of modified files (batch events only, empty array for non-batch)
 * @property deleted - Array of deleted files (batch events only, empty array for non-batch)
 */
export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'batch';
  filepath: string;
  // Batch fields - only present for 'batch' type events
  added?: string[];
  modified?: string[];
  deleted?: string[];
}

export type FileChangeHandler = (event: FileChangeEvent) => void | Promise<void>;

/**
 * File watcher service that monitors code files for changes.
 * Uses chokidar for robust file watching with debouncing support.
 */
interface WatchPatterns {
  include: string[];
  exclude: string[];
}

export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private rootDir: string;
  private onChangeHandler: FileChangeHandler | null = null;

  // Batch state for aggregating rapid changes
  private pendingChanges: Map<string, 'add' | 'change' | 'unlink'> = new Map();
  private batchTimer: NodeJS.Timeout | null = null;
  private batchInProgress = false; // Track if handler is currently processing a batch
  private readonly BATCH_WINDOW_MS = 500; // Collect changes for 500ms before processing
  private readonly MAX_BATCH_WAIT_MS = 5000; // Force flush after 5s even if changes keep coming
  private firstChangeTimestamp: number | null = null; // Track when batch started

  // Git watching state
  private gitWatcher: chokidar.FSWatcher | null = null;
  private gitChangeTimer: NodeJS.Timeout | null = null;
  private gitChangeHandler: (() => void | Promise<void>) | null = null;
  private readonly GIT_DEBOUNCE_MS = 1000; // Git operations touch multiple files

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /**
   * Detect watch patterns from ecosystem presets or use defaults.
   */
  private async getWatchPatterns(): Promise<WatchPatterns> {
    try {
      const ecosystems = await detectEcosystems(this.rootDir);
      const ecosystemExcludes = getEcosystemExcludePatterns(ecosystems);
      const mergedExcludes = [...new Set([...ALWAYS_IGNORE_PATTERNS, ...ecosystemExcludes])];
      return { include: ['**/*'], exclude: mergedExcludes };
    } catch {
      return this.getDefaultPatterns();
    }
  }

  /**
   * Get default watch patterns.
   */
  private getDefaultPatterns(): WatchPatterns {
    return {
      include: ['**/*'],
      exclude: [...ALWAYS_IGNORE_PATTERNS],
    };
  }

  /**
   * Create chokidar watcher configuration.
   */
  private createWatcherConfig(patterns: WatchPatterns): chokidar.WatchOptions {
    return {
      cwd: this.rootDir,
      ignored: patterns.exclude,
      persistent: true,
      ignoreInitial: true, // Don't trigger for existing files

      // Handle atomic saves from modern editors (VS Code, Sublime, etc.)
      // Editors write to temp file then rename - without this, we get unlink+add instead of change
      atomic: true,

      awaitWriteFinish: {
        stabilityThreshold: 300, // Reduced from 500ms for faster detection
        pollInterval: 100,
      },

      // Performance optimizations
      usePolling: false,
      interval: 100,
      binaryInterval: 300,
    };
  }

  /**
   * Register event handlers on the watcher.
   */
  private registerEventHandlers(): void {
    if (!this.watcher) {
      return;
    }

    this.watcher
      .on('add', filepath => this.handleChange('add', filepath))
      .on('change', filepath => this.handleChange('change', filepath))
      .on('unlink', filepath => this.handleChange('unlink', filepath))
      .on('error', error => {
        // Log watcher errors to stderr to avoid interfering with MCP JSON-RPC protocol on stdout
        try {
          const message =
            '[FileWatcher] Error: ' +
            (error instanceof Error ? error.stack || error.message : String(error)) +
            '\n';
          process.stderr.write(message);
        } catch {
          // Swallow logging failures to avoid crashing
        }
      });
  }

  /**
   * Wait for watcher to be ready with timeout fallback.
   */
  private async waitForReady(): Promise<void> {
    if (!this.watcher) {
      return;
    }

    // Wait for ready event with timeout fallback
    // Reduced timeout from 5s to 1s to avoid test timeouts
    let readyFired = false;
    await Promise.race([
      new Promise<void>(resolve => {
        const readyHandler = () => {
          readyFired = true;
          resolve();
        };
        this.watcher!.once('ready', readyHandler);
      }),
      new Promise<void>(resolve => {
        // Shorter timeout (1s) to avoid test timeouts while still having fallback
        setTimeout(() => {
          if (!readyFired) {
            resolve();
          }
        }, 1000);
      }),
    ]);
  }

  /**
   * Starts watching files for changes.
   *
   * @param handler - Callback function called when files change
   */
  async start(handler: FileChangeHandler): Promise<void> {
    if (this.watcher) {
      throw new Error('File watcher is already running');
    }

    this.onChangeHandler = handler;

    // Get watch patterns (from frameworks or defaults)
    const patterns = await this.getWatchPatterns();

    // Create and start watcher
    this.watcher = chokidar.watch(patterns.include, this.createWatcherConfig(patterns));

    // Register event handlers (must be before waitForReady to catch ready event)
    this.registerEventHandlers();

    // Wait for watcher to be ready
    await this.waitForReady();
  }

  /**
   * Enable watching .git directory for git operations.
   * Call this after start() to enable event-driven git detection.
   *
   * @param onGitChange - Callback invoked when git operations detected
   */
  watchGit(onGitChange: () => void | Promise<void>): void {
    if (!this.watcher) {
      throw new Error('Cannot watch git - watcher not started');
    }

    // Close existing git watcher if watchGit() is called again
    if (this.gitWatcher) {
      void this.gitWatcher.close().catch(() => {});
      this.gitWatcher = null;
    }

    this.gitChangeHandler = onGitChange;

    // Use a separate watcher for .git paths so they aren't blocked by
    // ALWAYS_IGNORE_PATTERNS (.git/** is ignored on the main watcher).
    // Normalize to POSIX separators so glob patterns work on Windows.
    const gitPaths = [
      'HEAD',
      'index',
      'refs/**',
      'MERGE_HEAD',
      'REBASE_HEAD',
      'CHERRY_PICK_HEAD',
      'logs/refs/stash',
    ].map(p => path.join(this.rootDir, '.git', p).replace(/\\/g, '/'));

    this.gitWatcher = chokidar.watch(gitPaths, {
      persistent: true,
      ignoreInitial: true,
    });

    this.gitWatcher
      .on('add', () => this.handleGitChange())
      .on('change', () => this.handleGitChange())
      .on('unlink', () => this.handleGitChange())
      .on('error', error => {
        try {
          const message =
            '[FileWatcher] Git watcher error: ' +
            (error instanceof Error ? error.stack || error.message : String(error)) +
            '\n';
          process.stderr.write(message);
        } catch {
          // Swallow logging failures
        }
      });
  }

  /**
   * Check if a filepath is a git-related change
   */
  private isGitChange(filepath: string): boolean {
    // Normalize path separators for cross-platform
    const normalized = filepath.replace(/\\/g, '/');
    // Match .git as a path segment to avoid false positives (e.g. widgets.git/)
    return normalized.startsWith('.git/') || normalized.includes('/.git/');
  }

  /**
   * Handle git-related file changes with debouncing
   */
  private handleGitChange(): void {
    // Ignore events arriving during/after shutdown
    if (!this.gitChangeHandler) {
      return;
    }

    // Debounce git changes (commits touch multiple .git files)
    if (this.gitChangeTimer) {
      clearTimeout(this.gitChangeTimer);
    }

    this.gitChangeTimer = setTimeout(async () => {
      try {
        await this.gitChangeHandler?.();
      } catch {
        // Error handled by git change handler, silent here to avoid MCP protocol interference
      }
      this.gitChangeTimer = null;
    }, this.GIT_DEBOUNCE_MS);
  }

  /**
   * Handles a file change event with smart batching.
   * Collects rapid changes across multiple files and processes them together.
   * Forces flush after MAX_BATCH_WAIT_MS even if changes keep arriving.
   *
   * If a batch is currently being processed by an async handler, waits for completion
   * before starting a new batch to prevent race conditions.
   */
  private handleChange(type: 'add' | 'change' | 'unlink', filepath: string): void {
    // Never treat .git changes as regular file changes — git events
    // are handled by the separate gitWatcher via watchGit()
    if (this.isGitChange(filepath)) {
      return;
    }

    // Prevent queuing events during shutdown (handler is null after stop())
    if (!this.onChangeHandler) {
      return;
    }

    // Track when the batch started
    if (this.pendingChanges.size === 0) {
      this.firstChangeTimestamp = Date.now();
    }

    // Add to pending batch (later events overwrite earlier for same file)
    this.pendingChanges.set(filepath, type);

    // Check if we've been batching for too long
    const now = Date.now();
    const elapsed = now - this.firstChangeTimestamp!;

    if (elapsed >= this.MAX_BATCH_WAIT_MS) {
      // Force flush - we've been batching for too long
      // Clear timer first to prevent race with timer callback
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }
      this.flushBatch();
      return;
    }

    // Reset/start batch timer (only if not currently processing)
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // If batch is in progress, don't start timer - let it finish first
    // Changes will accumulate and be flushed after current batch completes
    if (!this.batchInProgress) {
      this.batchTimer = setTimeout(() => {
        this.flushBatch();
      }, this.BATCH_WINDOW_MS);
    }
  }

  /**
   * Group pending changes by type and convert to absolute paths.
   * Returns arrays of added, modified, and deleted files.
   */
  private groupPendingChanges(changes: Map<string, 'add' | 'change' | 'unlink'>): {
    added: string[];
    modified: string[];
    deleted: string[];
  } {
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const [filepath, type] of changes) {
      // Use path.join for proper cross-platform path handling
      const absolutePath = path.isAbsolute(filepath) ? filepath : path.join(this.rootDir, filepath);

      switch (type) {
        case 'add':
          added.push(absolutePath);
          break;
        case 'change':
          modified.push(absolutePath);
          break;
        case 'unlink':
          deleted.push(absolutePath);
          break;
      }
    }

    return { added, modified, deleted };
  }

  /**
   * Handle completion of async batch handler.
   * Triggers flush of accumulated changes if any.
   */
  private handleBatchComplete(): void {
    this.batchInProgress = false;
    // If changes accumulated during processing, flush them now
    if (this.pendingChanges.size > 0 && !this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.flushBatch();
      }, this.BATCH_WINDOW_MS);
    }
  }

  /**
   * Dispatch batch event to handler and track async state.
   * Caller must ensure at least one of added/modified/deleted is non-empty.
   */
  private dispatchBatch(added: string[], modified: string[], deleted: string[]): void {
    if (!this.onChangeHandler) return;

    // SAFETY: Caller guarantees at least one array is non-empty (empty batch guard before this call)
    const allFiles = [...added, ...modified];
    const firstFile = allFiles.length > 0 ? allFiles[0] : deleted[0];
    if (!firstFile) {
      // Internal error: dispatchBatch called with all empty arrays
      // Silent to avoid MCP protocol interference
      return;
    }

    try {
      this.batchInProgress = true;
      const result = this.onChangeHandler({
        type: 'batch',
        filepath: firstFile,
        added,
        modified,
        deleted,
      });

      // Handle async handlers and track completion
      if (result instanceof Promise) {
        result
          .catch(() => {
            // Error handling batch change - logged by MCP server handler
            // Silent here to avoid MCP protocol interference
          })
          .finally(() => this.handleBatchComplete());
      } else {
        // Sync handler - mark as complete and check for accumulated changes
        this.handleBatchComplete();
      }
    } catch {
      // Error handling batch change - logged by MCP server handler
      // Silent here to avoid MCP protocol interference
      // handleBatchComplete() will reset batchInProgress and check for accumulated changes
      this.handleBatchComplete();
    }
  }

  /**
   * Flush pending changes and dispatch batch event.
   * Tracks async handler state to prevent race conditions.
   */
  private flushBatch(): void {
    // Clear timer first to prevent race condition between timer and stop()
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.pendingChanges.size === 0) return;

    const changes = new Map(this.pendingChanges);
    this.pendingChanges.clear();
    this.firstChangeTimestamp = null; // Reset batch start time

    // Group by change type
    const { added, modified, deleted } = this.groupPendingChanges(changes);

    // Skip empty batches
    if (added.length === 0 && modified.length === 0 && deleted.length === 0) {
      return;
    }

    this.dispatchBatch(added, modified, deleted);
  }

  /**
   * Flush final batch during shutdown.
   * Handles edge case where watcher is stopped while batch is pending.
   */
  private async flushFinalBatch(handler: FileChangeHandler): Promise<void> {
    if (this.pendingChanges.size === 0) return;

    const changes = new Map(this.pendingChanges);
    this.pendingChanges.clear();

    const { added, modified, deleted } = this.groupPendingChanges(changes);

    // Only flush if we have actual files to process
    if (added.length === 0 && modified.length === 0 && deleted.length === 0) {
      return;
    }

    try {
      const allFiles = [...added, ...modified];
      const firstFile = allFiles.length > 0 ? allFiles[0] : deleted[0];

      // Defensive check - should never happen given the guard above
      if (!firstFile) {
        // Internal error: no files in final batch (logged to stderr only in non-MCP context)
        return;
      }

      await handler({
        type: 'batch',
        filepath: firstFile,
        added,
        modified,
        deleted,
      });
    } catch {
      // Error flushing final batch during shutdown (silent to avoid MCP protocol interference)
      // The handler itself logs errors appropriately
    }
  }

  /**
   * Stops the file watcher and cleans up resources.
   */
  async stop(): Promise<void> {
    if (!this.watcher) {
      return;
    }

    // Close git watcher first to stop events before clearing handlers
    if (this.gitWatcher) {
      try {
        await this.gitWatcher.close();
      } catch {
        // Ignore close errors — continue cleanup
      }
      this.gitWatcher = null;
    }

    // Prevent new changes from being queued during shutdown
    const handler = this.onChangeHandler;
    this.onChangeHandler = null;
    this.gitChangeHandler = null;

    // Clear git timer
    if (this.gitChangeTimer) {
      clearTimeout(this.gitChangeTimer);
      this.gitChangeTimer = null;
    }

    // Wait for any in-progress batch to complete before flushing final changes
    // This prevents race conditions where handleBatchComplete() tries to start a new timer
    while (this.batchInProgress) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Clear any pending batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Flush any pending changes before stopping
    if (handler && this.pendingChanges.size > 0) {
      await this.flushFinalBatch(handler);
    }

    // Close main watcher
    await this.watcher.close();
    this.watcher = null;
  }

  /**
   * Gets the list of files currently being watched.
   */
  getWatchedFiles(): string[] {
    if (!this.watcher) {
      return [];
    }

    const watched = this.watcher.getWatched();
    const files: string[] = [];

    for (const [dir, filenames] of Object.entries(watched)) {
      for (const filename of filenames) {
        files.push(`${dir}/${filename}`);
      }
    }

    return files;
  }

  /**
   * Checks if the watcher is currently running.
   */
  isRunning(): boolean {
    return this.watcher !== null;
  }
}

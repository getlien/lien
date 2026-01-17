import chokidar from 'chokidar';
import path from 'path';
import { detectAllFrameworks, getFrameworkDetector } from '@liendev/core';
import type { FrameworkConfig } from '@liendev/core';

/**
 * File change event emitted by the watcher.
 * 
 * For individual events (add/change/unlink), use the `filepath` field.
 * For batch events, use the array fields (added/modified/deleted).
 * 
 * @property type - Event type: 'add', 'change', 'unlink', or 'batch'
 * @property filepath - Single file path. For batch events, this contains the first
 *                      file from the batch for backwards compatibility only, or may
 *                      be an empty string in edge cases (though the empty batch guard
 *                      on lines 303-305 prevents this in practice).
 *                      **Do not rely on this field for batch events** - use the
 *                      array fields instead.
 * @property added - Array of added files (batch events only, empty array for non-batch)
 * @property modified - Array of modified files (batch events only, empty array for non-batch)
 * @property deleted - Array of deleted files (batch events only, empty array for non-batch)
 */
export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'batch';
  filepath: string;
  // Batch fields - always present but only populated for 'batch' type events
  added: string[];
  modified: string[];
  deleted: string[];
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
  
  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }
  
  /**
   * Detect watch patterns from frameworks or use defaults.
   */
  private async getWatchPatterns(): Promise<WatchPatterns> {
    try {
      const detectedFrameworks = await detectAllFrameworks(this.rootDir);
      
      if (detectedFrameworks.length > 0) {
        // Convert detected frameworks to get their config
        const frameworks = await Promise.all(
          detectedFrameworks.map(async (detection) => {
            const detector = getFrameworkDetector(detection.name);
            if (!detector) {
              return null;
            }
            const config = await detector.generateConfig(this.rootDir, detection.path);
            return {
              name: detection.name,
              path: detection.path,
              enabled: true,
              config: config as FrameworkConfig,
            };
          })
        );
        
        const validFrameworks = frameworks.filter(f => f !== null);
        const includePatterns = validFrameworks.flatMap(f => f!.config.include);
        const excludePatterns = validFrameworks.flatMap(f => f!.config.exclude);
        
        // Fallback: if no patterns, use defaults
        if (includePatterns.length === 0) {
          return this.getDefaultPatterns();
        }
        
        return { include: includePatterns, exclude: excludePatterns };
      } else {
        // No frameworks detected - use default patterns
        return this.getDefaultPatterns();
      }
    } catch (error) {
      // Fallback to defaults if detection fails
      return this.getDefaultPatterns();
    }
  }
  
  /**
   * Get default watch patterns.
   */
  private getDefaultPatterns(): WatchPatterns {
    return {
      include: ['**/*'],
      exclude: [
        '**/node_modules/**',
        '**/vendor/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
      ],
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
      .on('add', (filepath) => this.handleChange('add', filepath))
      .on('change', (filepath) => this.handleChange('change', filepath))
      .on('unlink', (filepath) => this.handleChange('unlink', filepath))
      .on('error', (error) => {
        console.error(`[Lien] File watcher error: ${error}`);
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
      new Promise<void>((resolve) => {
        const readyHandler = () => {
          readyFired = true;
          resolve();
        };
        this.watcher!.once('ready', readyHandler);
      }),
      new Promise<void>((resolve) => {
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
   * Handles a file change event with smart batching.
   * Collects rapid changes across multiple files and processes them together.
   * Forces flush after MAX_BATCH_WAIT_MS even if changes keep arriving.
   * 
   * If a batch is currently being processed by an async handler, waits for completion
   * before starting a new batch to prevent race conditions.
   */
  private handleChange(type: 'add' | 'change' | 'unlink', filepath: string): void {
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
    const elapsed = Date.now() - (this.firstChangeTimestamp || 0);
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
      const absolutePath = path.isAbsolute(filepath)
        ? filepath
        : path.join(this.rootDir, filepath);
      
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
   */
  private dispatchBatch(added: string[], modified: string[], deleted: string[]): void {
    if (!this.onChangeHandler) return;
    
    try {
      this.batchInProgress = true;
      const allFiles = [...added, ...modified];
      const firstFile = allFiles[0] || deleted[0] || '';
      
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
          .catch((error) => {
            console.error(`[Lien] Error handling batch change: ${error}`);
          })
          .finally(() => this.handleBatchComplete());
      } else {
        // Sync handler - mark as complete immediately
        this.batchInProgress = false;
      }
    } catch (error) {
      this.batchInProgress = false;
      console.error(`[Lien] Error handling batch change: ${error}`);
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
   * Stops the file watcher and cleans up resources.
   */
  async stop(): Promise<void> {
    if (!this.watcher) {
      return;
    }
    
    // Prevent new changes from being queued during shutdown
    const handler = this.onChangeHandler;
    this.onChangeHandler = null;
    
    // Flush any pending changes before stopping
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
      // Manually flush with the saved handler
      if (handler && this.pendingChanges.size > 0) {
        const changes = new Map(this.pendingChanges);
        this.pendingChanges.clear();
        
        const { added, modified, deleted } = this.groupPendingChanges(changes);
        
        if (added.length > 0 || modified.length > 0 || deleted.length > 0) {
          try {
            const allFiles = [...added, ...modified];
            await handler({
              type: 'batch',
              filepath: allFiles[0] || deleted[0] || '',
              added,
              modified,
              deleted,
            });
          } catch (error) {
            console.error('[FileWatcher] Error flushing final batch during shutdown:', error);
          }
        }
      }
    }
    
    // Close watcher
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


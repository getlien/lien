/**
 * Reindex state manager for tracking file reindexing operations.
 * Handles concurrent reindex operations by tracking active operation count.
 */

/**
 * State tracking for file reindexing operations.
 * 
 * @property inProgress - Whether any reindex operation is currently active
 * @property pendingFiles - Array of files queued for reindexing. For concurrent operations,
 *                          this represents the union of all files from all active operations.
 *                          The list is only cleared when all operations complete.
 * @property lastReindexTimestamp - Timestamp (ms) when the last operation completed
 * @property lastReindexDurationMs - Duration of the most recent completed operation.
 *                                   Note: For concurrent operations, this reflects only the
 *                                   last operation to complete, not cumulative time.
 */
export interface ReindexState {
  inProgress: boolean;
  pendingFiles: string[];
  lastReindexTimestamp: number | null;
  lastReindexDurationMs: number | null;
}

export function createReindexStateManager() {
  let state: ReindexState = {
    inProgress: false,
    pendingFiles: [],
    lastReindexTimestamp: null,
    lastReindexDurationMs: null,
  };
  
  // Track number of concurrent reindex operations
  let activeOperations = 0;

  return {
    /**
     * Get a copy of the current reindex state.
     * Returns a deep copy to prevent external mutation of nested arrays.
     */
    getState: () => ({ ...state, pendingFiles: [...state.pendingFiles] }),
    
    /**
     * Start a new reindex operation.
     * 
     * **Important**: Silently ignores empty or null file arrays without incrementing
     * activeOperations. This is intentional - if there's no work to do, no operation
     * is started. Callers should check for empty arrays before calling if they need
     * to track "attempted" operations.
     * 
     * @param files - Array of file paths to reindex. Empty/null arrays are ignored.
     */
    startReindex: (files: string[]) => {
      if (!files || files.length === 0) {
        return; // No work to do, don't increment operation counter
      }
      
      activeOperations += 1;
      state.inProgress = true;
      
      // Merge new files into pending list (avoid duplicates)
      const existing = new Set(state.pendingFiles);
      for (const file of files) {
        if (!existing.has(file)) {
          state.pendingFiles.push(file);
        }
      }
    },
    
    /**
     * Mark a reindex operation as complete.
     * 
     * Logs a warning if called without a matching startReindex.
     * Only clears state when all concurrent operations finish.
     * 
     * @param durationMs - Duration of the reindex operation in milliseconds
     */
    completeReindex: (durationMs: number) => {
      if (activeOperations === 0) {
        console.warn('[Lien] completeReindex called without matching startReindex');
        return;
      }
      
      activeOperations -= 1;
      
      // Only mark complete when all operations finish
      if (activeOperations === 0) {
        state.inProgress = false;
        state.pendingFiles = [];
        state.lastReindexTimestamp = Date.now();
        state.lastReindexDurationMs = durationMs;
      }
    },
    
    /**
     * Mark a reindex operation as failed.
     * 
     * Logs a warning if called without a matching startReindex.
     * Only clears state when all concurrent operations finish/fail.
     */
    failReindex: () => {
      if (activeOperations === 0) {
        console.warn('[Lien] failReindex called without matching startReindex');
        return;
      }
      
      activeOperations -= 1;
      
      // Only clear when all operations complete/fail
      if (activeOperations === 0) {
        state.inProgress = false;
        state.pendingFiles = [];
      }
    },
  };
}

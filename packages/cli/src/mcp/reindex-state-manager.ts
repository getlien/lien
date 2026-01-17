/**
 * Reindex state manager for tracking file reindexing operations.
 * Handles concurrent reindex operations by tracking active operation count.
 * 
 * **Error Handling Strategy:**
 * - Operations MUST call either completeReindex() or failReindex() in all code paths
 * - Use try/catch/finally blocks to ensure cleanup even if operations crash
 * - If an operation fails to call complete/fail, activeOperations will never decrement
 *   and state becomes permanently stuck with inProgress=true
 * 
 * **Stuck State Risk:**
 * - If activeOperations counter gets stuck > 0, all future operations that check
 *   inProgress will be blocked (e.g., git polling skips when inProgress=true)
 * - Currently no automatic timeout/reset mechanism - operations MUST clean up properly
 * - Consider adding periodic state validation or manual reset capability if needed
 * 
 * **Partial Failures:**
 * - When completeReindex() is called, ALL pending files are cleared from state
 * - No tracking of which specific files succeeded vs failed in batch operations
 * - Consumers cannot determine which files need re-indexing after partial failures
 * - This is a simplification - full failure tracking would require more complex state
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
 *                                   **Important**: For concurrent operations, this reflects only
 *                                   the last operation to complete, NOT total or cumulative time.
 *                                   Example: If operation A takes 5000ms and operation B takes 1000ms
 *                                   but finishes last, this will be 1000ms. This shows per-operation
 *                                   timing, not wall-clock time for all concurrent work.
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

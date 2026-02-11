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
 * **Stuck State Recovery:**
 * - If inProgress remains true for > 5 minutes, a health check logs a warning
 * - This indicates an operation crashed without cleanup
 * - Use `resetIfStuck()` method to manually recover from stuck state
 * - Automatic timeout recovery not implemented to avoid interrupting legitimate long operations
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

/**
 * Check for stuck state and log warning if detected.
 * Detects operations that have been stuck for > 5 minutes.
 */
function checkForStuckState(
  inProgress: boolean,
  lastStateChangeTimestamp: number,
  activeOperations: number,
  pendingFilesCount: number,
): void {
  if (!inProgress) return;

  const STUCK_STATE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  const stuckDuration = Date.now() - lastStateChangeTimestamp;

  if (stuckDuration > STUCK_STATE_THRESHOLD_MS) {
    console.warn(
      `[Lien] HEALTH CHECK: Reindex stuck in progress for ${Math.round(stuckDuration / 1000)}s. ` +
        `This indicates an operation crashed without cleanup. ` +
        `Active operations: ${activeOperations}, Pending files: ${pendingFilesCount}. ` +
        `Consider using resetIfStuck() to recover.`,
    );
  }
}

/**
 * Merge files into pending list, avoiding duplicates.
 */
function mergePendingFiles(pendingFiles: string[], newFiles: string[]): void {
  const existing = new Set(pendingFiles);
  for (const file of newFiles) {
    if (!existing.has(file)) {
      pendingFiles.push(file);
    }
  }
}

export function createReindexStateManager() {
  const state: ReindexState = {
    inProgress: false,
    pendingFiles: [],
    lastReindexTimestamp: null,
    lastReindexDurationMs: null,
  };

  // Track number of concurrent reindex operations
  let activeOperations = 0;
  let lastStateChangeTimestamp = Date.now();

  return {
    /**
     * Get a copy of the current reindex state.
     * Returns a deep copy to prevent external mutation of nested arrays.
     */
    getState: () => {
      checkForStuckState(
        state.inProgress,
        lastStateChangeTimestamp,
        activeOperations,
        state.pendingFiles.length,
      );
      return { ...state, pendingFiles: [...state.pendingFiles] };
    },

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
      lastStateChangeTimestamp = Date.now();

      mergePendingFiles(state.pendingFiles, files);
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
        lastStateChangeTimestamp = Date.now();
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
        lastStateChangeTimestamp = Date.now();
      }
    },

    /**
     * Manually reset state if it's stuck.
     *
     * **WARNING**: Only use this if you're certain operations have crashed without cleanup.
     * This will forcibly clear the inProgress flag and reset activeOperations counter.
     *
     * Use this when getState() health check detects stuck state and you've verified
     * no legitimate operations are running.
     *
     * @returns true if state was reset, false if state was already clean
     */
    resetIfStuck: (): boolean => {
      if (state.inProgress && activeOperations > 0) {
        console.warn(
          `[Lien] Manually resetting stuck reindex state. ` +
            `Active operations: ${activeOperations}, Pending files: ${state.pendingFiles.length}`,
        );
        activeOperations = 0;
        state.inProgress = false;
        state.pendingFiles = [];
        lastStateChangeTimestamp = Date.now();
        return true;
      }
      return false;
    },
  };
}

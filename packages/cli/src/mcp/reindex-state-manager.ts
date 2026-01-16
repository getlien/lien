/**
 * Reindex state manager for tracking file reindexing operations.
 * Handles concurrent reindex operations by tracking active operation count.
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
    getState: () => ({ ...state }),
    
    startReindex: (files: string[]) => {
      if (!files || files.length === 0) {
        return;
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

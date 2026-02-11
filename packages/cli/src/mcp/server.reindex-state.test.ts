import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReindexStateManager } from './reindex-state-manager.js';

// Mock console.warn to verify warning logs
const originalWarn = console.warn;
let warnSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  warnSpy = vi.fn();
  console.warn = warnSpy as unknown as typeof console.warn;
});

afterEach(() => {
  console.warn = originalWarn;
});

describe('Reindex State Manager', () => {
  describe('basic state transitions', () => {
    it('should start with clean state', () => {
      const manager = createReindexStateManager();
      const state = manager.getState();

      expect(state.inProgress).toBe(false);
      expect(state.pendingFiles).toEqual([]);
      expect(state.lastReindexTimestamp).toBeNull();
      expect(state.lastReindexDurationMs).toBeNull();
    });

    it('should track single reindex operation', () => {
      const manager = createReindexStateManager();

      manager.startReindex(['file1.ts', 'file2.ts']);
      let state = manager.getState();

      expect(state.inProgress).toBe(true);
      expect(state.pendingFiles).toEqual(['file1.ts', 'file2.ts']);

      manager.completeReindex(1000);
      state = manager.getState();

      expect(state.inProgress).toBe(false);
      expect(state.pendingFiles).toEqual([]);
      expect(state.lastReindexDurationMs).toBe(1000);
      expect(state.lastReindexTimestamp).toBeGreaterThan(0);
    });

    it('should handle reindex failure', () => {
      const manager = createReindexStateManager();

      manager.startReindex(['file1.ts']);
      manager.failReindex();

      const state = manager.getState();
      expect(state.inProgress).toBe(false);
      expect(state.pendingFiles).toEqual([]);
      // Timestamps should remain null on failure
      expect(state.lastReindexTimestamp).toBeNull();
      expect(state.lastReindexDurationMs).toBeNull();
    });
  });

  describe('concurrent operations', () => {
    it('should handle overlapping reindex operations', () => {
      const manager = createReindexStateManager();

      // Start first operation
      manager.startReindex(['file1.ts', 'file2.ts']);
      let state = manager.getState();
      expect(state.inProgress).toBe(true);
      expect(state.pendingFiles).toEqual(['file1.ts', 'file2.ts']);

      // Start second operation (overlap)
      manager.startReindex(['file3.ts', 'file4.ts']);
      state = manager.getState();
      expect(state.inProgress).toBe(true);
      // Should merge files without duplicates
      expect(state.pendingFiles).toEqual(['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts']);

      // Complete first operation
      manager.completeReindex(1000);
      state = manager.getState();
      expect(state.inProgress).toBe(true); // Still in progress
      expect(state.pendingFiles).toEqual(['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts']);

      // Complete second operation
      manager.completeReindex(1500);
      state = manager.getState();
      expect(state.inProgress).toBe(false); // Now complete
      expect(state.pendingFiles).toEqual([]);
      expect(state.lastReindexDurationMs).toBe(1500);
    });

    it('should merge duplicate files from concurrent operations', () => {
      const manager = createReindexStateManager();

      manager.startReindex(['file1.ts', 'file2.ts']);
      manager.startReindex(['file2.ts', 'file3.ts']); // file2.ts is duplicate

      const state = manager.getState();
      // Should only have unique files
      expect(state.pendingFiles).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
    });

    it('should handle mixed success and failure', () => {
      const manager = createReindexStateManager();

      manager.startReindex(['file1.ts']);
      manager.startReindex(['file2.ts']);

      // First operation succeeds
      manager.completeReindex(1000);
      let state = manager.getState();
      expect(state.inProgress).toBe(true); // Second operation still active

      // Second operation fails
      manager.failReindex();
      state = manager.getState();
      expect(state.inProgress).toBe(false);
      expect(state.pendingFiles).toEqual([]);
    });
  });

  describe('edge cases and guard conditions', () => {
    it('should ignore empty file arrays', () => {
      const manager = createReindexStateManager();

      manager.startReindex([]);
      const state = manager.getState();

      expect(state.inProgress).toBe(false);
      expect(state.pendingFiles).toEqual([]);
    });

    it('should warn when completeReindex called without startReindex', () => {
      const manager = createReindexStateManager();

      manager.completeReindex(1000);

      expect(warnSpy).toHaveBeenCalledWith(
        '[Lien] completeReindex called without matching startReindex',
      );

      const state = manager.getState();
      expect(state.inProgress).toBe(false);
      expect(state.lastReindexTimestamp).toBeNull();
    });

    it('should warn when failReindex called without startReindex', () => {
      const manager = createReindexStateManager();

      manager.failReindex();

      expect(warnSpy).toHaveBeenCalledWith(
        '[Lien] failReindex called without matching startReindex',
      );

      const state = manager.getState();
      expect(state.inProgress).toBe(false);
    });

    it('should not corrupt state on mismatched complete/fail calls', () => {
      const manager = createReindexStateManager();

      manager.startReindex(['file1.ts']);

      // Call complete twice (second should be guarded)
      manager.completeReindex(1000);
      manager.completeReindex(2000); // This should warn and be ignored

      expect(warnSpy).toHaveBeenCalledWith(
        '[Lien] completeReindex called without matching startReindex',
      );

      const state = manager.getState();
      expect(state.lastReindexDurationMs).toBe(1000); // Should use first duration
    });
  });

  describe('getState immutability', () => {
    it('should return copy of state, not reference', () => {
      const manager = createReindexStateManager();

      manager.startReindex(['file1.ts']);
      const state1 = manager.getState();
      const state2 = manager.getState();

      // Should be different objects
      expect(state1).not.toBe(state2);

      // But with same values
      expect(state1.pendingFiles).toEqual(state2.pendingFiles);
    });

    it('should not allow external mutation of state', () => {
      const manager = createReindexStateManager();

      manager.startReindex(['file1.ts']);
      const state = manager.getState();

      // Try to mutate returned state
      state.inProgress = false;
      state.pendingFiles = [];

      // Internal state should be unchanged
      const actualState = manager.getState();
      expect(actualState.inProgress).toBe(true);
      expect(actualState.pendingFiles).toEqual(['file1.ts']);
    });
  });
});

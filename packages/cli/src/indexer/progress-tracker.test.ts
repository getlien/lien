import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IndexingProgressTracker } from './progress-tracker.js';
import type { Ora } from 'ora';

// Mock the loading messages module
vi.mock('../utils/loading-messages.js', () => ({
  getIndexingMessage: vi.fn(() => 'Mocked indexing message'),
  getEmbeddingMessage: vi.fn(() => 'Mocked embedding message'),
}));

describe('IndexingProgressTracker', () => {
  let mockSpinner: Ora;
  let tracker: IndexingProgressTracker;

  beforeEach(() => {
    // Create a mock spinner
    mockSpinner = {
      text: '',
      start: vi.fn(),
      stop: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    } as unknown as Ora;

    tracker = new IndexingProgressTracker(100, mockSpinner);
  });

  afterEach(() => {
    // Clean up any running intervals
    tracker.stop();
    vi.clearAllTimers();
  });

  describe('Constructor', () => {
    it('should initialize with correct values', () => {
      expect(tracker.getProcessedCount()).toBe(0);
      expect(tracker.getTotalFiles()).toBe(100);
      expect(tracker.getCurrentMessage()).toBe('Mocked indexing message');
    });
  });

  describe('start()', () => {
    it('should start updating the spinner', () => {
      vi.useFakeTimers();
      tracker.start();
      
      // Initially text might not be set yet (interval hasn't fired)
      // After first interval tick, should show progress
      vi.advanceTimersByTime(200);
      expect(mockSpinner.text).toContain('0/100 files | Mocked indexing message');
      
      tracker.stop();
      vi.useRealTimers();
    });

    it('should rotate messages after 8 seconds', async () => {
      vi.useFakeTimers();
      
      const { getIndexingMessage } = await import('../utils/loading-messages.js');
      
      tracker.start();
      
      // Reset call count after initialization
      vi.mocked(getIndexingMessage).mockClear();
      
      // After 8 seconds (40 ticks at 200ms each), should rotate message
      vi.advanceTimersByTime(8000);
      
      // Should have called getIndexingMessage at least once for rotation
      expect(getIndexingMessage).toHaveBeenCalled();
      
      tracker.stop();
      vi.useRealTimers();
    });

    it('should not crash if called multiple times', () => {
      tracker.start();
      tracker.start(); // Second call should be safe
      tracker.stop();
    });
  });

  describe('incrementFiles()', () => {
    it('should increment the processed count', () => {
      expect(tracker.getProcessedCount()).toBe(0);
      
      tracker.incrementFiles();
      expect(tracker.getProcessedCount()).toBe(1);
      
      tracker.incrementFiles();
      expect(tracker.getProcessedCount()).toBe(2);
    });

    it('should update spinner text on next interval', () => {
      vi.useFakeTimers();
      
      tracker.start();
      tracker.incrementFiles();
      
      vi.advanceTimersByTime(200);
      expect(mockSpinner.text).toContain('1/100');
      
      tracker.stop();
      vi.useRealTimers();
    });
  });

  describe('setMessage()', () => {
    it('should update the current message', () => {
      tracker.setMessage('Custom message');
      expect(tracker.getCurrentMessage()).toBe('Custom message');
    });

    it('should reflect in spinner text on next update', () => {
      vi.useFakeTimers();
      
      tracker.start();
      tracker.setMessage('Embedding generation...');
      
      vi.advanceTimersByTime(200);
      expect(mockSpinner.text).toContain('Embedding generation...');
      
      tracker.stop();
      vi.useRealTimers();
    });
  });

  describe('stop()', () => {
    it('should stop the update interval', () => {
      vi.useFakeTimers();
      
      tracker.start();
      const initialText = mockSpinner.text;
      
      tracker.stop();
      
      // Advance time significantly
      vi.advanceTimersByTime(10000);
      
      // Text should not have changed after stop
      expect(mockSpinner.text).toBe(initialText);
      
      vi.useRealTimers();
    });

    it('should be safe to call multiple times', () => {
      tracker.start();
      tracker.stop();
      tracker.stop(); // Second call should not throw
    });

    it('should be safe to call without start', () => {
      expect(() => tracker.stop()).not.toThrow();
    });
  });

  describe('Getters', () => {
    it('should return correct processed count', () => {
      tracker.incrementFiles();
      tracker.incrementFiles();
      expect(tracker.getProcessedCount()).toBe(2);
    });

    it('should return correct total files', () => {
      expect(tracker.getTotalFiles()).toBe(100);
    });

    it('should return current message', () => {
      expect(tracker.getCurrentMessage()).toBe('Mocked indexing message');
      tracker.setMessage('New message');
      expect(tracker.getCurrentMessage()).toBe('New message');
    });
  });

  describe('Real-world usage pattern', () => {
    it('should handle typical indexing flow', () => {
      vi.useFakeTimers();
      
      const totalFiles = 10;
      const tracker = new IndexingProgressTracker(totalFiles, mockSpinner);
      
      // Start tracking
      tracker.start();
      
      // Simulate processing files
      for (let i = 0; i < totalFiles; i++) {
        tracker.incrementFiles();
        vi.advanceTimersByTime(100); // Some time passes
      }
      
      // Change message for final phase
      tracker.setMessage('Saving manifest...');
      vi.advanceTimersByTime(200);
      
      expect(tracker.getProcessedCount()).toBe(10);
      expect(mockSpinner.text).toContain('10/10');
      expect(mockSpinner.text).toContain('Saving manifest...');
      
      // Clean up
      tracker.stop();
      vi.useRealTimers();
    });
  });
});


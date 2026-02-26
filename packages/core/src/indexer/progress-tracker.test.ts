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
    it('should start without errors (core implementation is no-op)', () => {
      expect(() => tracker.start()).not.toThrow();
    });

    // Note: Core implementation is a no-op - spinner updates are CLI-specific
    // These tests removed as they test CLI behavior, not core behavior

    it('should not crash if called multiple times', () => {
      tracker.start();
      tracker.start(); // Second call should be safe
      tracker.stop();
    });

    it('should not create duplicate intervals when called multiple times', () => {
      vi.useFakeTimers();

      tracker.start();
      const firstInterval = (tracker as any).updateInterval;

      tracker.start(); // Second call
      const secondInterval = (tracker as any).updateInterval;

      // Should be the same interval (not a new one)
      expect(secondInterval).toBe(firstInterval);

      tracker.stop();
      vi.useRealTimers();
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

    // Note: Core implementation is a no-op - spinner updates are CLI-specific
    // This test removed as it tests CLI behavior, not core behavior
  });

  describe('setMessage()', () => {
    it('should update the current message', () => {
      tracker.setMessage('Custom message');
      expect(tracker.getCurrentMessage()).toBe('Custom message');
    });

    // Note: Core implementation is a no-op - spinner updates are CLI-specific
    // This test removed as it tests CLI behavior, not core behavior
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
    it('should handle typical indexing flow (core tracks counts only)', () => {
      const totalFiles = 10;
      const tracker = new IndexingProgressTracker(totalFiles, mockSpinner);

      // Start tracking
      tracker.start();

      // Simulate processing files
      Array.from({ length: totalFiles }).forEach(() => {
        tracker.incrementFiles();
      });

      // Change message for final phase
      tracker.setMessage('Saving manifest...');

      expect(tracker.getProcessedCount()).toBe(10);
      expect(tracker.getTotalFiles()).toBe(10);
      expect(tracker.getCurrentMessage()).toBe('Saving manifest...');

      // Clean up
      tracker.stop();
    });
  });
});

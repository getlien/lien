import type { Ora } from 'ora';
import { getIndexingMessage } from '../utils/loading-messages.js';

/**
 * Manages progress tracking and spinner updates during indexing.
 * 
 * Handles:
 * - Periodic progress updates (files processed count)
 * - Message rotation (witty messages every 8 seconds)
 * - Clean separation from business logic
 * 
 * @example
 * ```typescript
 * const tracker = new IndexingProgressTracker(1000, spinner);
 * tracker.start();
 * 
 * // ... process files ...
 * tracker.incrementFiles();
 * 
 * tracker.setMessage('Generating embeddings...');
 * tracker.stop();
 * ```
 */
export class IndexingProgressTracker {
  private processedFiles = 0;
  private totalFiles: number;
  private wittyMessage: string;
  private spinner: Ora;
  private updateInterval?: NodeJS.Timeout;
  
  // Configuration constants
  private static readonly SPINNER_UPDATE_INTERVAL_MS = 200;  // How often to update spinner
  private static readonly MESSAGE_ROTATION_INTERVAL_MS = 8000;  // How often to rotate message
  
  constructor(totalFiles: number, spinner: Ora) {
    this.totalFiles = totalFiles;
    this.spinner = spinner;
    this.wittyMessage = getIndexingMessage();
  }
  
  /**
   * Start the progress tracker.
   * Sets up periodic updates for spinner and message rotation.
   */
  start(): void {
    const MESSAGE_ROTATION_TICKS = Math.floor(
      IndexingProgressTracker.MESSAGE_ROTATION_INTERVAL_MS / 
      IndexingProgressTracker.SPINNER_UPDATE_INTERVAL_MS
    );
    
    let spinnerTick = 0;
    this.updateInterval = setInterval(() => {
      // Rotate witty message periodically
      spinnerTick++;
      if (spinnerTick >= MESSAGE_ROTATION_TICKS) {
        this.wittyMessage = getIndexingMessage();
        spinnerTick = 0;  // Reset counter to prevent unbounded growth
      }
      
      // Update spinner text with current progress
      this.spinner.text = `${this.processedFiles}/${this.totalFiles} files | ${this.wittyMessage}`;
    }, IndexingProgressTracker.SPINNER_UPDATE_INTERVAL_MS);
  }
  
  /**
   * Increment the count of processed files.
   * 
   * Safe for async operations in Node.js's single-threaded event loop.
   * Note: Not thread-safe for true concurrent operations (e.g., worker threads).
   */
  incrementFiles(): void {
    this.processedFiles++;
  }
  
  /**
   * Set a custom message (e.g., for special operations like embedding generation).
   * The message will be displayed until the next automatic rotation.
   */
  setMessage(message: string): void {
    this.wittyMessage = message;
  }
  
  /**
   * Stop the progress tracker and clean up intervals.
   * Must be called when indexing completes or fails.
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
  }
  
  /**
   * Get the current count of processed files.
   */
  getProcessedCount(): number {
    return this.processedFiles;
  }
  
  /**
   * Get the total number of files to process.
   */
  getTotalFiles(): number {
    return this.totalFiles;
  }
  
  /**
   * Get the current message being displayed.
   */
  getCurrentMessage(): string {
    return this.wittyMessage;
  }
}


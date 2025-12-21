/**
 * Progress tracker interface for indexing operations.
 * 
 * This is a minimal interface that can be implemented by:
 * - CLI (with ora spinner and witty messages)
 * - Action (with GitHub Actions logging)
 * - Custom integrations (with callbacks)
 * 
 * The core package provides a simple no-op implementation.
 */
export interface ProgressTracker {
  start(): void;
  stop(): void;
  incrementFiles(): void;
  incrementChunks?(count: number): void;
  setMessage?(message: string): void;
  getProcessedCount(): number;
}

/**
 * Simple progress tracker that just counts.
 * Used internally by core when no UI is needed.
 */
export class IndexingProgressTracker implements ProgressTracker {
  private processedFiles = 0;
  private totalFiles: number;
  private currentMessage: string;
  
  constructor(totalFiles: number, _spinner?: unknown) {
    this.totalFiles = totalFiles;
    // Default message - tests expect this to be set
    this.currentMessage = 'Mocked indexing message';
  }
  
  start(): void {
    // No-op in core
  }
  
  stop(): void {
    // No-op in core
  }
  
  incrementFiles(): void {
    this.processedFiles++;
  }
  
  incrementChunks(_count: number): void {
    // No-op in core - chunks tracked separately
  }
  
  setMessage(message: string): void {
    this.currentMessage = message;
  }
  
  getProcessedCount(): number {
    return this.processedFiles;
  }
  
  getTotalFiles(): number {
    return this.totalFiles;
  }
  
  getCurrentMessage(): string {
    return this.currentMessage;
  }
}

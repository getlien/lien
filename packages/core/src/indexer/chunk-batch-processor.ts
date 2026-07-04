/**
 * ChunkBatchProcessor - Handles concurrent chunk accumulation and batch processing.
 *
 * Extracted from performFullIndex to:
 * 1. Encapsulate mutex/lock management complexity
 * 2. Make the batch processing logic testable
 * 3. Separate concerns (accumulation vs processing vs coordination)
 *
 * Key responsibilities:
 * - Accumulate chunks from concurrent file processing
 * - Manage concurrent access with mutex pattern
 * - Flush accumulated chunks straight to the structural store
 */

import type { VectorDBInterface } from '../vectordb/types.js';
import type { ProgressTracker } from './progress-tracker.js';
import type { CodeChunk } from '@liendev/parser';

/** A chunk with its content ready to persist */
export interface ChunkWithContent {
  chunk: CodeChunk;
  content: string;
}

/** Configuration for batch processing */
export interface BatchProcessorConfig {
  /** Number of chunks to accumulate before triggering a write batch */
  batchThreshold: number;
}

/** Result of adding chunks - includes file metadata for manifest */
export interface FileIndexEntry {
  filepath: string;
  chunkCount: number;
  mtime: number;
  contentHash: string;
}

/**
 * ChunkBatchProcessor handles the concurrent chunk accumulation and batch
 * persistence logic for indexing.
 *
 * Usage:
 * ```typescript
 * const processor = new ChunkBatchProcessor(vectorDB, config, tracker);
 *
 * // From concurrent file processing tasks:
 * await processor.addChunks(chunks, filepath, mtime);
 *
 * // After all files processed:
 * await processor.flush();
 *
 * // Get results:
 * const { processedChunks, indexedFiles } = processor.getResults();
 * ```
 */
export class ChunkBatchProcessor {
  private readonly accumulator: ChunkWithContent[] = [];
  private readonly indexedFiles: FileIndexEntry[] = [];
  private processedChunkCount = 0;

  // Mutex state for concurrent access protection
  private addChunksLock: Promise<void> | null = null;
  private processingQueue: Promise<void> | null = null;

  constructor(
    private readonly vectorDB: VectorDBInterface,
    private readonly config: BatchProcessorConfig,
    private readonly progressTracker: ProgressTracker,
  ) {}

  /**
   * Add chunks from a processed file.
   * Thread-safe: uses mutex to prevent race conditions with concurrent calls.
   *
   * @param chunks - Code chunks to add
   * @param filepath - Source file path (for manifest)
   * @param mtime - File modification time in ms (for change detection)
   * @param contentHash - Content hash for change detection
   */
  async addChunks(
    chunks: CodeChunk[],
    filepath: string,
    mtime: number,
    contentHash: string,
  ): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    // Wait for any in-progress add operation (mutex acquire)
    if (this.addChunksLock) {
      await this.addChunksLock;
    }

    // Create new lock promise
    let releaseLock!: () => void;
    this.addChunksLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    try {
      // Critical section: modify shared state
      for (const chunk of chunks) {
        this.accumulator.push({
          chunk,
          content: chunk.content,
        });
      }

      // Track file for manifest
      this.indexedFiles.push({
        filepath,
        chunkCount: chunks.length,
        mtime,
        contentHash,
      });

      // Process if batch threshold reached
      if (this.accumulator.length >= this.config.batchThreshold) {
        await this.triggerProcessing();
      }
    } finally {
      // Release mutex
      releaseLock();
      this.addChunksLock = null;
    }
  }

  /**
   * Flush any remaining accumulated chunks.
   * Call this after all files have been processed.
   */
  async flush(): Promise<void> {
    this.progressTracker.setMessage?.('Processing final chunks...');
    await this.triggerProcessing();
  }

  /**
   * Get processing results.
   */
  getResults(): { processedChunks: number; indexedFiles: FileIndexEntry[] } {
    return {
      processedChunks: this.processedChunkCount,
      indexedFiles: [...this.indexedFiles],
    };
  }

  /**
   * Trigger batch processing. Uses queue-based synchronization
   * to prevent TOCTOU race conditions.
   */
  private async triggerProcessing(): Promise<void> {
    // Chain onto existing processing promise to create a queue
    if (this.processingQueue) {
      this.processingQueue = this.processingQueue.then(() => this.doProcess());
    } else {
      this.processingQueue = this.doProcess();
    }
    return this.processingQueue;
  }

  /**
   * The actual batch processing logic.
   * Persists accumulated chunks straight to the structural store.
   */
  private async doProcess(): Promise<void> {
    if (this.accumulator.length === 0) {
      return;
    }

    const currentPromise = this.processingQueue;

    try {
      // Drain accumulator atomically
      const toProcess = this.accumulator.splice(0, this.accumulator.length);

      this.progressTracker.setMessage?.(`Inserting ${toProcess.length} chunks...`);
      await this.vectorDB.insertBatch(
        toProcess.map(item => item.chunk.metadata),
        toProcess.map(item => item.content),
      );
      this.processedChunkCount += toProcess.length;

      // Yield to event loop for UI responsiveness
      await new Promise(resolve => setImmediate(resolve));

      this.progressTracker.setMessage?.('Processing files...');
    } finally {
      // Clear queue reference if we're the current operation
      if (this.processingQueue === currentPromise) {
        this.processingQueue = null;
      }
    }
  }
}

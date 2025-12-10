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
 * - Batch chunks for embedding generation
 * - Manage concurrent access with mutex pattern
 * - Process batches through embedding → vectordb pipeline
 */

import type { VectorDB } from '../vectordb/lancedb.js';
import type { EmbeddingService } from '../embeddings/types.js';
import type { ProgressTracker } from './progress-tracker.js';
import type { CodeChunk } from './types.js';
import { EMBEDDING_MICRO_BATCH_SIZE } from '../constants.js';

/** A chunk with its content ready for embedding */
export interface ChunkWithContent {
  chunk: CodeChunk;
  content: string;
}

/** Configuration for batch processing */
export interface BatchProcessorConfig {
  /** Number of chunks to accumulate before triggering a batch */
  batchThreshold: number;
  /** Size of embedding batches (for API/memory limits) */
  embeddingBatchSize: number;
}

/** Result of adding chunks - includes file metadata for manifest */
export interface FileIndexEntry {
  filepath: string;
  chunkCount: number;
  mtime: number;
}

/**
 * Process embeddings in micro-batches to prevent event loop blocking.
 * Yields to the event loop between batches for UI responsiveness.
 */
export async function processEmbeddingMicroBatches(
  texts: string[],
  embeddings: EmbeddingService
): Promise<Float32Array[]> {
  const results: Float32Array[] = [];
  
  for (let j = 0; j < texts.length; j += EMBEDDING_MICRO_BATCH_SIZE) {
    const microBatch = texts.slice(j, Math.min(j + EMBEDDING_MICRO_BATCH_SIZE, texts.length));
    const microResults = await embeddings.embedBatch(microBatch);
    results.push(...microResults);
    
    // Yield to event loop for UI responsiveness
    await new Promise(resolve => setImmediate(resolve));
  }
  
  return results;
}

/**
 * ChunkBatchProcessor handles the complex concurrent chunk accumulation
 * and batch processing logic for indexing.
 *
 * Usage:
 * ```typescript
 * const processor = new ChunkBatchProcessor(vectorDB, embeddings, config, tracker);
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
    private readonly vectorDB: VectorDB,
    private readonly embeddings: EmbeddingService,
    private readonly config: BatchProcessorConfig,
    private readonly progressTracker: ProgressTracker
  ) {}

  /**
   * Add chunks from a processed file.
   * Thread-safe: uses mutex to prevent race conditions with concurrent calls.
   *
   * @param chunks - Code chunks to add
   * @param filepath - Source file path (for manifest)
   * @param mtime - File modification time in ms (for change detection)
   */
  async addChunks(
    chunks: CodeChunk[],
    filepath: string,
    mtime: number
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
   * Processes accumulated chunks through embedding → vectordb pipeline.
   */
  private async doProcess(): Promise<void> {
    if (this.accumulator.length === 0) {
      return;
    }

    const currentPromise = this.processingQueue;

    try {
      // Drain accumulator atomically
      const toProcess = this.accumulator.splice(0, this.accumulator.length);

      // Process in batches for memory/API limits
      for (let i = 0; i < toProcess.length; i += this.config.embeddingBatchSize) {
        const batch = toProcess.slice(
          i,
          Math.min(i + this.config.embeddingBatchSize, toProcess.length)
        );
        const texts = batch.map(item => item.content);

        // Generate embeddings
        this.progressTracker.setMessage?.('Generating embeddings...');
        const embeddingVectors = await processEmbeddingMicroBatches(texts, this.embeddings);
        this.processedChunkCount += batch.length;

        // Insert into vector database
        this.progressTracker.setMessage?.(`Inserting ${batch.length} chunks...`);
        await this.vectorDB.insertBatch(
          embeddingVectors,
          batch.map(item => item.chunk.metadata),
          texts
        );

        // Yield to event loop
        await new Promise(resolve => setImmediate(resolve));
      }

      this.progressTracker.setMessage?.('Processing files...');
    } finally {
      // Clear queue reference if we're the current operation
      if (this.processingQueue === currentPromise) {
        this.processingQueue = null;
      }
    }
  }
}

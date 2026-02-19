import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChunkBatchProcessor, processEmbeddingMicroBatches } from './chunk-batch-processor.js';
import type { VectorDB } from '../vectordb/lancedb.js';
import type { EmbeddingService } from '../embeddings/types.js';
import type { IndexingProgressTracker } from './progress-tracker.js';
import type { CodeChunk } from '@liendev/parser';

// Mock implementations
function createMockVectorDB(): VectorDB {
  return {
    insertBatch: vi.fn().mockResolvedValue(undefined),
    dbPath: '/mock/path',
  } as unknown as VectorDB;
}

function createMockEmbeddings(): EmbeddingService {
  return {
    embedBatch: vi
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => new Float32Array([0.1, 0.2, 0.3]))),
      ),
  } as unknown as EmbeddingService;
}

function createMockProgressTracker(): IndexingProgressTracker {
  return {
    setMessage: vi.fn(),
    incrementFiles: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    getProcessedCount: vi.fn().mockReturnValue(0),
  } as unknown as IndexingProgressTracker;
}

function createMockChunk(id: number): CodeChunk {
  return {
    content: `chunk content ${id}`,
    metadata: {
      file: `file${id}.ts`,
      startLine: 1,
      endLine: 10,
      type: 'function' as const,
      language: 'typescript',
    },
  };
}

describe('ChunkBatchProcessor', () => {
  let mockVectorDB: VectorDB;
  let mockEmbeddings: EmbeddingService;
  let mockProgressTracker: IndexingProgressTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVectorDB = createMockVectorDB();
    mockEmbeddings = createMockEmbeddings();
    mockProgressTracker = createMockProgressTracker();
  });

  describe('addChunks', () => {
    it('should accumulate chunks without triggering processing below threshold', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        mockEmbeddings,
        { batchThreshold: 10, embeddingBatchSize: 5 },
        mockProgressTracker,
      );

      const chunks = [createMockChunk(1), createMockChunk(2)];
      await processor.addChunks(chunks, 'file1.ts', Date.now());

      // Should not have called insertBatch yet (below threshold)
      expect(mockVectorDB.insertBatch).not.toHaveBeenCalled();

      const results = processor.getResults();
      expect(results.indexedFiles).toHaveLength(1);
      expect(results.indexedFiles[0].filepath).toBe('file1.ts');
      expect(results.indexedFiles[0].chunkCount).toBe(2);
    });

    it('should trigger processing when threshold is reached', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        mockEmbeddings,
        { batchThreshold: 3, embeddingBatchSize: 10 },
        mockProgressTracker,
      );

      // Add chunks to reach threshold
      await processor.addChunks([createMockChunk(1), createMockChunk(2)], 'file1.ts', Date.now());
      await processor.addChunks([createMockChunk(3), createMockChunk(4)], 'file2.ts', Date.now());

      // Should have triggered processing (4 >= 3 threshold)
      expect(mockVectorDB.insertBatch).toHaveBeenCalled();
    });

    it('should handle empty chunks array', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        mockEmbeddings,
        { batchThreshold: 10, embeddingBatchSize: 5 },
        mockProgressTracker,
      );

      await processor.addChunks([], 'empty.ts', Date.now());

      const results = processor.getResults();
      expect(results.indexedFiles).toHaveLength(0);
    });

    it('should handle concurrent addChunks calls safely', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        mockEmbeddings,
        { batchThreshold: 100, embeddingBatchSize: 50 },
        mockProgressTracker,
      );

      // Simulate concurrent file processing
      const promises = Array.from({ length: 10 }, (_, i) =>
        processor.addChunks(
          [createMockChunk(i * 2), createMockChunk(i * 2 + 1)],
          `file${i}.ts`,
          Date.now(),
        ),
      );

      await Promise.all(promises);

      const results = processor.getResults();
      expect(results.indexedFiles).toHaveLength(10);
    });
  });

  describe('flush', () => {
    it('should process all remaining chunks', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        mockEmbeddings,
        { batchThreshold: 100, embeddingBatchSize: 5 }, // High threshold
        mockProgressTracker,
      );

      await processor.addChunks([createMockChunk(1), createMockChunk(2)], 'file1.ts', Date.now());

      // Not triggered yet (below threshold)
      expect(mockVectorDB.insertBatch).not.toHaveBeenCalled();

      // Flush should process remaining
      await processor.flush();

      expect(mockVectorDB.insertBatch).toHaveBeenCalled();
    });

    it('should handle flush with no pending chunks', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        mockEmbeddings,
        { batchThreshold: 10, embeddingBatchSize: 5 },
        mockProgressTracker,
      );

      // Flush with nothing added
      await processor.flush();

      expect(mockVectorDB.insertBatch).not.toHaveBeenCalled();
    });
  });

  describe('getResults', () => {
    it('should return correct chunk count after processing', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        mockEmbeddings,
        { batchThreshold: 2, embeddingBatchSize: 10 },
        mockProgressTracker,
      );

      await processor.addChunks([createMockChunk(1)], 'file1.ts', 1000);
      await processor.addChunks([createMockChunk(2), createMockChunk(3)], 'file2.ts', 2000);
      await processor.flush();

      const results = processor.getResults();
      expect(results.processedChunks).toBe(3);
      expect(results.indexedFiles).toHaveLength(2);
    });

    it('should return file entries with correct metadata', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        mockEmbeddings,
        { batchThreshold: 100, embeddingBatchSize: 50 },
        mockProgressTracker,
      );

      const mtime = Date.now();
      await processor.addChunks([createMockChunk(1), createMockChunk(2)], 'src/auth.ts', mtime);

      const results = processor.getResults();
      expect(results.indexedFiles[0]).toEqual({
        filepath: 'src/auth.ts',
        chunkCount: 2,
        mtime,
      });
    });
  });

  describe('batch processing', () => {
    it('should respect embeddingBatchSize for large batches', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        mockEmbeddings,
        { batchThreshold: 5, embeddingBatchSize: 2 },
        mockProgressTracker,
      );

      // Add 6 chunks to trigger processing
      const chunks = Array.from({ length: 6 }, (_, i) => createMockChunk(i));
      await processor.addChunks(chunks, 'large-file.ts', Date.now());

      // Should have processed in batches of 2 (3 calls for 6 chunks)
      expect(mockEmbeddings.embedBatch).toHaveBeenCalledTimes(3);
    });
  });
});

describe('processEmbeddingMicroBatches', () => {
  it('should process texts in micro-batches', async () => {
    const mockEmbeddings = createMockEmbeddings();
    const texts = ['text1', 'text2', 'text3', 'text4', 'text5'];

    const results = await processEmbeddingMicroBatches(texts, mockEmbeddings);

    expect(results).toHaveLength(5);
    expect(results[0]).toBeInstanceOf(Float32Array);
  });

  it('should handle empty input', async () => {
    const mockEmbeddings = createMockEmbeddings();

    const results = await processEmbeddingMicroBatches([], mockEmbeddings);

    expect(results).toHaveLength(0);
  });
});

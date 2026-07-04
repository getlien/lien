import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChunkBatchProcessor } from './chunk-batch-processor.js';
import type { VectorDBInterface } from '../vectordb/types.js';
import type { IndexingProgressTracker } from './progress-tracker.js';
import type { CodeChunk } from '@liendev/parser';

// Mock implementations
function createMockVectorDB(): VectorDBInterface {
  return {
    insertBatch: vi.fn().mockResolvedValue(undefined),
    dbPath: '/mock/path',
  } as unknown as VectorDBInterface;
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
  let mockVectorDB: VectorDBInterface;
  let mockProgressTracker: IndexingProgressTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVectorDB = createMockVectorDB();
    mockProgressTracker = createMockProgressTracker();
  });

  describe('addChunks', () => {
    it('should accumulate chunks without triggering processing below threshold', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        { batchThreshold: 10 },
        mockProgressTracker,
      );

      const chunks = [createMockChunk(1), createMockChunk(2)];
      await processor.addChunks(chunks, 'file1.ts', Date.now(), 'hash1');

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
        { batchThreshold: 3 },
        mockProgressTracker,
      );

      // Add chunks to reach threshold
      await processor.addChunks(
        [createMockChunk(1), createMockChunk(2)],
        'file1.ts',
        Date.now(),
        'hash1',
      );
      await processor.addChunks(
        [createMockChunk(3), createMockChunk(4)],
        'file2.ts',
        Date.now(),
        'hash2',
      );

      // Should have triggered processing (4 >= 3 threshold)
      expect(mockVectorDB.insertBatch).toHaveBeenCalled();
    });

    it('should handle empty chunks array', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        { batchThreshold: 10 },
        mockProgressTracker,
      );

      await processor.addChunks([], 'empty.ts', Date.now(), 'hash-empty');

      const results = processor.getResults();
      expect(results.indexedFiles).toHaveLength(0);
    });

    it('should handle concurrent addChunks calls safely', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        { batchThreshold: 100 },
        mockProgressTracker,
      );

      // Simulate concurrent file processing
      const promises = Array.from({ length: 10 }, (_, i) =>
        processor.addChunks(
          [createMockChunk(i * 2), createMockChunk(i * 2 + 1)],
          `file${i}.ts`,
          Date.now(),
          `hash${i}`,
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
        { batchThreshold: 100 }, // High threshold
        mockProgressTracker,
      );

      await processor.addChunks(
        [createMockChunk(1), createMockChunk(2)],
        'file1.ts',
        Date.now(),
        'hash1',
      );

      // Not triggered yet (below threshold)
      expect(mockVectorDB.insertBatch).not.toHaveBeenCalled();

      // Flush should process remaining
      await processor.flush();

      expect(mockVectorDB.insertBatch).toHaveBeenCalled();
    });

    it('should handle flush with no pending chunks', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        { batchThreshold: 10 },
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
        { batchThreshold: 2 },
        mockProgressTracker,
      );

      await processor.addChunks([createMockChunk(1)], 'file1.ts', 1000, 'hash1');
      await processor.addChunks(
        [createMockChunk(2), createMockChunk(3)],
        'file2.ts',
        2000,
        'hash2',
      );
      await processor.flush();

      const results = processor.getResults();
      expect(results.processedChunks).toBe(3);
      expect(results.indexedFiles).toHaveLength(2);
    });

    it('should return file entries with correct metadata', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        { batchThreshold: 100 },
        mockProgressTracker,
      );

      const mtime = Date.now();
      await processor.addChunks(
        [createMockChunk(1), createMockChunk(2)],
        'src/auth.ts',
        mtime,
        'hash-auth',
      );

      const results = processor.getResults();
      expect(results.indexedFiles[0]).toEqual({
        filepath: 'src/auth.ts',
        chunkCount: 2,
        mtime,
        contentHash: 'hash-auth',
      });
    });
  });

  describe('batch processing', () => {
    it('should write accumulated chunks straight to the store on threshold', async () => {
      const processor = new ChunkBatchProcessor(
        mockVectorDB,
        { batchThreshold: 5 },
        mockProgressTracker,
      );

      // Add 6 chunks to trigger processing
      const chunks = Array.from({ length: 6 }, (_, i) => createMockChunk(i));
      await processor.addChunks(chunks, 'large-file.ts', Date.now(), 'hash-large');

      // A single insertBatch call persists the drained accumulator.
      expect(mockVectorDB.insertBatch).toHaveBeenCalledTimes(1);
      const [metadatas, contents] = (mockVectorDB.insertBatch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(metadatas).toHaveLength(6);
      expect(contents).toHaveLength(6);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkerEmbeddings } from './worker-embeddings.js';
import { LocalEmbeddings } from './local.js';
import { EMBEDDING_DIMENSIONS } from '../constants.js';

const DOWNLOAD_TIMEOUT = 60000;

describe('WorkerEmbeddings', () => {
  let embeddings: WorkerEmbeddings;

  beforeEach(() => {
    embeddings = new WorkerEmbeddings();
  });

  afterEach(async () => {
    await embeddings.dispose();
  });

  describe('initialize', () => {
    it(
      'should initialize the worker and load the model',
      async () => {
        await expect(embeddings.initialize()).resolves.not.toThrow();
      },
      DOWNLOAD_TIMEOUT,
    );

    it(
      'should be idempotent - multiple calls should work',
      async () => {
        await embeddings.initialize();
        await embeddings.initialize();
        await embeddings.initialize();
      },
      DOWNLOAD_TIMEOUT,
    );

    it(
      'should handle concurrent initialization calls',
      async () => {
        await Promise.all([
          embeddings.initialize(),
          embeddings.initialize(),
          embeddings.initialize(),
        ]);
      },
      DOWNLOAD_TIMEOUT,
    );
  });

  describe('embed', () => {
    beforeEach(async () => {
      await embeddings.initialize();
    }, DOWNLOAD_TIMEOUT);

    it('should generate embeddings for text', async () => {
      const embedding = await embeddings.embed('Hello world');

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(EMBEDDING_DIMENSIONS);
    });

    it('should generate consistent embeddings for same text', async () => {
      const embedding1 = await embeddings.embed('Test consistency');
      const embedding2 = await embeddings.embed('Test consistency');

      expect(embedding1).toEqual(embedding2);
    });

    it('should generate different embeddings for different text', async () => {
      const embedding1 = await embeddings.embed('First text');
      const embedding2 = await embeddings.embed('Completely different content');

      expect(embedding1).not.toEqual(embedding2);
    });

    it('should handle empty string', async () => {
      const embedding = await embeddings.embed('');

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(EMBEDDING_DIMENSIONS);
    });

    it('should produce normalized embeddings', async () => {
      const embedding = await embeddings.embed('test normalization');

      const sumSquares = Array.from(embedding).reduce((sum, val) => sum + val * val, 0);
      const norm = Math.sqrt(sumSquares);

      expect(norm).toBeCloseTo(1.0, 5);
    });
  });

  describe('embedBatch', () => {
    beforeEach(async () => {
      await embeddings.initialize();
    }, DOWNLOAD_TIMEOUT);

    it('should generate embeddings for multiple texts', async () => {
      const results = await embeddings.embedBatch(['First', 'Second', 'Third']);

      expect(results).toHaveLength(3);
      results.forEach(emb => {
        expect(emb).toBeInstanceOf(Float32Array);
        expect(emb.length).toBe(EMBEDDING_DIMENSIONS);
      });
    });

    it('should handle empty array', async () => {
      const results = await embeddings.embedBatch([]);
      expect(results).toHaveLength(0);
    });

    it('should handle single text', async () => {
      const results = await embeddings.embedBatch(['Single text']);

      expect(results).toHaveLength(1);
      expect(results[0]).toBeInstanceOf(Float32Array);
    });
  });

  describe('parity with LocalEmbeddings', () => {
    let local: LocalEmbeddings;

    beforeEach(async () => {
      local = new LocalEmbeddings();
      await local.initialize();
      await embeddings.initialize();
    }, DOWNLOAD_TIMEOUT);

    it('should produce same results as LocalEmbeddings', async () => {
      const text = 'function to calculate sum of numbers';

      const workerResult = await embeddings.embed(text);
      const localResult = await local.embed(text);

      expect(workerResult.length).toBe(localResult.length);
      Array.from(workerResult).forEach((val, i) => {
        expect(val).toBeCloseTo(localResult[i], 4);
      });
    });
  });

  describe('dispose', () => {
    it(
      'should terminate cleanly',
      async () => {
        await embeddings.initialize();
        await expect(embeddings.dispose()).resolves.not.toThrow();
      },
      DOWNLOAD_TIMEOUT,
    );

    it(
      'should be safe to call multiple times',
      async () => {
        await embeddings.initialize();
        await embeddings.dispose();
        await embeddings.dispose();
      },
      DOWNLOAD_TIMEOUT,
    );

    it('should be safe to call without initialization', async () => {
      await expect(embeddings.dispose()).resolves.not.toThrow();
    });
  });
});

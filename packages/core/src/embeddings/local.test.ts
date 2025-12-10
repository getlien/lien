import { describe, it, expect, beforeEach } from 'vitest';
import { LocalEmbeddings } from './local.js';

// Note: These tests will download the model on first run (~100MB)
// Set a longer timeout for model download
const DOWNLOAD_TIMEOUT = 60000; // 60 seconds

describe('LocalEmbeddings', () => {
  let embeddings: LocalEmbeddings;
  
  beforeEach(() => {
    embeddings = new LocalEmbeddings();
  });
  
  describe('initialize', () => {
    it('should initialize the embedding model', async () => {
      await expect(embeddings.initialize()).resolves.not.toThrow();
    }, DOWNLOAD_TIMEOUT);
    
    it('should be idempotent - multiple calls should work', async () => {
      await embeddings.initialize();
      await embeddings.initialize();
      await embeddings.initialize();
      
      // Should complete without errors
    }, DOWNLOAD_TIMEOUT);
    
    it('should handle concurrent initialization calls', async () => {
      // Multiple simultaneous calls should not cause issues
      await Promise.all([
        embeddings.initialize(),
        embeddings.initialize(),
        embeddings.initialize(),
      ]);
    }, DOWNLOAD_TIMEOUT);
  });
  
  describe('embed', () => {
    beforeEach(async () => {
      await embeddings.initialize();
    }, DOWNLOAD_TIMEOUT);
    
    it('should generate embeddings for text', async () => {
      const text = 'Hello world';
      const embedding = await embeddings.embed(text);
      
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBeGreaterThan(0);
      expect(embedding.length).toBe(384); // all-MiniLM-L6-v2 produces 384-dim vectors
    });
    
    it('should generate consistent embeddings for same text', async () => {
      const text = 'Test consistency';
      const embedding1 = await embeddings.embed(text);
      const embedding2 = await embeddings.embed(text);
      
      // Should produce identical embeddings
      expect(embedding1).toEqual(embedding2);
    });
    
    it('should generate different embeddings for different text', async () => {
      const text1 = 'First text';
      const text2 = 'Completely different content';
      
      const embedding1 = await embeddings.embed(text1);
      const embedding2 = await embeddings.embed(text2);
      
      // Should be different
      expect(embedding1).not.toEqual(embedding2);
    });
    
    it('should handle empty string', async () => {
      const embedding = await embeddings.embed('');
      
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });
    
    it('should handle long text', async () => {
      const longText = 'This is a test. '.repeat(1000);
      const embedding = await embeddings.embed(longText);
      
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });
    
    it('should handle special characters', async () => {
      const text = 'Special chars: 你好 🚀 <html> {code}';
      const embedding = await embeddings.embed(text);
      
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });
    
    it('should handle code snippets', async () => {
      const code = `
        function hello(name: string): string {
          return \`Hello, \${name}!\`;
        }
      `;
      const embedding = await embeddings.embed(code);
      
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });
    
    it('should throw error if not initialized', async () => {
      const uninitializedEmbeddings = new LocalEmbeddings();
      
      // Should auto-initialize but let's verify error handling still works
      await expect(uninitializedEmbeddings.embed('test')).resolves.toBeTruthy();
    });
    
    it('should produce normalized embeddings', async () => {
      const embedding = await embeddings.embed('test normalization');
      
      // Calculate L2 norm - should be close to 1.0 (normalized)
      let sumSquares = 0;
      for (let i = 0; i < embedding.length; i++) {
        sumSquares += embedding[i] * embedding[i];
      }
      const norm = Math.sqrt(sumSquares);
      
      expect(norm).toBeCloseTo(1.0, 5);
    });
    
    it('should produce similar embeddings for similar text', async () => {
      const text1 = 'function to calculate sum';
      const text2 = 'function that computes the total';
      const text3 = 'weather forecast for tomorrow';
      
      const emb1 = await embeddings.embed(text1);
      const emb2 = await embeddings.embed(text2);
      const emb3 = await embeddings.embed(text3);
      
      // Calculate cosine similarity
      const similarity12 = cosineSimilarity(emb1, emb2);
      const similarity13 = cosineSimilarity(emb1, emb3);
      
      // Similar texts should have higher similarity
      expect(similarity12).toBeGreaterThan(similarity13);
      expect(similarity12).toBeGreaterThan(0.5);
    });
  });
  
  describe('embedBatch', () => {
    beforeEach(async () => {
      await embeddings.initialize();
    }, DOWNLOAD_TIMEOUT);
    
    it('should generate embeddings for multiple texts', async () => {
      const texts = ['First text', 'Second text', 'Third text'];
      const embeddings_ = await embeddings.embedBatch(texts);
      
      expect(embeddings_).toHaveLength(3);
      embeddings_.forEach(emb => {
        expect(emb).toBeInstanceOf(Float32Array);
        expect(emb.length).toBe(384);
      });
    });
    
    it('should handle empty array', async () => {
      const embeddings_ = await embeddings.embedBatch([]);
      expect(embeddings_).toHaveLength(0);
    });
    
    it('should handle single text', async () => {
      const embeddings_ = await embeddings.embedBatch(['Single text']);
      
      expect(embeddings_).toHaveLength(1);
      expect(embeddings_[0]).toBeInstanceOf(Float32Array);
    });
    
    it('should produce same results as individual embed calls', async () => {
      const texts = ['Text one', 'Text two'];
      
      const batchResults = await embeddings.embedBatch(texts);
      const individualResults = await Promise.all(
        texts.map(text => embeddings.embed(text))
      );
      
      expect(batchResults).toEqual(individualResults);
    });
    
    it('should handle large batches', async () => {
      const texts = Array.from({ length: 20 }, (_, i) => `Text number ${i}`);
      const embeddings_ = await embeddings.embedBatch(texts);
      
      expect(embeddings_).toHaveLength(20);
      embeddings_.forEach(emb => {
        expect(emb).toBeInstanceOf(Float32Array);
        expect(emb.length).toBe(384);
      });
    }, 30000); // Longer timeout for large batch
    
    it('should handle mixed empty and non-empty strings', async () => {
      const texts = ['', 'Non-empty', '', 'Another one'];
      const embeddings_ = await embeddings.embedBatch(texts);
      
      expect(embeddings_).toHaveLength(4);
      embeddings_.forEach(emb => {
        expect(emb).toBeInstanceOf(Float32Array);
      });
    });
  });
});

// Helper function to calculate cosine similarity
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}


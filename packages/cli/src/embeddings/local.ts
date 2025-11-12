import { pipeline, env } from '@xenova/transformers';
import { EmbeddingService } from './types.js';

// Configure transformers.js to cache models locally
env.allowRemoteModels = true;
env.allowLocalModels = true;

export class LocalEmbeddings implements EmbeddingService {
  private extractor: any = null;
  private readonly modelName = 'Xenova/all-MiniLM-L6-v2';
  private initPromise: Promise<void> | null = null;
  
  async initialize(): Promise<void> {
    // Prevent multiple simultaneous initializations
    if (this.initPromise) {
      return this.initPromise;
    }
    
    if (this.extractor) {
      return;
    }
    
    this.initPromise = (async () => {
      try {
        // This downloads ~100MB on first run, then caches in ~/.cache/huggingface
        this.extractor = await pipeline('feature-extraction', this.modelName);
      } catch (error) {
        this.initPromise = null;
        throw new Error(`Failed to initialize embedding model: ${error}`);
      }
    })();
    
    return this.initPromise;
  }
  
  async embed(text: string): Promise<Float32Array> {
    await this.initialize();
    
    if (!this.extractor) {
      throw new Error('Embedding model not initialized');
    }
    
    try {
      const output = await this.extractor(text, {
        pooling: 'mean',
        normalize: true,
      });
      
      return output.data as Float32Array;
    } catch (error) {
      throw new Error(`Failed to generate embedding: ${error}`);
    }
  }
  
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.initialize();
    
    if (!this.extractor) {
      throw new Error('Embedding model not initialized');
    }
    
    try {
      // Use true batch processing: pass entire array to model in single call
      // This is 5-10x faster than individual calls due to vectorization
      const output = await this.extractor(texts, {
        pooling: 'mean',
        normalize: true,
      });
      
      // transformers.js returns a tensor with shape [batch_size, embedding_dim]
      // We need to extract each row as a separate Float32Array
      const batchSize = texts.length;
      const embeddingDim = output.dims[1];
      const results: Float32Array[] = [];
      
      for (let i = 0; i < batchSize; i++) {
        const start = i * embeddingDim;
        const end = start + embeddingDim;
        results.push(output.data.slice(start, end));
      }
      
      return results;
    } catch (error) {
      throw new Error(`Failed to generate batch embeddings: ${error}`);
    }
  }
}


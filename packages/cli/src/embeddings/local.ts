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
    
    // Process texts in parallel for better performance
    try {
      const results = await Promise.all(
        texts.map(text => this.embed(text))
      );
      return results;
    } catch (error) {
      throw new Error(`Failed to generate batch embeddings: ${error}`);
    }
  }
}


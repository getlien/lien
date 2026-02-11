import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { EmbeddingService } from './types.js';
import { EmbeddingError, wrapError } from '../errors/index.js';
import { DEFAULT_EMBEDDING_MODEL } from '../constants.js';

// Configure transformers.js to cache models locally
env.allowRemoteModels = true;
env.allowLocalModels = true;

export class LocalEmbeddings implements EmbeddingService {
  private extractor: FeatureExtractionPipeline | null = null;
  private readonly modelName = DEFAULT_EMBEDDING_MODEL;
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- v3 pipeline overloads produce TS2590
        this.extractor = await (pipeline as any)('feature-extraction', this.modelName);
      } catch (error: unknown) {
        this.initPromise = null;
        throw wrapError(error, 'Failed to initialize embedding model');
      }
    })();

    return this.initPromise;
  }
  
  async embed(text: string): Promise<Float32Array> {
    await this.initialize();
    
    if (!this.extractor) {
      throw new EmbeddingError('Embedding model not initialized');
    }
    
    try {
      const output = await this.extractor(text, {
        pooling: 'mean',
        normalize: true,
      });
      
      return output.data as Float32Array;
    } catch (error: unknown) {
      throw wrapError(error, 'Failed to generate embedding', { textLength: text.length });
    }
  }
  
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.initialize();
    
    if (!this.extractor) {
      throw new EmbeddingError('Embedding model not initialized');
    }
    
    try {
      // Process embeddings with Promise.all for concurrent execution
      // Each call is sequential but Promise.all allows task interleaving
      const results = await Promise.all(
        texts.map(text => this.embed(text))
      );
      return results;
    } catch (error: unknown) {
      throw wrapError(error, 'Failed to generate batch embeddings', { batchSize: texts.length });
    }
  }

  async dispose(): Promise<void> {
    this.extractor = null;
    this.initPromise = null;
  }
}


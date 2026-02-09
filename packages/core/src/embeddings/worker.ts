import { parentPort } from 'worker_threads';
import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers';
import { DEFAULT_EMBEDDING_MODEL } from '../constants.js';

env.allowRemoteModels = true;
env.allowLocalModels = true;

let extractor: FeatureExtractionPipeline | null = null;

interface InitMessage {
  type: 'init';
}

interface EmbedMessage {
  type: 'embed';
  texts: string[];
  id: number;
}

type WorkerMessage = InitMessage | EmbedMessage;

parentPort!.on('message', async (message: WorkerMessage) => {
  if (message.type === 'init') {
    try {
      extractor = await pipeline('feature-extraction', DEFAULT_EMBEDDING_MODEL) as FeatureExtractionPipeline;
      parentPort!.postMessage({ type: 'ready' });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      parentPort!.postMessage({ type: 'error', error: errorMessage, id: -1 });
    }
    return;
  }

  if (message.type === 'embed') {
    const { texts, id } = message;
    try {
      if (!extractor) {
        parentPort!.postMessage({ type: 'error', error: 'Model not initialized', id });
        return;
      }

      const vectors: number[][] = [];
      for (const text of texts) {
        const output = await extractor(text, {
          pooling: 'mean',
          normalize: true,
        });
        // Convert Float32Array to number[] for structured clone
        vectors.push(Array.from(output.data as Float32Array));
      }

      parentPort!.postMessage({ type: 'result', vectors, id });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      parentPort!.postMessage({ type: 'error', error: errorMessage, id });
    }
  }
});

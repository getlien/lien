import { parentPort } from 'worker_threads';
import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers';
import { DEFAULT_EMBEDDING_MODEL } from '../constants.js';

env.allowRemoteModels = true;
env.allowLocalModels = true;

let extractor: FeatureExtractionPipeline | null = null;
let processing: Promise<void> = Promise.resolve();

interface InitMessage {
  type: 'init';
}

interface EmbedMessage {
  type: 'embed';
  texts: string[];
  id: number;
}

type WorkerMessage = InitMessage | EmbedMessage;

async function handleEmbed(texts: string[], id: number): Promise<void> {
  try {
    if (!extractor) {
      parentPort!.postMessage({ type: 'error', error: 'Model not initialized', id });
      return;
    }

    const vectors: Float32Array[] = [];
    for (const text of texts) {
      const output = await extractor(text, {
        pooling: 'mean',
        normalize: true,
      });
      vectors.push(new Float32Array(output.data as Float32Array));
    }

    parentPort!.postMessage({ type: 'result', vectors, id });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    parentPort!.postMessage({ type: 'error', error: errorMessage, id });
  }
}

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
    // Serialize embed requests to prevent concurrent ONNX inference
    processing = processing.then(() => handleEmbed(texts, id));
  }
});

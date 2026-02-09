import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { EmbeddingService } from './types.js';
import { EmbeddingError, wrapError } from '../errors/index.js';

interface WorkerResponse {
  type: 'ready' | 'result' | 'error';
  vectors?: number[][];
  error?: string;
  id?: number;
}

function resolveWorkerPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  // When running from compiled dist/, worker.js is a sibling
  // When running from src/ (vitest), resolve to the compiled dist/ output
  if (thisDir.includes('/src/')) {
    return resolve(thisDir.replace('/src/', '/dist/'), 'worker.js');
  }
  return resolve(thisDir, 'worker.js');
}

export class WorkerEmbeddings implements EmbeddingService {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (vectors: Float32Array[]) => void;
    reject: (error: Error) => void;
  }>();
  private initPromise: Promise<void> | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    if (this.initialized) {
      return;
    }

    this.initPromise = this.startWorker();
    return this.initPromise;
  }

  private async startWorker(): Promise<void> {
    try {
      const workerPath = resolveWorkerPath();
      this.worker = new Worker(workerPath);
      await this.waitForWorkerReady();
      this.setupMessageHandler();
      this.initialized = true;
    } catch (error: unknown) {
      this.cleanupWorker();
      throw error instanceof EmbeddingError
        ? error
        : wrapError(error, 'Failed to start embedding worker');
    }
  }

  private waitForWorkerReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.worker!.off('message', onMessage);
        this.worker!.off('error', onError);
      };

      const onMessage = (message: WorkerResponse) => {
        if (message.type === 'ready') {
          cleanup();
          resolve();
        } else if (message.type === 'error' && message.id === -1) {
          cleanup();
          reject(new EmbeddingError(`Worker init failed: ${message.error}`));
        }
      };

      const onError = (error: Error) => {
        cleanup();
        reject(wrapError(error, 'Worker thread error during initialization'));
      };

      this.worker!.on('message', onMessage);
      this.worker!.on('error', onError);
      this.worker!.postMessage({ type: 'init' });
    });
  }

  private cleanupWorker(): void {
    this.initPromise = null;
    this.worker?.terminate();
    this.worker = null;
  }

  private setupMessageHandler(): void {
    this.worker!.on('message', (message: WorkerResponse) => {
      if (message.id === undefined) return;

      const pending = this.pendingRequests.get(message.id);
      if (!pending) return;

      this.pendingRequests.delete(message.id);

      if (message.type === 'result' && message.vectors) {
        const float32Arrays = message.vectors.map(v => new Float32Array(v));
        pending.resolve(float32Arrays);
      } else if (message.type === 'error') {
        pending.reject(new EmbeddingError(`Worker embedding failed: ${message.error}`));
      }
    });

    this.worker!.on('error', (error: Error) => {
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(wrapError(error, 'Worker thread error'));
        this.pendingRequests.delete(id);
      }
    });

    this.worker!.on('exit', (code: number) => {
      if (code !== 0) {
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(new EmbeddingError(`Worker exited with code ${code}`));
          this.pendingRequests.delete(id);
        }
      }
      this.initialized = false;
      this.initPromise = null;
      this.worker = null;
    });
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.initialize();

    if (!this.worker) {
      throw new EmbeddingError('Worker not available');
    }

    if (texts.length === 0) {
      return [];
    }

    const id = this.requestId++;

    return new Promise<Float32Array[]>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker!.postMessage({ type: 'embed', texts, id });
    });
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      // Reject any pending requests
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new EmbeddingError('Worker disposed'));
        this.pendingRequests.delete(id);
      }

      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
      this.initPromise = null;
    }
  }
}

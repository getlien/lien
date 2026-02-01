import type { Logger } from '@liendev/review';

type Job = () => Promise<void>;

/**
 * Simple sequential job queue.
 * Processes one job at a time to avoid OOM from concurrent embedding/indexing.
 */
export class JobQueue {
  private queue: Job[] = [];
  private processing = false;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  get size(): number {
    return this.queue.length;
  }

  get isProcessing(): boolean {
    return this.processing;
  }

  enqueue(job: Job): void {
    this.queue.push(job);
    this.logger.info(`Job queued (${this.queue.length} in queue)`);
    void this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const job = this.queue.shift()!;

    try {
      await job();
    } catch (error) {
      this.logger.error(`Job failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.processing = false;
      void this.processNext();
    }
  }
}

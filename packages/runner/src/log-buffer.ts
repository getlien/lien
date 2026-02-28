/**
 * Batched log streaming to the Lien Platform API.
 *
 * Accumulates log entries and flushes them periodically (every 5 seconds)
 * or on dispose(). Best-effort: failures log a warning but never throw.
 */

import type { Logger } from '@liendev/review';

interface LogEntry {
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  logged_at: string;
  metadata?: Record<string, unknown>;
}

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH_SIZE = 100;
const MAX_MESSAGE_LENGTH = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

export class LogBuffer {
  private entries: LogEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(
    private readonly apiUrl: string,
    private readonly serviceToken: string,
    private readonly reviewRunId: number,
    private readonly logger: Logger,
  ) {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  add(level: LogEntry['level'], message: string, metadata?: Record<string, unknown>): void {
    if (this.disposed) return;
    this.entries.push({
      level,
      message: message.slice(0, MAX_MESSAGE_LENGTH),
      logged_at: new Date().toISOString(),
      metadata,
    });
  }

  async flush(): Promise<void> {
    if (this.entries.length === 0) return;

    const toSend = this.entries.splice(0, MAX_BATCH_SIZE);
    const url = `${this.apiUrl.replace(/\/$/, '')}/api/v1/review-runs/${this.reviewRunId}/logs`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${this.serviceToken}`,
          },
          body: JSON.stringify({ logs: toSend }),
          signal: controller.signal,
        });

        if (response.ok) return;

        // 4xx (except 429) — not retryable, drop the batch
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          this.logger.warning(
            `Failed to flush logs (status ${response.status}): ${await response.text().catch(() => '')}`,
          );
          return;
        }

        this.logger.warning(`Failed to flush logs (status ${response.status}), retrying...`);
      } catch (error) {
        this.logger.warning(
          `Failed to flush logs: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        clearTimeout(timeout);
      }

      // Wait before retrying (1s, 3s)
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2_000));
      }
    }

    // All retries exhausted — re-queue entries so dispose() can try again
    this.entries.unshift(...toSend);
    this.logger.warning(`Log flush failed after ${MAX_RETRIES + 1} attempts, entries re-queued`);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Flush remaining entries — stop after one full round of retries to avoid infinite loop
    const maxFlushAttempts = Math.ceil(this.entries.length / MAX_BATCH_SIZE) + 1;
    for (let i = 0; i < maxFlushAttempts && this.entries.length > 0; i++) {
      await this.flush();
    }

    if (this.entries.length > 0) {
      this.logger.warning(`Disposing LogBuffer with ${this.entries.length} unsent log entries`);
    }
  }
}

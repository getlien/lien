/**
 * POST review run results to Laravel.
 * Best-effort delivery with retry — failure does not crash the runner.
 */

import type { Logger } from '@liendev/review';
import type { ReviewRunResult } from './types.js';

const MAX_RETRIES = 3;
const BACKOFF_MS = [1_000, 5_000, 15_000];
const REQUEST_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Transition a review run's status (e.g. pending → running).
 * Best-effort — failure logs a warning but does not block the review.
 */
export async function postReviewRunStatus(
  apiUrl: string,
  serviceToken: string,
  reviewRunId: number,
  status: 'running' | 'completed' | 'failed',
  logger: Logger,
): Promise<boolean> {
  const url = `${apiUrl.replace(/\/$/, '')}/api/v1/review-runs/${reviewRunId}/status`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ status }),
      signal: controller.signal,
    });

    if (response.ok) {
      logger.info(`Posted review run status: ${status} (review_run_id=${reviewRunId})`);
      return true;
    }

    const body = await response.text().catch(() => '');
    logger.warning(
      `POST review-runs/${reviewRunId}/status failed with ${response.status}: ${body.slice(0, 500)}`,
    );
    return false;
  } catch (error) {
    logger.warning(
      `POST review-runs/${reviewRunId}/status error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function postReviewRunResult(
  apiUrl: string,
  serviceToken: string,
  result: ReviewRunResult,
  logger: Logger,
): Promise<boolean> {
  const url = `${apiUrl.replace(/\/$/, '')}/api/v1/review-runs`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${serviceToken}`,
          'Idempotency-Key': result.idempotency_key,
        },
        body: JSON.stringify(result),
        signal: controller.signal,
      });

      if (response.ok) {
        logger.info(`Posted review run result (status ${response.status})`);
        return true;
      }

      // 4xx errors (except 429) are not retryable
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const body = await response.text().catch(() => '');
        logger.error(
          `POST /api/v1/review-runs failed with ${response.status}: ${body.slice(0, 500)}`,
        );
        return false;
      }

      logger.warning(
        `POST /api/v1/review-runs attempt ${attempt + 1}/${MAX_RETRIES} failed: ${response.status}`,
      );
    } catch (error) {
      logger.warning(
        `POST /api/v1/review-runs attempt ${attempt + 1}/${MAX_RETRIES} error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < MAX_RETRIES - 1) {
      await sleep(BACKOFF_MS[attempt]);
    }
  }

  logger.error('All retries exhausted for POST /api/v1/review-runs — result not persisted');
  return false;
}

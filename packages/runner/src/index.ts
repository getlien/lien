/**
 * NATS-based review runner — pull ONE job, process, exit.
 * K8s restarts the pod immediately (warm pool pattern).
 */

import { loadConfig } from './config.js';
import { pullOneJob } from './nats.js';
import { validateJobPayload } from './validate.js';
import { handlePRReview } from './handlers/pr-review.js';
import { handleBaseline } from './handlers/baseline.js';
import { jsonLogger } from './logger.js';

const logger = jsonLogger;

async function main(): Promise<void> {
  const config = loadConfig();

  const { nc, job } = await pullOneJob(config, logger);

  if (!job) {
    await nc.close();
    process.exit(0);
  }

  const { msg } = job;
  let handled = false;

  try {
    const payload = validateJobPayload(job.payload);
    logger.info(`Received ${payload.job_type} job for ${payload.repository.full_name}`);

    const timeout = setTimeout(() => {
      if (!handled) {
        handled = true;
        logger.error(`Job timed out after ${config.jobTimeoutMs}ms`);
        msg.nak();
        nc.close().then(() => process.exit(1));
      }
    }, config.jobTimeoutMs);

    try {
      if (payload.job_type === 'pr') {
        await handlePRReview(payload, config, logger);
      } else {
        await handleBaseline(payload, config, logger);
      }
      handled = true;
      msg.ack();
      logger.info('Job completed successfully');
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    logger.error(`Job failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!handled) {
      handled = true;
      msg.nak();
    }
  } finally {
    await nc.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error(`Fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });

/**
 * NATS-based review runner — long-lived process that pulls and processes jobs.
 * Stays connected to NATS and continuously pulls messages from JetStream.
 */

import { loadConfig } from './config.js';
import { connectAndPull } from './nats.js';
import { validateJobPayload } from './validate.js';
import { handlePRReview } from './handlers/pr-review.js';
import { handleBaseline } from './handlers/baseline.js';
import { jsonLogger } from './logger.js';

const logger = jsonLogger;

async function main(): Promise<void> {
  const config = loadConfig();

  await connectAndPull(config, logger, async (msg, payload) => {
    const validated = validateJobPayload(payload);
    logger.info(`Received ${validated.job_type} job for ${validated.repository.full_name}`);

    if (validated.job_type === 'pr') {
      await handlePRReview(validated, config, logger);
    } else {
      await handleBaseline(validated, config, logger);
    }

    logger.info('Job completed successfully');
  });
}

main().catch(error => {
  logger.error(`Fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

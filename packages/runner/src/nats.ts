/**
 * NATS JetStream long-lived consumer.
 * Connect → get consumer → loop pulling messages → invoke callback.
 */

import { connect, type NatsConnection, type JsMsg } from 'nats';
import type { Logger } from '@liendev/review';
import type { RunnerConfig } from './config.js';
import type { JobPayload } from './types.js';

function redactUrl(url: string): string {
  return url.replace(/\/\/[^@]+@/, '//***@');
}

type JobHandler = (msg: JsMsg, payload: JobPayload) => Promise<void>;

/**
 * Connect to NATS and continuously pull messages from the consumer.
 * For each message, invoke the handler. Ack on success, nak on failure.
 * Reconnects automatically on connection loss (built into nats.js client).
 * Never returns under normal operation.
 */
export async function connectAndPull(
  config: RunnerConfig,
  logger: Logger,
  handler: JobHandler,
): Promise<never> {
  const nc: NatsConnection = await connect({ servers: config.natsUrl });
  logger.info(`Connected to NATS at ${redactUrl(config.natsUrl)}`);

  const js = nc.jetstream();
  const consumer = await js.consumers.get(config.natsStream, config.natsConsumer);

  // Graceful shutdown on SIGTERM (K8s sends this before SIGKILL)
  let shuttingDown = false;
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, draining connection...');
    shuttingDown = true;
    nc.drain().then(() => process.exit(0));
  });

  while (!shuttingDown) {
    const messages = await consumer.fetch({ max_messages: 1, expires: config.pullTimeoutMs });

    for await (const msg of messages) {
      let settled = false;

      const timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          logger.error(`Job timed out after ${config.jobTimeoutMs}ms`);
          msg.nak();
        }
      }, config.jobTimeoutMs);

      try {
        const payload = msg.json<JobPayload>();
        await handler(msg, payload);
        if (!settled) {
          settled = true;
          msg.ack();
        }
      } catch (error) {
        if (!settled) {
          settled = true;
          logger.error(`Job failed: ${error instanceof Error ? error.message : String(error)}`);
          msg.nak();
        }
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
  }

  // TypeScript: loop only exits on shutdown, which calls process.exit
  await nc.close();
  process.exit(0);
}

/**
 * NATS JetStream one-shot pull.
 * Connect → get consumer → fetch 1 message → return it (caller handles ack/nak).
 */

import { connect, type NatsConnection, type JsMsg } from 'nats';
import type { Logger } from '@liendev/review';
import type { RunnerConfig } from './config.js';
import type { JobPayload } from './types.js';

export interface PulledJob {
  msg: JsMsg;
  payload: JobPayload;
}

export interface NatsHandle {
  nc: NatsConnection;
  job: PulledJob | null;
}

/**
 * Connect to NATS, pull one message from the consumer, return it.
 * Returns null job if no message is available within the timeout.
 * Caller is responsible for msg.ack()/msg.nak() and nc.close().
 * Closes the connection automatically on setup errors.
 */
export async function pullOneJob(config: RunnerConfig, logger: Logger): Promise<NatsHandle> {
  let nc: NatsConnection | undefined;

  try {
    nc = await connect({ servers: config.natsUrl });
    logger.info(`Connected to NATS at ${config.natsUrl}`);

    const js = nc.jetstream();
    const consumer = await js.consumers.get(config.natsStream, config.natsConsumer);

    const messages = await consumer.fetch({ max_messages: 1, expires: config.pullTimeoutMs });

    let job: PulledJob | null = null;
    for await (const msg of messages) {
      const raw = msg.json<unknown>();
      // Caller validates the payload — we just parse JSON here
      job = { msg, payload: raw as JobPayload };
      break;
    }

    if (!job) {
      logger.info('No messages available, exiting');
    }

    return { nc, job };
  } catch (error) {
    if (nc) {
      await nc.close().catch(() => {});
    }
    throw error;
  }
}

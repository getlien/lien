/**
 * Veille GitHub App server
 *
 * Receives PR webhook events and runs automated complexity reviews.
 * Uses @octokit/app for authentication and @octokit/webhooks for event handling.
 */

import http from 'node:http';

import { App } from '@octokit/app';
import { createNodeMiddleware } from '@octokit/webhooks';

import { consoleLogger, type Logger } from '@liendev/review';

import { loadConfig, type AppConfig } from './config.js';
import { isOrgAllowed } from './allowlist.js';
import { JobQueue } from './queue.js';
import { handlePullRequest } from './webhook-handler.js';

const logger: Logger = consoleLogger;

function createApp(config: AppConfig): App {
  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: { secret: config.webhookSecret },
  });
}

function setupWebhooks(app: App, config: AppConfig, queue: JobQueue): void {
  app.webhooks.on('pull_request', async ({ payload, octokit }) => {
    const orgId = payload.repository.owner.id;
    const repoFullName = payload.repository.full_name;

    if (!isOrgAllowed(orgId, config.allowedOrgIds, logger)) {
      return;
    }

    logger.info(`Received PR event for ${repoFullName}#${payload.pull_request.number}`);

    // Get installation token for cloning
    const installationId = (payload as Record<string, unknown>).installation;
    if (!installationId || typeof (installationId as Record<string, unknown>).id !== 'number') {
      logger.error('No valid installation ID in webhook payload');
      return;
    }
    const instId = (installationId as { id: number }).id;

    const { token } = await (octokit as any).auth({
      type: 'installation',
      installationId: instId,
    });

    queue.enqueue(async () => {
      await handlePullRequest(
        payload as any,
        token as string,
        config,
        logger,
      );
    });
  });
}

function startServer(app: App, config: AppConfig, queue: JobQueue): http.Server {
  const middleware = createNodeMiddleware(app.webhooks, {
    path: '/api/webhooks',
  });

  const server = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        queue: { size: queue.size, processing: queue.isProcessing },
      }));
      return;
    }

    // Webhook handler
    middleware(req, res);
  });

  server.listen(config.port, () => {
    logger.info(`Veille app listening on port ${config.port}`);
    logger.info(`Webhook endpoint: POST /api/webhooks`);
    logger.info(`Health check: GET /health`);
  });

  return server;
}

/**
 * Graceful shutdown — stop accepting connections and wait for queue to drain
 */
function setupGracefulShutdown(server: http.Server, queue: JobQueue): void {
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down...');
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Wait for queue to drain (with timeout)
    const timeout = setTimeout(() => {
      logger.warning('Shutdown timeout — exiting with pending jobs');
      process.exit(1);
    }, 30_000);

    const check = setInterval(() => {
      if (!queue.isProcessing && queue.size === 0) {
        clearInterval(check);
        clearTimeout(timeout);
        logger.info('Queue drained, exiting');
        process.exit(0);
      }
    }, 500);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ─── Main ────────────────────────────────────────────────────────────────────

try {
  const config = loadConfig();
  const app = createApp(config);
  const queue = new JobQueue(logger);

  setupWebhooks(app, config, queue);
  const server = startServer(app, config, queue);
  setupGracefulShutdown(server, queue);

  logger.info('Veille GitHub App started');
  if (config.allowedOrgIds.length > 0) {
    logger.info(`Allowed orgs: ${config.allowedOrgIds.join(', ')}`);
  } else {
    logger.info('All orgs allowed (no allowlist configured)');
  }
} catch (error) {
  logger.error(`Failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

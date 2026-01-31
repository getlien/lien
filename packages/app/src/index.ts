/**
 * Veille GitHub App server
 *
 * Receives PR webhook events and runs automated complexity reviews.
 * Uses @octokit/app for authentication and @octokit/webhooks for event handling.
 */

import http from 'node:http';

import { App } from '@octokit/app';
import { Webhooks, createNodeMiddleware } from '@octokit/webhooks';

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
    const installationId = (payload as any).installation?.id as number | undefined;
    if (!installationId) {
      logger.error('No installation ID in webhook payload');
      return;
    }

    const { token } = await (octokit as any).auth({
      type: 'installation',
      installationId,
    });

    queue.enqueue(async () => {
      await handlePullRequest(
        payload as any,
        octokit as any,
        token as string,
        config,
        logger,
      );
    });
  });
}

function startServer(app: App, config: AppConfig): void {
  const middleware = createNodeMiddleware(app.webhooks, {
    path: '/api/webhooks',
  });

  const server = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
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
}

// ─── Main ────────────────────────────────────────────────────────────────────

try {
  const config = loadConfig();
  const app = createApp(config);
  const queue = new JobQueue(logger);

  setupWebhooks(app, config, queue);
  startServer(app, config);

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

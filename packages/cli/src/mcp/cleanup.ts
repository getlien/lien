import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { FileWatcher } from '../watcher/index.js';
import type { LogFn } from './types.js';

/**
 * Setup cleanup handlers for graceful shutdown.
 */
export function setupCleanupHandlers(
  server: Server,
  versionCheckInterval: NodeJS.Timeout,
  gitPollInterval: NodeJS.Timeout | null,
  fileWatcher: FileWatcher | null,
  log: LogFn
): () => Promise<void> {
  let cleaningUp = false;
  return async () => {
    if (cleaningUp) return;
    cleaningUp = true;
    try {
      log('Shutting down MCP server...');
      await server.close();
      clearInterval(versionCheckInterval);
      if (gitPollInterval) clearInterval(gitPollInterval);
      if (fileWatcher) await fileWatcher.stop();
    } finally {
      process.exit(0);
    }
  };
}

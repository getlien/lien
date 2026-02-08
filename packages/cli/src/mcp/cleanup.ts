import { FileWatcher } from '../watcher/index.js';
import type { LogFn } from './types.js';

/**
 * Setup cleanup handlers for graceful shutdown.
 */
export function setupCleanupHandlers(
  versionCheckInterval: NodeJS.Timeout,
  gitPollInterval: NodeJS.Timeout | null,
  fileWatcher: FileWatcher | null,
  log: LogFn
): () => Promise<void> {
  return async () => {
    try {
      log('Shutting down MCP server...');
      clearInterval(versionCheckInterval);
      if (gitPollInterval) clearInterval(gitPollInterval);
      if (fileWatcher) await fileWatcher.stop();
    } finally {
      process.exit(0);
    }
  };
}

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tools } from './tools.js';
import { toolHandlers } from './handlers/index.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { GitStateTracker } from '../git/tracker.js';
import { indexMultipleFiles, indexSingleFile } from '../indexer/incremental.js';
import { configService } from '../config/service.js';
import { ManifestManager } from '../indexer/manifest.js';
import { isGitAvailable, isGitRepo } from '../git/utils.js';
import { FileWatcher } from '../watcher/index.js';
import { VERSION_CHECK_INTERVAL_MS } from '../constants.js';
import { LienError, LienErrorCode } from '../errors/index.js';
import type { ToolContext } from './types.js';

// Get version from package.json dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

let packageJson: { name: string; version: string };
try {
  packageJson = require(join(__dirname, '../package.json'));
} catch {
  packageJson = require(join(__dirname, '../../package.json'));
}

export interface MCPServerOptions {
  rootDir: string;
  verbose?: boolean;
  watch?: boolean;
}

export async function startMCPServer(options: MCPServerOptions): Promise<void> {
  const { rootDir, verbose, watch } = options;

  // Log to stderr (stdout is reserved for MCP protocol)
  const log = (message: string) => {
    if (verbose) {
      console.error(`[Lien MCP] ${message}`);
    }
  };

  log('Initializing MCP server...');

  // Initialize embeddings and vector DB
  const embeddings = new LocalEmbeddings();
  const vectorDB = new VectorDB(rootDir);

  try {
    log('Loading embedding model...');
    await embeddings.initialize();

    log('Loading vector database...');
    await vectorDB.initialize();

    log('Embeddings and vector DB ready');
  } catch (error) {
    console.error(`Failed to initialize: ${error}`);
    process.exit(1);
  }

  // Create MCP server
  const server = new Server(
    {
      name: 'lien',
      version: packageJson.version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  // Helper function to check version and reconnect if needed
  const checkAndReconnect = async () => {
    try {
      const versionChanged = await vectorDB.checkVersion();
      if (versionChanged) {
        log('Index version changed, reconnecting to database...');
        await vectorDB.reconnect();
        log('Reconnected to updated index');
      }
    } catch (error) {
      // Log but don't throw - fall back to existing connection
      log(`Version check failed: ${error}`);
    }
  };

  // Helper to get current index metadata for responses
  const getIndexMetadata = () => ({
    indexVersion: vectorDB.getCurrentVersion(),
    indexDate: vectorDB.getVersionDate(),
  });

  // Start background polling for version changes (every 2 seconds)
  // This ensures we reconnect as soon as possible after reindex, even if no tool calls are made
  const versionCheckInterval = setInterval(async () => {
    await checkAndReconnect();
  }, VERSION_CHECK_INTERVAL_MS);

  // Load configuration for auto-indexing, git detection, and file watching
  const config = await configService.load(rootDir);

  // Create tool context for handlers
  const toolContext: ToolContext = {
    vectorDB,
    embeddings,
    config,
    rootDir,
    log,
    checkAndReconnect,
    getIndexMetadata,
  };

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    log(`Handling tool call: ${name}`);

    // Look up handler in registry
    const handler = toolHandlers[name];

    if (!handler) {
      const error = new LienError(
        `Unknown tool: ${name}`,
        LienErrorCode.INVALID_INPUT,
        { requestedTool: name, availableTools: tools.map(t => t.name) },
        'medium',
        false,
        false
      );

      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify(error.toJSON(), null, 2),
        }],
      };
    }

    try {
      return await handler(args, toolContext);
    } catch (error) {
      // Handle errors from handlers
      if (error instanceof LienError) {
        return {
          isError: true,
          content: [{
            type: 'text' as const,
            text: JSON.stringify(error.toJSON(), null, 2),
          }],
        };
      }

      // Unexpected error
      console.error(`Unexpected error handling tool call ${name}:`, error);
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            code: LienErrorCode.INTERNAL_ERROR,
            tool: name,
          }, null, 2),
        }],
      };
    }
  });

  // Check if this is the first run (no data in index) and auto-index if needed
  const hasIndex = await vectorDB.hasData();

  if (!hasIndex && config.mcp.autoIndexOnFirstRun) {
    log('📦 No index found - running initial indexing...');
    log('⏱️  This may take 5-20 minutes depending on project size');

    try {
      // Import indexCodebase function
      const { indexCodebase } = await import('../indexer/index.js');
      await indexCodebase({ rootDir, verbose: true });
      log('✅ Initial indexing complete!');
    } catch (error) {
      log(`⚠️  Initial indexing failed: ${error}`);
      log('You can manually run: lien index');
      // Don't exit - server can still start, just won't have data
    }
  } else if (!hasIndex) {
    log('⚠️  No index found. Auto-indexing is disabled in config.');
    log('Run "lien index" to index your codebase.');
  }

  // Initialize git detection if enabled
  let gitTracker: GitStateTracker | null = null;
  let gitPollInterval: NodeJS.Timeout | null = null;
  let fileWatcher: FileWatcher | null = null;

  if (config.gitDetection.enabled) {
    const gitAvailable = await isGitAvailable();
    const isRepo = await isGitRepo(rootDir);

    if (gitAvailable && isRepo) {
      log('✓ Detected git repository');
      gitTracker = new GitStateTracker(rootDir, vectorDB.dbPath);

      // Check for git changes on startup
      try {
        log('Checking for git changes...');
        const changedFiles = await gitTracker.initialize();

        if (changedFiles && changedFiles.length > 0) {
          log(`🌿 Git changes detected: ${changedFiles.length} files changed`);
          log('Reindexing changed files...');

          const count = await indexMultipleFiles(
            changedFiles,
            vectorDB,
            embeddings,
            config,
            { verbose }
          );

          log(`✓ Reindexed ${count} files`);
        } else {
          log('✓ Index is up to date with git state');
        }
      } catch (error) {
        log(`Warning: Failed to check git state on startup: ${error}`);
      }

      // Start background polling for git changes
      log(`✓ Git detection enabled (checking every ${config.gitDetection.pollIntervalMs / 1000}s)`);

      gitPollInterval = setInterval(async () => {
        try {
          const changedFiles = await gitTracker!.detectChanges();

          if (changedFiles && changedFiles.length > 0) {
            log(`🌿 Git change detected: ${changedFiles.length} files changed`);
            log('Reindexing in background...');

            // Don't await - run in background
            indexMultipleFiles(
              changedFiles,
              vectorDB,
              embeddings,
              config,
              { verbose }
            ).then(count => {
              log(`✓ Background reindex complete: ${count} files`);
            }).catch(error => {
              log(`Warning: Background reindex failed: ${error}`);
            });
          }
        } catch (error) {
          log(`Warning: Git detection check failed: ${error}`);
        }
      }, config.gitDetection.pollIntervalMs);
    } else {
      if (!gitAvailable) {
        log('Git not available - git detection disabled');
      } else if (!isRepo) {
        log('Not a git repository - git detection disabled');
      }
    }
  } else {
    log('Git detection disabled by configuration');
  }

  // Initialize file watching if enabled
  // Priority: CLI flag if explicitly set (true/false), otherwise use config default
  const fileWatchingEnabled = watch !== undefined ? watch : config.fileWatching.enabled;

  if (fileWatchingEnabled) {
    log('👀 Starting file watcher...');
    fileWatcher = new FileWatcher(rootDir, config);

    try {
      await fileWatcher.start(async (event) => {
        const { type, filepath } = event;

        if (type === 'unlink') {
          // File deleted
          log(`🗑️  File deleted: ${filepath}`);
          try {
            await vectorDB.deleteByFile(filepath);

            // Update manifest
            const manifest = new ManifestManager(vectorDB.dbPath);
            await manifest.removeFile(filepath);

            log(`✓ Removed ${filepath} from index`);
          } catch (error) {
            log(`Warning: Failed to remove ${filepath}: ${error}`);
          }
        } else {
          // File added or changed
          const action = type === 'add' ? 'added' : 'changed';
          log(`📝 File ${action}: ${filepath}`);

          // Reindex in background
          indexSingleFile(filepath, vectorDB, embeddings, config, { verbose })
            .catch((error) => {
              log(`Warning: Failed to reindex ${filepath}: ${error}`);
            });
        }
      });

      const watchedCount = fileWatcher.getWatchedFiles().length;
      log(`✓ File watching enabled (watching ${watchedCount} files)`);
    } catch (error) {
      log(`Warning: Failed to start file watcher: ${error}`);
      fileWatcher = null;
    }
  }

  // Handle shutdown gracefully
  const cleanup = async () => {
    log('Shutting down MCP server...');
    clearInterval(versionCheckInterval);
    if (gitPollInterval) {
      clearInterval(gitPollInterval);
    }
    if (fileWatcher) {
      await fileWatcher.stop();
    }
    process.exit(0);
  };

  // Listen for termination signals
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Connect to stdio transport
  const transport = new StdioServerTransport();

  // Use SDK's transport callbacks for parent process detection
  // This avoids conflicts with the transport's stdin management
  transport.onclose = () => {
    log('Transport closed, parent process likely terminated');
    cleanup().catch(() => process.exit(0));
  };

  transport.onerror = (error) => {
    log(`Transport error: ${error}`);
    // Transport will close after error, onclose will handle cleanup
  };

  await server.connect(transport);

  log('MCP server started and listening on stdio');
}

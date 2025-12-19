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
import {
  LocalEmbeddings,
  GitStateTracker,
  indexMultipleFiles,
  indexSingleFile,
  ManifestManager,
  isGitAvailable,
  isGitRepo,
  VERSION_CHECK_INTERVAL_MS,
  DEFAULT_GIT_POLL_INTERVAL_MS,
  LienError,
  LienErrorCode,
  createVectorDB,
  VectorDBInterface,
} from '@liendev/core';
import { FileWatcher } from '../watcher/index.js';
import type { ToolContext, LogFn, LogLevel } from './types.js';

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

/**
 * Initialize embeddings and vector database.
 * Uses factory to select backend (LanceDB or Qdrant) based on config.
 */
async function initializeDatabase(
  rootDir: string,
  log: LogFn
): Promise<{ embeddings: LocalEmbeddings; vectorDB: VectorDBInterface }> {
  const embeddings = new LocalEmbeddings();
  
  // Create vector DB using global config (auto-detects backend and orgId)
  const vectorDB = await createVectorDB(rootDir);

  log('Loading embedding model...');
  await embeddings.initialize();

  log('Loading vector database...');
  await vectorDB.initialize();

  log('Embeddings and vector DB ready');
  return { embeddings, vectorDB };
}

/**
 * Run auto-indexing if needed (first run with no index).
 * Always enabled by default - no config needed.
 */
async function handleAutoIndexing(
  vectorDB: VectorDBInterface,
  rootDir: string,
  log: LogFn
): Promise<void> {
  const hasIndex = await vectorDB.hasData();

  if (!hasIndex) {
    log('📦 No index found - running initial indexing...');
    log('⏱️  This may take 5-20 minutes depending on project size');

    try {
      const { indexCodebase } = await import('@liendev/core');
      await indexCodebase({ rootDir, verbose: true });
      log('✅ Initial indexing complete!');
    } catch (error) {
      log(`⚠️  Initial indexing failed: ${error}`, 'warning');
      log('You can manually run: lien index', 'warning');
    }
  }
}

/**
 * Setup git detection and background polling.
 * Always enabled by default if git is available.
 */
async function setupGitDetection(
  rootDir: string,
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  verbose: boolean | undefined,
  log: LogFn
): Promise<{ gitTracker: GitStateTracker | null; gitPollInterval: NodeJS.Timeout | null }> {
  const gitAvailable = await isGitAvailable();
  const isRepo = await isGitRepo(rootDir);

  if (!gitAvailable) {
    log('Git not available - git detection disabled');
    return { gitTracker: null, gitPollInterval: null };
  }
  if (!isRepo) {
    log('Not a git repository - git detection disabled');
    return { gitTracker: null, gitPollInterval: null };
  }

  log('✓ Detected git repository');
  const gitTracker = new GitStateTracker(rootDir, vectorDB.dbPath);

  // Check for git changes on startup
  try {
    log('Checking for git changes...');
    const changedFiles = await gitTracker.initialize();

    if (changedFiles && changedFiles.length > 0) {
      log(`🌿 Git changes detected: ${changedFiles.length} files changed`);
      const count = await indexMultipleFiles(changedFiles, vectorDB, embeddings, { verbose });
      log(`✓ Reindexed ${count} files`);
    } else {
      log('✓ Index is up to date with git state');
    }
  } catch (error) {
    log(`Failed to check git state on startup: ${error}`, 'warning');
  }

  // Start background polling (use default interval)
  const pollIntervalSeconds = DEFAULT_GIT_POLL_INTERVAL_MS / 1000;
  log(`✓ Git detection enabled (checking every ${pollIntervalSeconds}s)`);

  const gitPollInterval = setInterval(async () => {
    try {
      const changedFiles = await gitTracker.detectChanges();
      if (changedFiles && changedFiles.length > 0) {
        log(`🌿 Git change detected: ${changedFiles.length} files changed`);
        indexMultipleFiles(changedFiles, vectorDB, embeddings, { verbose })
          .then(count => log(`✓ Background reindex complete: ${count} files`))
          .catch(error => log(`Background reindex failed: ${error}`, 'warning'));
      }
    } catch (error) {
      log(`Git detection check failed: ${error}`, 'warning');
    }
  }, DEFAULT_GIT_POLL_INTERVAL_MS);

  return { gitTracker, gitPollInterval };
}

/**
 * Setup file watching for real-time updates.
 * Enabled by default (or via --watch flag).
 */
async function setupFileWatching(
  watch: boolean | undefined,
  rootDir: string,
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  verbose: boolean | undefined,
  log: LogFn
): Promise<FileWatcher | null> {
  // Enable by default, or use --watch flag
  const fileWatchingEnabled = watch !== undefined ? watch : true;
  if (!fileWatchingEnabled) {
    return null;
  }

  log('👀 Starting file watcher...');
  const fileWatcher = new FileWatcher(rootDir);

  try {
    await fileWatcher.start(async (event) => {
      const { type, filepath } = event;

      if (type === 'unlink') {
        log(`🗑️  File deleted: ${filepath}`);
        try {
          await vectorDB.deleteByFile(filepath);
          const manifest = new ManifestManager(vectorDB.dbPath);
          await manifest.removeFile(filepath);
          log(`✓ Removed ${filepath} from index`);
        } catch (error) {
          log(`Failed to remove ${filepath}: ${error}`, 'warning');
        }
      } else {
        const action = type === 'add' ? 'added' : 'changed';
        log(`📝 File ${action}: ${filepath}`);
        indexSingleFile(filepath, vectorDB, embeddings, { verbose })
          .catch((error) => log(`Failed to reindex ${filepath}: ${error}`, 'warning'));
      }
    });

    log(`✓ File watching enabled (watching ${fileWatcher.getWatchedFiles().length} files)`);
    return fileWatcher;
  } catch (error) {
    log(`Failed to start file watcher: ${error}`, 'warning');
    return null;
  }
}

/**
 * Register tool call handler on the MCP server.
 */
function registerToolCallHandler(
  server: Server,
  toolContext: ToolContext,
  log: LogFn
): void {
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log(`Handling tool call: ${name}`);

    const handler = toolHandlers[name];
    if (!handler) {
      const error = new LienError(
        `Unknown tool: ${name}`,
        LienErrorCode.INVALID_INPUT,
        { requestedTool: name, availableTools: tools.map(t => t.name) },
        'medium', false, false
      );
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(error.toJSON(), null, 2) }] };
    }

    try {
      return await handler(args, toolContext);
    } catch (error) {
      if (error instanceof LienError) {
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(error.toJSON(), null, 2) }] };
      }
      console.error(`Unexpected error handling tool call ${name}:`, error);
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error', code: LienErrorCode.INTERNAL_ERROR, tool: name }, null, 2),
        }],
      };
    }
  });
}

export async function startMCPServer(options: MCPServerOptions): Promise<void> {
  const { rootDir, verbose, watch } = options;
  
  // Early log function before server is ready (falls back to stderr)
  const earlyLog: LogFn = (message, level = 'info') => { 
    if (verbose || level === 'warning' || level === 'error') {
      console.error(`[Lien MCP] [${level}] ${message}`); 
    }
  };

  earlyLog('Initializing MCP server...');

  // Initialize core components
  const { embeddings, vectorDB } = await initializeDatabase(rootDir, earlyLog).catch(error => {
    console.error(`Failed to initialize: ${error}`);
    process.exit(1);
  });
  
  // Create MCP server with logging capability
  const server = new Server(
    { name: 'lien', version: packageJson.version },
    { capabilities: { tools: {}, logging: {} } }
  );

  // Create proper log function that uses MCP logging notifications
  // - In verbose mode: all levels (debug, info, notice, warning, error)
  // - In non-verbose mode: only warnings and errors
  const log: LogFn = (message, level: LogLevel = 'info') => {
    if (verbose || level === 'warning' || level === 'error') {
      server.sendLoggingMessage({
        level,
        logger: 'lien',
        data: message,
      }).catch(() => {
        // Fallback to stderr if MCP notification fails (e.g., not connected yet)
        console.error(`[Lien MCP] [${level}] ${message}`);
      });
    }
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Version check helpers
  const checkAndReconnect = async () => {
    try {
      if (await vectorDB.checkVersion()) {
        log('Index version changed, reconnecting...');
        await vectorDB.reconnect();
      }
    } catch (error) {
      log(`Version check failed: ${error}`, 'warning');
    }
  };

  const getIndexMetadata = () => ({
    indexVersion: vectorDB.getCurrentVersion(),
    indexDate: vectorDB.getVersionDate(),
  });

  const versionCheckInterval = setInterval(checkAndReconnect, VERSION_CHECK_INTERVAL_MS);

  // Create tool context (no config needed - everything uses defaults or auto-detection)
  const toolContext: ToolContext = { vectorDB, embeddings, rootDir, log, checkAndReconnect, getIndexMetadata };
  
  // Register handlers and setup features
  registerToolCallHandler(server, toolContext, log);
  await handleAutoIndexing(vectorDB, rootDir, log);
  const { gitPollInterval } = await setupGitDetection(rootDir, vectorDB, embeddings, verbose, log);
  const fileWatcher = await setupFileWatching(watch, rootDir, vectorDB, embeddings, verbose, log);

  // Cleanup handler
  const cleanup = async () => {
    log('Shutting down MCP server...');
    clearInterval(versionCheckInterval);
    if (gitPollInterval) clearInterval(gitPollInterval);
    if (fileWatcher) await fileWatcher.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Connect transport
  const transport = new StdioServerTransport();
  
  transport.onclose = () => { 
    log('Transport closed'); 
    cleanup().catch(() => process.exit(0)); 
  };
  transport.onerror = (error) => {
    log(`Transport error: ${error}`);
  };

  try {
    await server.connect(transport);
    log('MCP server started and listening on stdio');
  } catch (error) {
    console.error(`Failed to connect MCP transport: ${error}`);
    process.exit(1);
  }
}

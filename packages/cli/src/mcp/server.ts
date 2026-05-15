import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import type { EmbeddingService, VectorDBInterface, GitState } from '@liendev/core';
import {
  WorkerEmbeddings,
  VERSION_CHECK_INTERVAL_MS,
  createVectorDB,
  isGitRepo,
} from '@liendev/core';
import { FileWatcher } from '../watcher/index.js';
import { createMCPServerConfig, registerMCPHandlers } from './server-config.js';
import { createReindexStateManager } from './reindex-state-manager.js';
import type { ToolContext, LogFn, LogLevel } from './types.js';
import { setupGitDetection } from './git-detection.js';
import { createFileChangeHandler } from './file-change-handler.js';
import { setupCleanupHandlers } from './cleanup.js';

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
  log: LogFn,
): Promise<{ embeddings: EmbeddingService; vectorDB: VectorDBInterface }> {
  const embeddings = new WorkerEmbeddings();

  // Create vector DB using global config (auto-detects backend and orgId)
  log('Creating vector database...');
  const vectorDB = await createVectorDB(rootDir);

  // Verify we got a valid instance
  if (!vectorDB) {
    throw new Error('createVectorDB returned undefined or null');
  }

  if (typeof vectorDB.initialize !== 'function') {
    throw new Error(
      `Invalid vectorDB instance: ${vectorDB.constructor?.name || 'unknown'}. Expected VectorDBInterface but got: ${JSON.stringify(Object.keys(vectorDB))}`,
    );
  }

  log('Loading embedding model...');
  await embeddings.initialize();

  log('Loading vector database...');
  await vectorDB.initialize();

  log('Embeddings and vector DB ready');
  return { embeddings, vectorDB };
}

// Walk parent directories to detect whether startDir is inside a git work tree.
// Plain isGitRepo only checks the exact dir, so it misses subdir invocations
// (e.g. opening Claude Code in a monorepo package).
async function isInsideGitWorkTree(startDir: string): Promise<boolean> {
  let cur = resolve(startDir);
  while (true) {
    if (await isGitRepo(cur)) return true;
    const parent = dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

/**
 * Run auto-indexing if needed (first run with no index).
 * Always enabled by default - no config needed.
 *
 * The actual indexCodebase call is fired without await — initial indexing can
 * take minutes, and blocking before server.connect() would time out the MCP
 * handshake. Tools return empty results until the background index lands.
 */
async function handleAutoIndexing(
  vectorDB: VectorDBInterface,
  rootDir: string,
  log: LogFn,
): Promise<void> {
  const hasIndex = await vectorDB.hasData();
  if (hasIndex) return;

  const forceIndex = process.env.LIEN_FORCE_INDEX === '1';
  if (!forceIndex && !(await isInsideGitWorkTree(rootDir))) {
    log(
      `Skipped auto-indexing: ${rootDir} is not inside a git work tree. ` +
        `Set LIEN_FORCE_INDEX=1 to index anyway.`,
      'warning',
    );
    return;
  }

  log('📦 No index found - running initial indexing in the background...');
  log('⏱️  Server is ready; tools will return empty results until indexing completes.');

  const { indexCodebase } = await import('@liendev/core');
  void indexCodebase({ rootDir, verbose: true })
    .then(() => log('✅ Initial indexing complete!'))
    .catch(error => {
      log(`⚠️  Initial indexing failed: ${error}`, 'warning');
      log('You can manually run: lien index', 'warning');
    });
}

/**
 * Setup file watching for real-time updates.
 * Enabled by default (or via --watch flag).
 */
async function setupFileWatching(
  watch: boolean | undefined,
  rootDir: string,
  vectorDB: VectorDBInterface,
  embeddings: EmbeddingService,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  checkAndReconnect: () => Promise<void>,
): Promise<FileWatcher | null> {
  // Enable by default, or use --watch flag
  const fileWatchingEnabled = watch !== undefined ? watch : true;
  if (!fileWatchingEnabled) {
    return null;
  }

  log('👀 Starting file watcher...');
  const fileWatcher = new FileWatcher(rootDir);

  try {
    const handler = createFileChangeHandler(
      rootDir,
      vectorDB,
      embeddings,
      log,
      reindexStateManager,
      checkAndReconnect,
    );
    await fileWatcher.start(handler);
    log(`✓ File watching enabled (watching ${fileWatcher.getWatchedFiles().length} files)`);
    return fileWatcher;
  } catch (error) {
    log(`Failed to start file watcher: ${error}`, 'warning');
    return null;
  }
}

/**
 * Setup transport for MCP server.
 */
function setupTransport(log: LogFn): StdioServerTransport {
  const transport = new StdioServerTransport();

  transport.onerror = error => {
    log(`Transport error: ${error}`, 'warning');
  };

  return transport;
}

/**
 * Version checking result with index metadata getter
 */
interface VersionCheckingResult {
  interval: NodeJS.Timeout;
  checkAndReconnect: () => Promise<void>;
  getIndexMetadata: () => {
    indexVersion: number;
    indexDate: string;
    reindexInProgress?: boolean;
    pendingFileCount?: number;
    lastReindexDurationMs?: number | null;
    msSinceLastReindex?: number | null;
    indexedBranch?: string | null;
    indexedCommit?: string | null;
  };
}

/**
 * Setup version checking and reconnection logic.
 *
 * @param getGitState - Returns the GitStateTracker's current state if git
 *   detection is active for this rootDir. Wired in by `startMCPServer` after
 *   `setupGitDetection` populates the tracker.
 */
function setupVersionChecking(
  vectorDB: VectorDBInterface,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  getGitState: () => GitState | null,
): VersionCheckingResult {
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

  const getIndexMetadata = () => {
    const reindex = reindexStateManager.getState();
    const gitState = getGitState();
    return {
      indexVersion: vectorDB.getCurrentVersion(),
      indexDate: vectorDB.getVersionDate(),
      reindexInProgress: reindex.inProgress,
      pendingFileCount: reindex.pendingFiles.length,
      lastReindexDurationMs: reindex.lastReindexDurationMs,
      // Note: msSinceLastReindex is computed at call time, not cached.
      // This ensures AI assistants always get current freshness info.
      msSinceLastReindex: reindex.lastReindexTimestamp
        ? Date.now() - reindex.lastReindexTimestamp
        : null,
      indexedBranch: gitState?.branch ?? null,
      indexedCommit: gitState?.commit ?? null,
    };
  };

  const interval = setInterval(checkAndReconnect, VERSION_CHECK_INTERVAL_MS);

  return { interval, checkAndReconnect, getIndexMetadata };
}

/**
 * Create early log function before server is ready (falls back to stderr).
 */
function createEarlyLog(verbose: boolean | undefined): LogFn {
  return (message, level = 'info') => {
    if (verbose || level === 'warning' || level === 'error') {
      console.error(`[Lien MCP] [${level}] ${message}`);
    }
  };
}

/**
 * Create MCP log function that uses server logging notifications.
 * - In verbose mode: all levels (debug, info, notice, warning, error)
 * - In non-verbose mode: only warnings and errors
 */
function createMCPLog(server: Server, verbose: boolean | undefined): LogFn {
  return (message, level: LogLevel = 'info') => {
    if (verbose || level === 'warning' || level === 'error') {
      server
        .sendLoggingMessage({
          level,
          logger: 'lien',
          data: message,
        })
        .catch(() => {
          // Fallback to stderr if MCP notification fails (e.g., not connected yet)
          console.error(`[Lien MCP] [${level}] ${message}`);
        });
    }
  };
}

/**
 * Initialize core components (embeddings and vector database) with error handling.
 */
async function initializeComponents(
  rootDir: string,
  earlyLog: LogFn,
): Promise<{ embeddings: EmbeddingService; vectorDB: VectorDBInterface }> {
  try {
    const result = await initializeDatabase(rootDir, earlyLog);

    return result;
  } catch (error) {
    console.error(`Failed to initialize: ${error}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Create and configure MCP server instance.
 */
function createMCPServer(): Server {
  const serverConfig = createMCPServerConfig('lien', packageJson.version);
  return new Server(
    { name: serverConfig.name, version: serverConfig.version },
    {
      capabilities: serverConfig.capabilities,
      instructions: serverConfig.instructions,
    },
  );
}

/**
 * Setup server features and connect transport.
 */
async function setupAndConnectServer(
  server: Server,
  toolContext: ToolContext,
  log: LogFn,
  versionCheckInterval: NodeJS.Timeout,
  reindexStateManager: ReturnType<typeof createReindexStateManager>,
  options: {
    rootDir: string;
    watch: boolean | undefined;
    onGitTrackerReady: (state: () => GitState | null) => void;
  },
): Promise<void> {
  const { rootDir, watch, onGitTrackerReady } = options;
  const { vectorDB, embeddings } = toolContext;

  // Register all MCP handlers
  registerMCPHandlers(server, toolContext, log);

  // Setup features
  await handleAutoIndexing(vectorDB, rootDir, log);

  // Setup file watching first (needed for event-driven git detection)
  const fileWatcher = await setupFileWatching(
    watch,
    rootDir,
    vectorDB,
    embeddings,
    log,
    reindexStateManager,
    toolContext.checkAndReconnect,
  );

  // Setup git detection (will use event-driven approach if fileWatcher is available)
  const { gitTracker, gitPollInterval } = await setupGitDetection(
    rootDir,
    vectorDB,
    embeddings,
    log,
    reindexStateManager,
    fileWatcher,
    toolContext.checkAndReconnect,
  );
  onGitTrackerReady(() => (gitTracker ? gitTracker.getState() : null));

  // Setup cleanup handlers
  const cleanup = setupCleanupHandlers(
    server,
    versionCheckInterval,
    gitPollInterval,
    fileWatcher,
    log,
  );
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Setup and connect transport
  const transport = setupTransport(log);
  transport.onclose = () => {
    cleanup().catch(() => process.exit(0));
  };

  try {
    await server.connect(transport);
    log('MCP server started and listening on stdio');
  } catch (error) {
    console.error(`Failed to connect MCP transport: ${error}`);
    process.exit(1);
  }
}

export async function startMCPServer(options: MCPServerOptions): Promise<void> {
  const { rootDir, verbose, watch } = options;

  const earlyLog = createEarlyLog(verbose);
  earlyLog('Initializing MCP server...');

  const { embeddings, vectorDB } = await initializeComponents(rootDir, earlyLog);
  const server = createMCPServer();
  const log = createMCPLog(server, verbose);

  // Create reindex state manager
  const reindexStateManager = createReindexStateManager();

  // Holder for the GitStateTracker state getter. setupGitDetection runs later
  // inside setupAndConnectServer; until then, indexed-ref fields read as null.
  let getGitState: () => GitState | null = () => null;

  const {
    interval: versionCheckInterval,
    checkAndReconnect,
    getIndexMetadata,
  } = setupVersionChecking(vectorDB, log, reindexStateManager, () => getGitState());
  const toolContext: ToolContext = {
    vectorDB,
    embeddings,
    rootDir,
    log,
    checkAndReconnect,
    getIndexMetadata,
    getReindexState: () => reindexStateManager.getState(),
  };

  await setupAndConnectServer(server, toolContext, log, versionCheckInterval, reindexStateManager, {
    rootDir,
    watch,
    onGitTrackerReady: state => {
      getGitState = state;
    },
  });
}

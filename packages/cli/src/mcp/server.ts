import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
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
  createVectorDB,
  VectorDBInterface,
} from '@liendev/core';
import { FileWatcher, type FileChangeHandler } from '../watcher/index.js';
import { createMCPServerConfig, registerMCPHandlers } from './server-config.js';
import { createReindexStateManager } from './reindex-state-manager.js';
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
  log('Creating vector database...');
  const vectorDB = await createVectorDB(rootDir);
  
  // Verify we got a valid instance
  if (!vectorDB) {
    throw new Error('createVectorDB returned undefined or null');
  }
  
  if (typeof vectorDB.initialize !== 'function') {
    throw new Error(`Invalid vectorDB instance: ${vectorDB.constructor?.name || 'unknown'}. Expected VectorDBInterface but got: ${JSON.stringify(Object.keys(vectorDB))}`);
  }

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
 * Handle git changes detected on startup
 */
async function handleGitStartup(
  gitTracker: GitStateTracker,
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
): Promise<void> {
  log('Checking for git changes...');
  const changedFiles = await gitTracker.initialize();

  if (changedFiles && changedFiles.length > 0) {
    const startTime = Date.now();
    reindexStateManager.startReindex(changedFiles);
    log(`🌿 Git changes detected: ${changedFiles.length} files changed`);
    
    try {
      const count = await indexMultipleFiles(changedFiles, vectorDB, embeddings, { verbose });
      const duration = Date.now() - startTime;
      reindexStateManager.completeReindex(duration);
      log(`✓ Reindexed ${count} files in ${duration}ms`);
    } catch (error) {
      reindexStateManager.failReindex();
      throw error;
    }
  } else {
    log('✓ Index is up to date with git state');
  }
}

/**
 * Create background polling interval for git changes.
 * Uses reindexStateManager to track and prevent concurrent operations.
 */
function createGitPollInterval(
  gitTracker: GitStateTracker,
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const changedFiles = await gitTracker.detectChanges();
      if (changedFiles && changedFiles.length > 0) {
        // Check if a reindex is already in progress (file watch or previous git poll)
        if (reindexStateManager.getState().inProgress) {
          log('Background reindex already in progress, skipping git poll cycle', 'debug');
          return;
        }
        
        const startTime = Date.now();
        reindexStateManager.startReindex(changedFiles);
        log(`🌿 Git change detected: ${changedFiles.length} files changed`);
        
        try {
          const count = await indexMultipleFiles(changedFiles, vectorDB, embeddings, { verbose });
          const duration = Date.now() - startTime;
          reindexStateManager.completeReindex(duration);
          log(`✓ Background reindex complete: ${count} files in ${duration}ms`);
        } catch (error) {
          reindexStateManager.failReindex();
          log(`Git background reindex failed: ${error}`, 'warning');
        }
      }
    } catch (error) {
      log(`Git detection check failed: ${error}`, 'warning');
    }
  }, DEFAULT_GIT_POLL_INTERVAL_MS);
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
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
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
    await handleGitStartup(gitTracker, vectorDB, embeddings, verbose, log, reindexStateManager);
  } catch (error) {
    log(`Failed to check git state on startup: ${error}`, 'warning');
  }

  // Start background polling
  const pollIntervalSeconds = DEFAULT_GIT_POLL_INTERVAL_MS / 1000;
  log(`✓ Git detection enabled (checking every ${pollIntervalSeconds}s)`);
  const gitPollInterval = createGitPollInterval(gitTracker, vectorDB, embeddings, verbose, log, reindexStateManager);

  return { gitTracker, gitPollInterval };
}

/**
 * Handle file deletion (remove from index and manifest)
 */
async function handleFileDeletion(
  filepath: string,
  vectorDB: VectorDBInterface,
  log: LogFn
): Promise<void> {
  log(`🗑️  File deleted: ${filepath}`);
  try {
    await vectorDB.deleteByFile(filepath);
    const manifest = new ManifestManager(vectorDB.dbPath);
    await manifest.removeFile(filepath);
    log(`✓ Removed ${filepath} from index`);
  } catch (error) {
    log(`Failed to remove ${filepath}: ${error}`, 'warning');
  }
}

/**
 * Handle batch file changes (reindex multiple files)
 */
async function handleBatchChanges(
  filesToIndex: string[],
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
): Promise<void> {
  const startTime = Date.now();
  reindexStateManager.startReindex(filesToIndex);
  log(`📁 ${filesToIndex.length} file(s) changed, reindexing...`);
  
  try {
    const count = await indexMultipleFiles(filesToIndex, vectorDB, embeddings, { verbose });
    const duration = Date.now() - startTime;
    reindexStateManager.completeReindex(duration);
    log(`✓ Reindexed ${count} file(s) in ${duration}ms`);
  } catch (error) {
    reindexStateManager.failReindex();
    log(`File watch reindex failed: ${error}`, 'warning');
  }
}

/**
 * Handle single file change (reindex one file)
 */
async function handleSingleFileChange(
  filepath: string,
  type: 'add' | 'change',
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
): Promise<void> {
  const action = type === 'add' ? 'added' : 'changed';
  const startTime = Date.now();
  reindexStateManager.startReindex([filepath]);
  log(`📝 File ${action}: ${filepath}`);
  
  try {
    await indexSingleFile(filepath, vectorDB, embeddings, { verbose });
    const duration = Date.now() - startTime;
    reindexStateManager.completeReindex(duration);
  } catch (error) {
    reindexStateManager.failReindex();
    log(`Failed to reindex ${filepath}: ${error}`, 'warning');
  }
}

/**
 * Create file change event handler
 */
function createFileChangeHandler(
  vectorDB: VectorDBInterface,
  embeddings: LocalEmbeddings,
  verbose: boolean | undefined,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
): FileChangeHandler {
  return async (event) => {
    const { type } = event;

    if (type === 'batch') {
      // Handle batched changes
      const filesToIndex = [...(event.added || []), ...(event.modified || [])];
      
      if (filesToIndex.length > 0) {
        await handleBatchChanges(filesToIndex, vectorDB, embeddings, verbose, log, reindexStateManager);
      }
      
      // Handle deletions
      for (const deleted of event.deleted || []) {
        await handleFileDeletion(deleted, vectorDB, log);
      }
    } else if (type === 'unlink') {
      // Fallback for single file deletion (backwards compatibility)
      await handleFileDeletion(event.filepath, vectorDB, log);
    } else {
      // Fallback for single file add/change (backwards compatibility)
      await handleSingleFileChange(event.filepath, type, vectorDB, embeddings, verbose, log, reindexStateManager);
    }
  };
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
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
): Promise<FileWatcher | null> {
  // Enable by default, or use --watch flag
  const fileWatchingEnabled = watch !== undefined ? watch : true;
  if (!fileWatchingEnabled) {
    return null;
  }

  log('👀 Starting file watcher...');
  const fileWatcher = new FileWatcher(rootDir);

  try {
    const handler = createFileChangeHandler(vectorDB, embeddings, verbose, log, reindexStateManager);
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
  
  transport.onclose = () => { 
    log('Transport closed'); 
  };
  transport.onerror = (error) => {
    log(`Transport error: ${error}`);
  };
  
  return transport;
}

/**
 * Setup cleanup handlers for graceful shutdown.
 */
function setupCleanupHandlers(
  versionCheckInterval: NodeJS.Timeout,
  gitPollInterval: NodeJS.Timeout | null,
  fileWatcher: FileWatcher | null,
  log: LogFn
): () => Promise<void> {
  return async () => {
    log('Shutting down MCP server...');
    clearInterval(versionCheckInterval);
    if (gitPollInterval) clearInterval(gitPollInterval);
    if (fileWatcher) await fileWatcher.stop();
    process.exit(0);
  };
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
  };
}

/**
 * Setup version checking and reconnection logic.
 */
function setupVersionChecking(
  vectorDB: VectorDBInterface,
  log: LogFn,
  reindexStateManager: ReturnType<typeof createReindexStateManager>
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
    return {
      indexVersion: vectorDB.getCurrentVersion(),
      indexDate: vectorDB.getVersionDate(),
      reindexInProgress: reindex.inProgress,
      pendingFileCount: reindex.pendingFiles.length,
      lastReindexDurationMs: reindex.lastReindexDurationMs,
      msSinceLastReindex: reindex.lastReindexTimestamp 
        ? Date.now() - reindex.lastReindexTimestamp 
        : null,
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
}

/**
 * Initialize core components (embeddings and vector database) with error handling.
 */
async function initializeComponents(
  rootDir: string,
  earlyLog: LogFn
): Promise<{ embeddings: LocalEmbeddings; vectorDB: VectorDBInterface }> {
  try {
    const result = await initializeDatabase(rootDir, earlyLog);
    
    // Verify vectorDB has required methods
    if (!result.vectorDB || typeof result.vectorDB.initialize !== 'function') {
      throw new Error(`Invalid vectorDB instance: ${result.vectorDB?.constructor?.name || 'undefined'}. Missing initialize method.`);
    }
    
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
    { capabilities: serverConfig.capabilities }
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
  options: { rootDir: string; verbose: boolean | undefined; watch: boolean | undefined }
): Promise<void> {
  const { rootDir, verbose, watch } = options;
  const { vectorDB, embeddings } = toolContext;

  // Register all MCP handlers
  registerMCPHandlers(server, toolContext, log);
  
  // Setup features
  await handleAutoIndexing(vectorDB, rootDir, log);
  const { gitPollInterval } = await setupGitDetection(rootDir, vectorDB, embeddings, verbose, log, reindexStateManager);
  const fileWatcher = await setupFileWatching(watch, rootDir, vectorDB, embeddings, verbose, log, reindexStateManager);

  // Setup cleanup handlers
  const cleanup = setupCleanupHandlers(versionCheckInterval, gitPollInterval, fileWatcher, log);
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

  const { interval: versionCheckInterval, checkAndReconnect, getIndexMetadata } = setupVersionChecking(vectorDB, log, reindexStateManager);
  const toolContext: ToolContext = { 
    vectorDB, 
    embeddings, 
    rootDir, 
    log, 
    checkAndReconnect, 
    getIndexMetadata,
    getReindexState: () => reindexStateManager.getState(),
  };

  await setupAndConnectServer(server, toolContext, log, versionCheckInterval, reindexStateManager, { rootDir, verbose, watch });
}

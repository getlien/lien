import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted mocks (accessible inside vi.mock factories) ---

const {
  mockServerInstance,
  mockTransportInstance,
  mockVectorDB,
  mockEmbeddings,
  mockSetupGitDetection,
  mockSetupCleanupHandlers,
} = vi.hoisted(() => ({
  mockServerInstance: {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    setRequestHandler: vi.fn(),
  },
  mockTransportInstance: {
    onerror: null as ((error: Error) => void) | null,
    onclose: null as (() => void) | null,
  },
  mockVectorDB: {
    initialize: vi.fn().mockResolvedValue(undefined),
    hasData: vi.fn().mockResolvedValue(true),
    checkVersion: vi.fn().mockResolvedValue(false),
    reconnect: vi.fn().mockResolvedValue(undefined),
    getCurrentVersion: vi.fn().mockReturnValue(1),
    getVersionDate: vi.fn().mockReturnValue('2026-01-01'),
    dbPath: '/test/.lien',
  },
  mockEmbeddings: {
    initialize: vi.fn().mockResolvedValue(undefined),
  },
  mockSetupGitDetection: vi.fn().mockResolvedValue({ gitPollInterval: null }),
  mockSetupCleanupHandlers: vi.fn().mockReturnValue(vi.fn().mockResolvedValue(undefined)),
}));

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn(function (this: any) {
    Object.assign(this, mockServerInstance);
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(function (this: any) {
    Object.assign(this, mockTransportInstance);
  }),
}));

vi.mock('@liendev/core', () => ({
  WorkerEmbeddings: vi.fn(function (this: any) {
    Object.assign(this, mockEmbeddings);
  }),
  createVectorDB: vi.fn(async () => mockVectorDB),
  VERSION_CHECK_INTERVAL_MS: 60000,
}));

vi.mock('../watcher/index.js', () => ({
  FileWatcher: vi.fn(function (this: any) {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn().mockResolvedValue(undefined);
    this.getWatchedFiles = vi.fn().mockReturnValue(['file1.ts']);
  }),
}));

vi.mock('./server-config.js', () => ({
  createMCPServerConfig: vi.fn().mockReturnValue({
    name: 'lien',
    version: '0.0.1',
    capabilities: { tools: {}, logging: {} },
  }),
  registerMCPHandlers: vi.fn(),
}));

vi.mock('./reindex-state-manager.js', () => ({
  createReindexStateManager: vi.fn(() => ({
    getState: vi.fn().mockReturnValue({
      inProgress: false,
      pendingFiles: [],
      lastReindexTimestamp: null,
      lastReindexDurationMs: null,
    }),
    startReindex: vi.fn(),
    completeReindex: vi.fn(),
    failReindex: vi.fn(),
  })),
}));

vi.mock('./git-detection.js', () => ({
  setupGitDetection: mockSetupGitDetection,
}));

vi.mock('./file-change-handler.js', () => ({
  createFileChangeHandler: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('./cleanup.js', () => ({
  setupCleanupHandlers: mockSetupCleanupHandlers,
}));

// Mock module/url for package.json resolution
vi.mock('module', () => ({
  createRequire: vi.fn(() => vi.fn().mockReturnValue({ name: 'lien', version: '0.0.1' })),
}));

vi.mock('url', () => ({
  fileURLToPath: vi.fn().mockReturnValue('/mock/path/server.ts'),
}));

// --- Imports (after mocks) ---

import { startMCPServer } from './server.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WorkerEmbeddings, createVectorDB } from '@liendev/core';
import { FileWatcher } from '../watcher/index.js';
import { createMCPServerConfig, registerMCPHandlers } from './server-config.js';
import { setupCleanupHandlers } from './cleanup.js';
import { setupGitDetection } from './git-detection.js';

describe('startMCPServer', () => {
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Clear all mock call counts and state
    vi.clearAllMocks();

    // Reset transport callbacks
    mockTransportInstance.onerror = null;
    mockTransportInstance.onclose = null;

    // Re-setup mock return values (clearAllMocks removes them)
    mockServerInstance.connect.mockResolvedValue(undefined);
    mockServerInstance.close.mockResolvedValue(undefined);
    mockServerInstance.sendLoggingMessage.mockResolvedValue(undefined);
    mockVectorDB.initialize.mockResolvedValue(undefined);
    mockVectorDB.hasData.mockResolvedValue(true);
    mockVectorDB.checkVersion.mockResolvedValue(false);
    mockVectorDB.getCurrentVersion.mockReturnValue(1);
    mockVectorDB.getVersionDate.mockReturnValue('2026-01-01');
    mockEmbeddings.initialize.mockResolvedValue(undefined);
    mockSetupGitDetection.mockResolvedValue({ gitPollInterval: null });
    mockSetupCleanupHandlers.mockReturnValue(vi.fn().mockResolvedValue(undefined));
    vi.mocked(createVectorDB).mockImplementation(async () => mockVectorDB as any);
    vi.mocked(createMCPServerConfig).mockReturnValue({
      name: 'lien',
      version: '0.0.1',
      capabilities: { tools: {}, logging: {} },
    } as any);

    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize embeddings and vector database', async () => {
    await startMCPServer({ rootDir: '/test/project' });

    expect(WorkerEmbeddings).toHaveBeenCalledOnce();
    expect(createVectorDB).toHaveBeenCalledWith('/test/project');
    expect(mockEmbeddings.initialize).toHaveBeenCalledOnce();
    expect(mockVectorDB.initialize).toHaveBeenCalledOnce();
  });

  it('should create MCP server and register handlers', async () => {
    await startMCPServer({ rootDir: '/test/project' });

    expect(Server).toHaveBeenCalledOnce();
    expect(createMCPServerConfig).toHaveBeenCalledWith('lien', '0.0.1');
    expect(registerMCPHandlers).toHaveBeenCalledWith(
      expect.objectContaining({ connect: expect.any(Function) }), // server instance
      expect.objectContaining({
        vectorDB: mockVectorDB,
        rootDir: '/test/project',
      }),
      expect.any(Function),
    );
  });

  it('should connect transport to server', async () => {
    await startMCPServer({ rootDir: '/test/project' });

    expect(StdioServerTransport).toHaveBeenCalledOnce();
    expect(mockServerInstance.connect).toHaveBeenCalledOnce();
  });

  it('should setup file watching by default', async () => {
    await startMCPServer({ rootDir: '/test/project' });

    expect(FileWatcher).toHaveBeenCalledWith('/test/project');
  });

  it('should skip file watching when watch is false', async () => {
    await startMCPServer({ rootDir: '/test/project', watch: false });

    expect(FileWatcher).not.toHaveBeenCalled();
  });

  it('should setup cleanup handlers with SIGINT and SIGTERM', async () => {
    await startMCPServer({ rootDir: '/test/project' });

    expect(setupCleanupHandlers).toHaveBeenCalledWith(
      expect.objectContaining({ connect: expect.any(Function) }), // server instance
      expect.anything(), // versionCheckInterval
      null, // gitPollInterval
      expect.anything(), // fileWatcher
      expect.any(Function), // log
    );

    expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  it('should setup git detection', async () => {
    await startMCPServer({ rootDir: '/test/project' });

    expect(setupGitDetection).toHaveBeenCalledWith(
      '/test/project',
      mockVectorDB,
      expect.objectContaining({ initialize: expect.any(Function) }), // embeddings
      expect.any(Function), // log
      expect.anything(), // reindexStateManager
      expect.anything(), // fileWatcher
      expect.any(Function), // checkAndReconnect
    );
  });

  it('should provide toolContext with all required fields', async () => {
    await startMCPServer({ rootDir: '/test/project' });

    const toolContext = vi.mocked(registerMCPHandlers).mock.calls[0][1];

    expect(toolContext.vectorDB).toBe(mockVectorDB);
    expect(toolContext.embeddings).toEqual(mockEmbeddings);
    expect(toolContext.rootDir).toBe('/test/project');
    expect(typeof toolContext.log).toBe('function');
    expect(typeof toolContext.checkAndReconnect).toBe('function');
    expect(typeof toolContext.getIndexMetadata).toBe('function');
    expect(typeof toolContext.getReindexState).toBe('function');
  });
});

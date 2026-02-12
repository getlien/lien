import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock @liendev/core
const mockIndexCodebase = vi.fn();
const mockVectorDB = {
  initialize: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  dbPath: '/mock/.lien/indices/abc',
};
const mockManifest = {
  clear: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@liendev/core', async () => {
  const actual = await vi.importActual<typeof import('@liendev/core')>('@liendev/core');
  return {
    ...actual,
    indexCodebase: (...args: any[]) => mockIndexCodebase(...args),
    VectorDB: class {
      constructor() {
        return mockVectorDB;
      }
    },
    ManifestManager: class {
      constructor() {
        return mockManifest;
      }
    },
  };
});

// Mock ora
vi.mock('ora', () => {
  const mockSpinner = {
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    render: vi.fn().mockReturnThis(),
    text: '',
  };
  return {
    default: vi.fn(() => mockSpinner),
  };
});

// Mock banner and loading messages
vi.mock('../utils/banner.js', () => ({
  showCompactBanner: vi.fn(),
}));

vi.mock('../utils/loading-messages.js', () => ({
  getIndexingMessage: vi.fn().mockReturnValue('Indexing...'),
  getEmbeddingMessage: vi.fn().mockReturnValue('Embedding...'),
  getModelLoadingMessage: vi.fn().mockReturnValue('Loading model...'),
}));

import { indexCommand } from './index-cmd.js';

describe('indexCommand', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Default successful result
    mockIndexCodebase.mockResolvedValue({
      success: true,
      filesIndexed: 10,
      chunksCreated: 50,
      durationMs: 1500,
    });

    // Reset mocks
    mockVectorDB.initialize.mockClear();
    mockVectorDB.clear.mockClear();
    mockManifest.clear.mockClear();
    mockIndexCodebase.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call indexCodebase with rootDir', async () => {
    await indexCommand({ verbose: false });

    expect(mockIndexCodebase).toHaveBeenCalledWith(
      expect.objectContaining({
        rootDir: process.cwd(),
        verbose: false,
        force: false,
      }),
    );
  });

  it('should pass verbose flag to indexCodebase', async () => {
    await indexCommand({ verbose: true });

    expect(mockIndexCodebase).toHaveBeenCalledWith(
      expect.objectContaining({
        verbose: true,
      }),
    );
  });

  it('should clear existing index when --force is set', async () => {
    await indexCommand({ force: true });

    expect(mockVectorDB.clear).toHaveBeenCalled();
    expect(mockManifest.clear).toHaveBeenCalled();
    expect(mockIndexCodebase).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it('should not clear index when --force is not set', async () => {
    await indexCommand({});

    expect(mockVectorDB.clear).not.toHaveBeenCalled();
    expect(mockManifest.clear).not.toHaveBeenCalled();
  });

  it('should exit with code 1 on indexing failure', async () => {
    mockIndexCodebase.mockResolvedValue({
      success: false,
      error: 'Something went wrong',
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: 100,
    });

    await indexCommand({});

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle thrown errors gracefully', async () => {
    mockIndexCodebase.mockRejectedValue(new Error('Unexpected crash'));

    await indexCommand({});

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error during indexing'),
      expect.any(Error),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should provide onProgress callback to indexCodebase', async () => {
    await indexCommand({});

    expect(mockIndexCodebase).toHaveBeenCalledWith(
      expect.objectContaining({
        onProgress: expect.any(Function),
      }),
    );
  });
});

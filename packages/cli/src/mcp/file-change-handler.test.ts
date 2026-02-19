import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReindexStateManager } from './reindex-state-manager.js';
import type { LogFn } from './types.js';

// Track call order across mocks
let callOrder: string[];

// Mock @liendev/core
vi.mock('@liendev/core', async () => {
  const actual = await vi.importActual<typeof import('@liendev/core')>('@liendev/core');
  return {
    ...actual,
    indexSingleFile: vi.fn(async () => {
      callOrder.push('indexSingleFile');
    }),
    indexMultipleFiles: vi.fn(async () => {
      callOrder.push('indexMultipleFiles');
      return 1;
    }),
    ManifestManager: vi.fn().mockImplementation(function () {
      return {
        load: vi.fn().mockResolvedValue({ files: {} }),
        removeFile: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn().mockResolvedValue(null),
      };
    }),
    normalizeToRelativePath: vi.fn((filepath: string, _rootDir: string) => filepath),
  };
});

// Mock @liendev/parser
vi.mock('@liendev/parser', async () => {
  const actual =
    await vi.importActual<typeof import('@liendev/parser')>('@liendev/parser');
  return {
    ...actual,
    createGitignoreFilter: vi.fn(async () => () => false),
    computeContentHash: vi.fn().mockResolvedValue('hash123'),
  };
});

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
  },
}));

import { isFileIgnored, isGitignoreFile, createFileChangeHandler } from './file-change-handler.js';
import { createGitignoreFilter } from '@liendev/parser';

function createMockVectorDB(dbPath = '/project/.lien/indices/abc') {
  return {
    dbPath,
    hasData: vi.fn().mockResolvedValue(true),
    deleteByFile: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
  } as any;
}

function createMockEmbeddings() {
  return {} as any;
}

describe('isFileIgnored', () => {
  it('should return true when the filter says the file is ignored', () => {
    const isIgnored = (relativePath: string) => relativePath === 'node_modules/foo.js';
    expect(isFileIgnored('node_modules/foo.js', '/project', isIgnored)).toBe(true);
  });

  it('should return false when the filter says the file is not ignored', () => {
    const isIgnored = () => false;
    expect(isFileIgnored('src/index.ts', '/project', isIgnored)).toBe(false);
  });
});

describe('isGitignoreFile', () => {
  it('should match .gitignore at root', () => {
    expect(isGitignoreFile('.gitignore')).toBe(true);
  });

  it('should match nested .gitignore with forward slashes', () => {
    expect(isGitignoreFile('packages/app/.gitignore')).toBe(true);
  });

  it('should match nested .gitignore with Windows backslash paths', () => {
    expect(isGitignoreFile('packages\\app\\.gitignore')).toBe(true);
  });

  it('should not match files with .gitignore suffix', () => {
    expect(isGitignoreFile('foo.gitignore')).toBe(false);
    expect(isGitignoreFile('my.gitignore')).toBe(false);
  });

  it('should not match regular files', () => {
    expect(isGitignoreFile('src/index.ts')).toBe(false);
  });
});

describe('createFileChangeHandler', () => {
  let checkAndReconnect: () => Promise<void>;
  let log: LogFn;
  let reindexStateManager: ReturnType<typeof createReindexStateManager>;

  beforeEach(() => {
    callOrder = [];
    checkAndReconnect = vi.fn<() => Promise<void>>(async () => {
      callOrder.push('checkAndReconnect');
    });
    log = vi.fn<LogFn>();
    reindexStateManager = createReindexStateManager();
    vi.mocked(createGitignoreFilter).mockClear();
  });

  it('should return a function', () => {
    const handler = createFileChangeHandler(
      '/project',
      createMockVectorDB(),
      createMockEmbeddings(),
      log,
      reindexStateManager,
      checkAndReconnect,
    );
    expect(typeof handler).toBe('function');
  });

  it('should call checkAndReconnect before processing unlink events', async () => {
    const vectorDB = createMockVectorDB();
    const handler = createFileChangeHandler(
      '/project',
      vectorDB,
      createMockEmbeddings(),
      log,
      reindexStateManager,
      checkAndReconnect,
    );

    await handler({
      type: 'unlink',
      filepath: '/project/src/deleted.ts',
    });

    expect(checkAndReconnect).toHaveBeenCalledOnce();
  });

  it('should skip batch events where all files are gitignored (totalToProcess === 0)', async () => {
    // Make the gitignore filter ignore everything
    vi.mocked(createGitignoreFilter).mockResolvedValue(() => true);

    const handler = createFileChangeHandler(
      '/project',
      createMockVectorDB(),
      createMockEmbeddings(),
      log,
      reindexStateManager,
      checkAndReconnect,
    );

    await handler({
      type: 'batch',
      filepath: '/project/src/ignored.ts',
      added: ['/project/src/ignored.ts'],
      modified: [],
      deleted: [],
    });

    // checkAndReconnect should NOT be called when all files are filtered out
    expect(checkAndReconnect).not.toHaveBeenCalled();
  });

  it('should always process unlink events even for gitignored files', async () => {
    // Make the gitignore filter ignore everything
    vi.mocked(createGitignoreFilter).mockResolvedValue(() => true);

    const vectorDB = createMockVectorDB();
    const handler = createFileChangeHandler(
      '/project',
      vectorDB,
      createMockEmbeddings(),
      log,
      reindexStateManager,
      checkAndReconnect,
    );

    // First, trigger a non-unlink event to initialize the gitignore filter
    await handler({
      type: 'batch',
      filepath: '/project/src/ignored.ts',
      added: ['/project/src/ignored.ts'],
      modified: [],
      deleted: [],
    });

    // checkAndReconnect should NOT have been called (all files filtered)
    expect(checkAndReconnect).not.toHaveBeenCalled();

    // Now send an unlink event - deletions should always be processed
    await handler({
      type: 'unlink',
      filepath: '/project/node_modules/pkg/index.js',
    });

    // Deletion should always be processed regardless of gitignore
    expect(checkAndReconnect).toHaveBeenCalledOnce();
  });

  it('should call checkAndReconnect before processing batch events with files to process', async () => {
    // Make the gitignore filter allow everything
    vi.mocked(createGitignoreFilter).mockResolvedValue(() => false);

    const handler = createFileChangeHandler(
      '/project',
      createMockVectorDB(),
      createMockEmbeddings(),
      log,
      reindexStateManager,
      checkAndReconnect,
    );

    await handler({
      type: 'batch',
      filepath: '/project/src/file.ts',
      added: ['/project/src/file.ts'],
      modified: [],
      deleted: [],
    });

    expect(checkAndReconnect).toHaveBeenCalledOnce();
  });
});

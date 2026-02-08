import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReindexStateManager } from './reindex-state-manager.js';
import type { LogFn } from './types.js';

// Track call order across mocks
let callOrder: string[];

// Mock @liendev/core
vi.mock('@liendev/core', async () => {
  const actual = await vi.importActual<typeof import('@liendev/core')>('@liendev/core');
  return {
    ...actual,
    indexMultipleFiles: vi.fn(async () => {
      callOrder.push('indexMultipleFiles');
      return 1;
    }),
    createGitignoreFilter: vi.fn(async () => () => false),
    DEFAULT_GIT_POLL_INTERVAL_MS: 1000,
  };
});

// Mock fs/promises (used by filterGitChangedFiles → fs.access)
vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
  },
}));

import { _testing } from './git-detection.js';
import { indexMultipleFiles } from '@liendev/core';

const { handleGitStartup, createGitPollInterval, createGitChangeHandler } = _testing;

function createMockGitTracker(changedFiles: string[] | null = ['/project/src/file.ts']) {
  return {
    initialize: vi.fn().mockResolvedValue(changedFiles),
    detectChanges: vi.fn().mockResolvedValue(changedFiles),
    getDbPath: vi.fn().mockReturnValue('/project/.lien/indices/abc'),
  } as any;
}

function createMockVectorDB() {
  return {
    dbPath: '/project/.lien/indices/abc',
    hasData: vi.fn().mockResolvedValue(true),
  } as any;
}

function createMockEmbeddings() {
  return {} as any;
}

describe('Background git reindex reconnect guard', () => {
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
    vi.mocked(indexMultipleFiles).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('handleGitStartup', () => {
    it('should call checkAndReconnect before indexMultipleFiles', async () => {
      const gitTracker = createMockGitTracker();

      await handleGitStartup(
        '/project',
        gitTracker,
        createMockVectorDB(),
        createMockEmbeddings(),
        false,
        log,
        reindexStateManager,
        checkAndReconnect
      );

      expect(checkAndReconnect).toHaveBeenCalledOnce();
      expect(indexMultipleFiles).toHaveBeenCalledOnce();
      expect(callOrder).toEqual(['checkAndReconnect', 'indexMultipleFiles']);
    });

    it('should not call checkAndReconnect when no changes detected', async () => {
      const gitTracker = createMockGitTracker(null);

      await handleGitStartup(
        '/project',
        gitTracker,
        createMockVectorDB(),
        createMockEmbeddings(),
        false,
        log,
        reindexStateManager,
        checkAndReconnect
      );

      expect(checkAndReconnect).not.toHaveBeenCalled();
      expect(indexMultipleFiles).not.toHaveBeenCalled();
    });
  });

  describe('createGitPollInterval', () => {
    it('should call checkAndReconnect before indexMultipleFiles', async () => {
      vi.useFakeTimers();
      const gitTracker = createMockGitTracker();

      createGitPollInterval(
        '/project',
        gitTracker,
        createMockVectorDB(),
        createMockEmbeddings(),
        false,
        log,
        reindexStateManager,
        checkAndReconnect
      );

      // Advance past the poll interval
      await vi.advanceTimersByTimeAsync(1500);

      expect(checkAndReconnect).toHaveBeenCalledOnce();
      expect(indexMultipleFiles).toHaveBeenCalledOnce();
      expect(callOrder).toEqual(['checkAndReconnect', 'indexMultipleFiles']);
    });
  });

  describe('createGitChangeHandler', () => {
    it('should call checkAndReconnect before indexMultipleFiles', async () => {
      const gitTracker = createMockGitTracker();

      const handler = createGitChangeHandler(
        '/project',
        gitTracker,
        createMockVectorDB(),
        createMockEmbeddings(),
        false,
        log,
        reindexStateManager,
        checkAndReconnect
      );

      await handler();

      expect(checkAndReconnect).toHaveBeenCalledOnce();
      expect(indexMultipleFiles).toHaveBeenCalledOnce();
      expect(callOrder).toEqual(['checkAndReconnect', 'indexMultipleFiles']);
    });

    it('should not call checkAndReconnect when no changes detected', async () => {
      const gitTracker = createMockGitTracker(null);

      const handler = createGitChangeHandler(
        '/project',
        gitTracker,
        createMockVectorDB(),
        createMockEmbeddings(),
        false,
        log,
        reindexStateManager,
        checkAndReconnect
      );

      await handler();

      expect(checkAndReconnect).not.toHaveBeenCalled();
      expect(indexMultipleFiles).not.toHaveBeenCalled();
    });
  });
});

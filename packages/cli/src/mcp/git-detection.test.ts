import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// All deps live in @liendev/core / @liendev/parser; mock them so we exercise
// only setupGitDetection's wiring (especially the now-always-on poll).
const {
  mockIsGitAvailable,
  mockIsGitRepo,
  mockIndexMultipleFiles,
  mockGitStateTrackerInstance,
  mockCreateGitignoreFilter,
} = vi.hoisted(() => ({
  mockIsGitAvailable: vi.fn(async () => true),
  mockIsGitRepo: vi.fn(async () => true),
  mockIndexMultipleFiles: vi.fn(async () => 0),
  mockGitStateTrackerInstance: {
    initialize: vi.fn(async () => null),
    detectChanges: vi.fn(async () => null),
    getState: vi.fn(() => null),
  },
  mockCreateGitignoreFilter: vi.fn(async () => () => false),
}));

vi.mock('@liendev/core', () => ({
  isGitAvailable: mockIsGitAvailable,
  isGitRepo: mockIsGitRepo,
  indexMultipleFiles: mockIndexMultipleFiles,
  GitStateTracker: vi.fn(function (this: unknown) {
    Object.assign(this as object, mockGitStateTrackerInstance);
  }),
  DEFAULT_GIT_POLL_INTERVAL_MS: 10000,
}));

vi.mock('@liendev/parser', () => ({
  createGitignoreFilter: mockCreateGitignoreFilter,
}));

import { setupGitDetection } from './git-detection.js';
import type { FileWatcher } from '../watcher/index.js';
import type { VectorDBInterface } from '@liendev/core';

function makeReindexStateManager() {
  return {
    getState: () => ({
      inProgress: false,
      pendingFiles: [],
      lastReindexTimestamp: null,
      lastReindexDurationMs: null,
    }),
    startReindex: vi.fn(),
    completeReindex: vi.fn(),
    failReindex: vi.fn(),
    resetIfStuck: vi.fn(() => false),
  };
}

describe('setupGitDetection — poll gate', () => {
  let intervalsCreated: NodeJS.Timeout[];
  let realSetInterval: typeof setInterval;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsGitAvailable.mockResolvedValue(true);
    mockIsGitRepo.mockResolvedValue(true);
    mockGitStateTrackerInstance.initialize.mockResolvedValue(null);
    mockGitStateTrackerInstance.detectChanges.mockResolvedValue(null);

    // Capture every setInterval call so we can clean them up after the test.
    intervalsCreated = [];
    realSetInterval = global.setInterval;
    global.setInterval = ((handler: () => void, ms: number) => {
      const id = realSetInterval(handler, ms);
      intervalsCreated.push(id);
      return id;
    }) as unknown as typeof setInterval;
  });

  afterEach(() => {
    for (const id of intervalsCreated) clearInterval(id);
    global.setInterval = realSetInterval;
  });

  it('always creates a git poll interval, even when fileWatcher is non-null', async () => {
    // Regression for #556 v3: pre-fix, the poll was gated behind
    // `fileWatcher === null`. That left a watcher-only setup with no backstop
    // when chokidar/FSEvents missed git's atomic ref rewrites.
    const fileWatcher = { watchGit: vi.fn() } as unknown as FileWatcher;

    const result = await setupGitDetection(
      '/tmp/fake-repo',
      {} as VectorDBInterface,
      () => {},
      makeReindexStateManager(),
      fileWatcher,
      async () => {},
    );

    expect(result.gitPollInterval).not.toBeNull();
    expect(fileWatcher.watchGit).toHaveBeenCalledOnce();
  });

  it('still creates a poll interval when fileWatcher is null (fallback path)', async () => {
    const result = await setupGitDetection(
      '/tmp/fake-repo',
      {} as VectorDBInterface,
      () => {},
      makeReindexStateManager(),
      null,
      async () => {},
    );

    expect(result.gitPollInterval).not.toBeNull();
  });

  it('returns null tracker + interval when not in a git repo', async () => {
    mockIsGitRepo.mockResolvedValue(false);

    const result = await setupGitDetection(
      '/tmp/not-a-repo',
      {} as VectorDBInterface,
      () => {},
      makeReindexStateManager(),
      { watchGit: vi.fn() } as unknown as FileWatcher,
      async () => {},
    );

    expect(result.gitTracker).toBeNull();
    expect(result.gitPollInterval).toBeNull();
  });

  it('does NOT call detectChanges when a reindex is already in progress', async () => {
    // Regression for the Lien Review finding on PR #561: detectChanges has the
    // side effect of advancing the tracker's saved state. If the poll calls
    // detectChanges and THEN bails because another reindex is running, the
    // returned changedFiles are dropped on the floor and the tracker's state
    // has already moved past them — they'll never be processed.
    const reindexStateManager = {
      ...makeReindexStateManager(),
      getState: () => ({
        inProgress: true,
        pendingFiles: ['foo.ts'],
        lastReindexTimestamp: null,
        lastReindexDurationMs: null,
      }),
    };

    vi.useFakeTimers();
    try {
      const result = await setupGitDetection(
        '/tmp/fake-repo',
        {} as VectorDBInterface,
        () => {},
        reindexStateManager,
        { watchGit: vi.fn() } as unknown as FileWatcher,
        async () => {},
      );

      // Trigger one poll cycle by advancing the timer.
      await vi.advanceTimersByTimeAsync(10000);
      await vi.advanceTimersByTimeAsync(0); // flush pending microtasks

      // The tick should have observed inProgress=true and bailed BEFORE
      // calling detectChanges (which would mutate tracker state).
      expect(mockGitStateTrackerInstance.detectChanges).not.toHaveBeenCalled();

      clearInterval(result.gitPollInterval!);
    } finally {
      vi.useRealTimers();
    }
  });
});

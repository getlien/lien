import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock @liendev/core
//
// `detectLinkedWorktree` and `resolveIndexStrategy` are mocked here (not left
// to the `...actual` spread) because `detectLinkedWorktree` shells out to real
// `git` — running the actual implementation in tests would make status.test.ts
// behave differently depending on whether it happens to run inside a linked
// worktree (true for e.g. Claude Code agent worktrees). Default to "not a
// worktree" so every pre-existing test keeps seeing today's output unchanged.
vi.mock('@liendev/core', async () => {
  const actual = await vi.importActual<typeof import('@liendev/core')>('@liendev/core');
  return {
    ...actual,
    isGitRepo: vi.fn().mockResolvedValue(false),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    getCurrentCommit: vi.fn().mockResolvedValue('abc12345def67890'),
    readVersionFile: vi.fn().mockResolvedValue(0),
    loadGlobalConfig: vi.fn().mockResolvedValue({ backend: 'sqlite' }),
    detectLinkedWorktree: vi.fn().mockResolvedValue({ isLinkedWorktree: false, mainRoot: null }),
    resolveIndexStrategy: vi.fn().mockResolvedValue({ mode: 'standalone' }),
    extractRepoId: vi.fn().mockReturnValue('test-repo-id'),
  };
});

// Mock banner
vi.mock('../utils/banner.js', () => ({
  showCompactBanner: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
  },
}));

import { statusCommand } from './status.js';
import {
  isGitRepo,
  getCurrentBranch,
  getCurrentCommit,
  readVersionFile,
  loadGlobalConfig,
  detectLinkedWorktree,
  resolveIndexStrategy,
  INDEX_FORMAT_VERSION,
} from '@liendev/core';
import fs from 'fs/promises';

/**
 * An ENOENT-shaped error (`.code` set, matching Node's real fs errors) for
 * mocking `fs.readFile` rejections. `ManifestManager.load()` branches on
 * `.code === 'ENOENT'` to treat "no manifest yet" as silent/expected; a
 * plain `new Error('ENOENT')` (message only, no `.code`) instead falls into
 * its "corrupt manifest" branch and logs a spurious console.error warning.
 */
function enoentError(): NodeJS.ErrnoException {
  const error = new Error('ENOENT') as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

/** Find the `console.log(chalk.dim('Index files:'), count)` call and return its raw `count` arg. */
function findIndexFilesValue(calls: unknown[][]): unknown {
  const call = calls.find(c => typeof c[0] === 'string' && c[0].includes('Index files:'));
  return call?.[1];
}

/** Minimal valid manifest.json body with `count` indexed files, for mocking `fs.readFile`. */
function fakeManifest(fileCount: number): string {
  const files: Record<string, unknown> = {};
  for (let i = 0; i < fileCount; i++) {
    files[`file${i}.ts`] = { filepath: `file${i}.ts`, lastModified: 0, chunkCount: 1 };
  }
  return JSON.stringify({
    formatVersion: INDEX_FORMAT_VERSION,
    lienVersion: '0.0.0',
    lastIndexed: 0,
    files,
  });
}

describe('statusCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(isGitRepo).mockResolvedValue(false);
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(fs.readFile).mockRejectedValue(enoentError());
    vi.mocked(loadGlobalConfig).mockResolvedValue({ backend: 'sqlite' });
    vi.mocked(detectLinkedWorktree).mockResolvedValue({ isLinkedWorktree: false, mainRoot: null });
    vi.mocked(resolveIndexStrategy).mockResolvedValue({ mode: 'standalone' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LIEN_WORKTREE_STANDALONE;
  });

  it('should show "Not indexed" for project without index', async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    await statusCommand();

    const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
    expect(allOutput).toContain('Not indexed');
  });

  it('should show index info for indexed project', async () => {
    vi.mocked(fs.stat).mockResolvedValue({
      mtime: new Date('2025-01-01'),
      isDirectory: () => true,
    } as any);
    vi.mocked(fs.readdir).mockResolvedValue(['file1', 'file2'] as any);
    vi.mocked(readVersionFile).mockResolvedValue(1700000000000);

    await statusCommand();

    const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
    expect(allOutput).toContain('Exists');
  });

  it('should show git info when in a git repo', async () => {
    vi.mocked(isGitRepo).mockResolvedValue(true);
    vi.mocked(getCurrentBranch).mockResolvedValue('feature-branch');
    vi.mocked(getCurrentCommit).mockResolvedValue('abc12345def67890');
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    await statusCommand();

    const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
    expect(allOutput).toContain('Git detection:');
    expect(allOutput).toContain('Enabled');
    expect(allOutput).toContain('feature-branch');
    expect(allOutput).toContain('abc12345');
  });

  it('should show "Not a git repo" when not in git repo', async () => {
    vi.mocked(isGitRepo).mockResolvedValue(false);
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    await statusCommand();

    const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
    expect(allOutput).toContain('Not a git repo');
  });

  it('should hide indexing settings by default', async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    await statusCommand();

    const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
    expect(allOutput).toContain('Features:');
    expect(allOutput).toContain('File watching:');
    expect(allOutput).not.toContain('Indexing Settings');
    expect(allOutput).not.toContain('Concurrency:');
  });

  it('should show indexing settings with --verbose', async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    await statusCommand({ verbose: true });

    const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
    expect(allOutput).toContain('Indexing Settings');
    expect(allOutput).toContain('Concurrency:');
    expect(allOutput).toContain('Chunk size:');
    expect(allOutput).toContain('Chunk overlap:');
  });

  it('should output valid JSON with --format json', async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    await statusCommand({ format: 'json' });

    const calls = consoleLogSpy.mock.calls as string[][];
    const jsonCall = calls.find(call => {
      try {
        JSON.parse(call[0]);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();

    const data = JSON.parse(jsonCall![0]);
    expect(data.indexStatus).toBe('not_indexed');
    expect(data.indexPath).toBeDefined();
    expect(data.features).toEqual({ fileWatching: true, gitDetection: true });
    expect(data.settings).toBeDefined();
    expect(data.settings.concurrency).toBeDefined();
  });

  it('should report lexical search (no embeddings) instead of an embeddings status', async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    await statusCommand();

    const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
    expect(allOutput).toContain('Search:');
    expect(allOutput).toContain('Lexical');
    // Embeddings are gone entirely — status must not resurrect them.
    expect(allOutput).not.toContain('Embeddings:');
    expect(allOutput).not.toContain('structural-only mode');
  });

  it('should show the configured backend in the status banner', async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    await statusCommand();

    const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
    expect(allOutput).toContain('Backend:');
    expect(allOutput).toContain('sqlite');
  });

  it('should include backend and lexical search mode in JSON output (no embeddings block)', async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    await statusCommand({ format: 'json' });

    const calls = consoleLogSpy.mock.calls as string[][];
    const jsonCall = calls.find(call => {
      try {
        JSON.parse(call[0]);
        return true;
      } catch {
        return false;
      }
    });
    const data = JSON.parse(jsonCall![0]);
    expect(data.backend).toBe('sqlite');
    expect(data.search).toBe('lexical');
    expect(data.embeddings).toBeUndefined();
  });

  it('should report the manifest-tracked indexFiles count in JSON output, not raw store-dir entries', async () => {
    vi.mocked(fs.stat).mockResolvedValue({
      mtime: new Date('2025-01-01'),
      isDirectory: () => true,
    } as any);
    vi.mocked(fs.readdir).mockResolvedValue(['manifest.json', 'structural.db'] as any);
    vi.mocked(fs.readFile).mockResolvedValue(fakeManifest(3) as any);

    await statusCommand({ format: 'json' });

    const calls = consoleLogSpy.mock.calls as string[][];
    const jsonCall = calls.find(call => {
      try {
        JSON.parse(call[0]);
        return true;
      } catch {
        return false;
      }
    });
    const data = JSON.parse(jsonCall![0]);
    expect(data.indexFiles).toBe(3);
  });

  it('should show the manifest-tracked file count, not raw store-dir entries', async () => {
    vi.mocked(fs.stat).mockResolvedValue({
      mtime: new Date('2025-01-01'),
      isDirectory: () => true,
    } as any);
    // Regression guard for the bug this replaces: the store dir has 7 raw
    // entries (manifest.json, structural.db, -shm/-wal, .git-state.json,
    // .lien-accessed, .lien-index-version) but the manifest itself tracks
    // only 3 indexed source files — "Index files" must report 3, not 7.
    vi.mocked(fs.readdir).mockResolvedValue([
      'manifest.json',
      'structural.db',
      'structural.db-shm',
      'structural.db-wal',
      '.git-state.json',
      '.lien-accessed',
      '.lien-index-version',
    ] as any);
    vi.mocked(fs.readFile).mockResolvedValue(fakeManifest(3) as any);

    await statusCommand();

    // Inspect the call's raw args rather than the ANSI-coded joined string
    // (chalk's reset code sits between the label and the value, which breaks
    // a naive string/regex match) — see findIndexFilesValue.
    expect(findIndexFilesValue(consoleLogSpy.mock.calls)).toBe(3);
  });

  it('reports 0 index files when the manifest is missing or unreadable (fails open, never throws)', async () => {
    vi.mocked(fs.stat).mockResolvedValue({
      mtime: new Date('2025-01-01'),
      isDirectory: () => true,
    } as any);
    vi.mocked(fs.readFile).mockRejectedValue(enoentError());

    await statusCommand();

    expect(findIndexFilesValue(consoleLogSpy.mock.calls)).toBe(0);
  });

  describe('worktree-aware indexing status', () => {
    it('should not show a Worktree section in a normal checkout', async () => {
      // beforeEach already defaults detectLinkedWorktree to { isLinkedWorktree: false }
      await statusCommand();

      const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
      expect(allOutput).not.toContain('Worktree:');
    });

    it('should report overlay mode with base and overlay index locations', async () => {
      vi.mocked(detectLinkedWorktree).mockResolvedValue({
        isLinkedWorktree: true,
        mainRoot: '/repo/main',
      });
      vi.mocked(resolveIndexStrategy).mockResolvedValue({
        mode: 'overlay',
        mainRoot: '/repo/main',
        baseIndexDir: '/lien-home/.lien/indices/main-repo-id',
        overlayIndexDir: '/lien-home/.lien/indices/worktree-repo-id',
      });
      vi.mocked(fs.stat).mockResolvedValue({
        mtime: new Date('2025-01-01'),
        isDirectory: () => true,
      } as any);
      vi.mocked(fs.readdir).mockResolvedValue(['a', 'b'] as any);

      await statusCommand();

      const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
      expect(allOutput).toContain('Worktree:');
      expect(allOutput).toContain('Overlay');
      expect(allOutput).toContain('/repo/main');
      expect(allOutput).toContain('Base index:');
      expect(allOutput).toContain('/lien-home/.lien/indices/main-repo-id');
      expect(allOutput).toContain('Found');
      expect(allOutput).toContain('Overlay index:');
      expect(allOutput).toContain('/lien-home/.lien/indices/worktree-repo-id');
    });

    it('should report standalone mode with the reason when the main checkout has no usable index', async () => {
      vi.mocked(detectLinkedWorktree).mockResolvedValue({
        isLinkedWorktree: true,
        mainRoot: '/repo/main',
      });
      vi.mocked(resolveIndexStrategy).mockResolvedValue({ mode: 'standalone' });
      vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

      await statusCommand();

      const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
      expect(allOutput).toContain('Worktree:');
      expect(allOutput).toContain('Standalone');
      expect(allOutput).toContain('main checkout has no index yet');
      expect(allOutput).toContain('/repo/main');
      expect(allOutput).toContain('Base index:');
      expect(allOutput).toContain('Not found');
      expect(allOutput).not.toContain('Escape hatch:');
    });

    it('should report the LIEN_WORKTREE_STANDALONE escape hatch when it forced standalone mode', async () => {
      process.env.LIEN_WORKTREE_STANDALONE = '1';
      vi.mocked(detectLinkedWorktree).mockResolvedValue({
        isLinkedWorktree: true,
        mainRoot: '/repo/main',
      });
      vi.mocked(resolveIndexStrategy).mockResolvedValue({ mode: 'standalone' });

      await statusCommand();

      const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
      expect(allOutput).toContain('Worktree:');
      expect(allOutput).toContain('Standalone');
      expect(allOutput).toContain('escape hatch forced standalone');
      expect(allOutput).toContain('Escape hatch:');
      expect(allOutput).toContain('LIEN_WORKTREE_STANDALONE=1');
    });
  });
});

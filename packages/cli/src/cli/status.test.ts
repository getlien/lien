import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock @liendev/core
vi.mock('@liendev/core', async () => {
  const actual = await vi.importActual<typeof import('@liendev/core')>('@liendev/core');
  return {
    ...actual,
    isGitRepo: vi.fn().mockResolvedValue(false),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    getCurrentCommit: vi.fn().mockResolvedValue('abc12345def67890'),
    readVersionFile: vi.fn().mockResolvedValue(0),
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
import { isGitRepo, getCurrentBranch, getCurrentCommit, readVersionFile } from '@liendev/core';
import fs from 'fs/promises';

describe('statusCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(isGitRepo).mockResolvedValue(false);
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(allOutput).toContain('Batch size:');
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

  it('should show file count in index', async () => {
    vi.mocked(fs.stat).mockResolvedValue({
      mtime: new Date('2025-01-01'),
      isDirectory: () => true,
    } as any);
    vi.mocked(fs.readdir).mockResolvedValue(['a.lance', 'b.lance', 'c.json'] as any);

    await statusCommand();

    const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
    expect(allOutput).toContain('3');
  });
});

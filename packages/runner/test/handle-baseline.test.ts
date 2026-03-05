import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@liendev/parser', () => ({
  performChunkOnlyIndex: vi.fn(),
  analyzeComplexityFromChunks: vi.fn(),
}));

vi.mock('../src/clone.js', () => ({
  cloneBySha: vi.fn(),
  cloneByBranch: vi.fn(),
  resolveHeadSha: vi.fn(),
  resolveCommitTimestamp: vi.fn(),
}));

vi.mock('../src/api-client.js', () => ({
  postReviewRunResult: vi.fn(),
}));

import { performChunkOnlyIndex, analyzeComplexityFromChunks } from '@liendev/parser';
import { cloneBySha, cloneByBranch, resolveHeadSha, resolveCommitTimestamp } from '../src/clone.js';
import { postReviewRunResult } from '../src/api-client.js';
import { handleBaseline } from '../src/handlers/baseline.js';
import type { BaselineJobPayload } from '../src/types.js';
import type { RunnerConfig } from '../src/config.js';

const mockPerformChunkOnlyIndex = vi.mocked(performChunkOnlyIndex);
const mockAnalyzeComplexityFromChunks = vi.mocked(analyzeComplexityFromChunks);
const mockCloneBySha = vi.mocked(cloneBySha);
const mockCloneByBranch = vi.mocked(cloneByBranch);
const mockResolveHeadSha = vi.mocked(resolveHeadSha);
const mockResolveCommitTimestamp = vi.mocked(resolveCommitTimestamp);
const mockPostResult = vi.mocked(postReviewRunResult);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePayload(sha?: string): BaselineJobPayload {
  return {
    job_type: 'baseline',
    repository: { id: 1, full_name: 'owner/repo', default_branch: 'main' },
    config: { threshold: '15' },
    auth: { installation_token: 'ghp_test', service_token: 'svc_test' },
    ...(sha ? { sha, committed_at: '2024-01-01T00:00:00Z' } : {}),
  };
}

function makeConfig(): RunnerConfig {
  return {
    natsUrl: 'nats://localhost:4222',
    natsStream: 'reviews',
    natsConsumer: 'reviews-runner',
    laravelApiUrl: 'https://api.test',
    openrouterApiKey: '',
    openrouterModel: 'test-model',
    pullTimeoutMs: 30_000,
    jobTimeoutMs: 600_000,
  };
}

const logger = {
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const fakeClone = {
  dir: '/tmp/clone',
  cleanup: vi.fn(),
};

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  fakeClone.cleanup.mockResolvedValue(undefined);
  mockPostResult.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleBaseline', () => {
  it('clones by SHA and posts real complexity scores', async () => {
    mockCloneBySha.mockResolvedValue(fakeClone as never);

    const fakeChunks = [
      { metadata: { file: 'src/app.ts' } },
      { metadata: { file: 'src/utils.ts' } },
    ];
    mockPerformChunkOnlyIndex.mockResolvedValue({
      success: true,
      chunks: fakeChunks,
      filesIndexed: 2,
      chunksCreated: 5,
      durationMs: 100,
    } as never);

    const fakeReport = {
      files: {},
      summary: {
        filesAnalyzed: 2,
        totalViolations: 0,
        bySeverity: { error: 0, warning: 0 },
        avgComplexity: 8.2,
        maxComplexity: 16,
      },
    };
    mockAnalyzeComplexityFromChunks.mockReturnValue(fakeReport as never);

    await handleBaseline(makePayload('abc123'), makeConfig(), logger);

    expect(mockCloneBySha).toHaveBeenCalledWith('owner/repo', 'abc123', 'ghp_test', logger);
    expect(mockPostResult).toHaveBeenCalledOnce();
    const result = mockPostResult.mock.calls[0][2];
    expect(result).toMatchObject({
      head_sha: 'abc123',
      committed_at: '2024-01-01T00:00:00Z',
      status: 'completed',
      avg_complexity: 8.2,
      max_complexity: 16,
      files_analyzed: 2,
    });
  });

  it('clones by branch and resolves head SHA when no SHA provided', async () => {
    mockCloneByBranch.mockResolvedValue(fakeClone as never);
    mockResolveHeadSha.mockResolvedValue('resolved-sha');
    mockResolveCommitTimestamp.mockResolvedValue('2024-02-01T00:00:00Z');

    const fakeChunks = [{ metadata: { file: 'src/index.ts' } }];
    mockPerformChunkOnlyIndex.mockResolvedValue({
      success: true,
      chunks: fakeChunks,
      filesIndexed: 1,
      chunksCreated: 1,
      durationMs: 80,
    } as never);

    const fakeReport = {
      files: {},
      summary: {
        filesAnalyzed: 1,
        totalViolations: 0,
        bySeverity: { error: 0, warning: 0 },
        avgComplexity: 5.0,
        maxComplexity: 10,
      },
    };
    mockAnalyzeComplexityFromChunks.mockReturnValue(fakeReport as never);

    await handleBaseline(makePayload(), makeConfig(), logger);

    expect(mockCloneByBranch).toHaveBeenCalledWith('owner/repo', 'main', 'ghp_test', logger);
    expect(mockResolveHeadSha).toHaveBeenCalledWith('/tmp/clone');
    expect(mockResolveCommitTimestamp).toHaveBeenCalledWith('/tmp/clone');

    expect(mockPostResult).toHaveBeenCalledOnce();
    const result = mockPostResult.mock.calls[0][2];
    expect(result).toMatchObject({
      head_sha: 'resolved-sha',
      committed_at: '2024-02-01T00:00:00Z',
      status: 'completed',
      avg_complexity: 5.0,
      max_complexity: 10,
    });
  });

  it('posts failed result when indexing fails', async () => {
    mockCloneBySha.mockResolvedValue(fakeClone as never);
    mockPerformChunkOnlyIndex.mockResolvedValue({
      success: false,
      chunks: [],
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: 50,
    } as never);

    await handleBaseline(makePayload('abc123'), makeConfig(), logger);

    expect(mockPostResult).toHaveBeenCalledOnce();
    const result = mockPostResult.mock.calls[0][2];
    expect(result).toMatchObject({
      status: 'failed',
      avg_complexity: 0,
      max_complexity: 0,
    });
  });

  it('posts zero complexity when no chunks produced', async () => {
    mockCloneBySha.mockResolvedValue(fakeClone as never);
    mockPerformChunkOnlyIndex.mockResolvedValue({
      success: true,
      chunks: [],
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: 50,
    } as never);

    await handleBaseline(makePayload('abc123'), makeConfig(), logger);

    expect(mockPostResult).toHaveBeenCalledOnce();
    const result = mockPostResult.mock.calls[0][2];
    expect(result).toMatchObject({
      status: 'completed',
      avg_complexity: 0,
      max_complexity: 0,
      files_analyzed: 0,
    });
    expect(result.complexity_snapshots).toEqual([]);
  });
});

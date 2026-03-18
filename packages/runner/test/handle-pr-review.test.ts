import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@liendev/review', () => ({
  createOctokit: vi.fn(),
  createCheckRun: vi.fn(),
  updateCheckRun: vi.fn(),
  filterAnalyzableFiles: vi.fn(),
  getPRChangedFiles: vi.fn(),
  getPRPatchData: vi.fn(),
  ReviewEngine: vi.fn(),
  SummaryPlugin: vi.fn(),
  ComplexityPlugin: vi.fn(),
  ArchitecturalPlugin: vi.fn(),
  OpenRouterLLMClient: vi.fn(),
  runComplexityAnalysis: vi.fn(),
  enrichWithTestAssociations: vi.fn(),
  calculateDeltas: vi.fn(),
  calculateDeltaSummary: vi.fn(),
}));

vi.mock('@liendev/parser', () => ({
  performChunkOnlyIndex: vi.fn(),
  analyzeComplexityFromChunks: vi.fn(),
}));

vi.mock('../src/clone.js', () => ({
  cloneBySha: vi.fn(),
  resolveCommitTimestamp: vi.fn(),
}));

vi.mock('../src/api-client.js', () => ({
  postReviewRunResult: vi.fn(),
  postReviewRunStatus: vi.fn(),
}));

vi.mock('../src/log-buffer.js', () => ({
  LogBuffer: vi.fn(),
}));

import {
  createOctokit,
  updateCheckRun,
  filterAnalyzableFiles,
  getPRChangedFiles,
  getPRPatchData,
  ReviewEngine,
  SummaryPlugin,
} from '@liendev/review';
import { performChunkOnlyIndex, analyzeComplexityFromChunks } from '@liendev/parser';
import { cloneBySha, resolveCommitTimestamp } from '../src/clone.js';
import { postReviewRunResult, postReviewRunStatus } from '../src/api-client.js';
import { LogBuffer } from '../src/log-buffer.js';
import { handlePRReview } from '../src/handlers/pr-review.js';
import type { PRJobPayload } from '../src/types.js';
import type { RunnerConfig } from '../src/config.js';

const mockCreateOctokit = vi.mocked(createOctokit);
const mockUpdateCheckRun = vi.mocked(updateCheckRun);
const mockFilterAnalyzableFiles = vi.mocked(filterAnalyzableFiles);
const mockGetPRChangedFiles = vi.mocked(getPRChangedFiles);
const mockGetPRPatchData = vi.mocked(getPRPatchData);
const MockReviewEngine = vi.mocked(ReviewEngine);
const MockSummaryPlugin = vi.mocked(SummaryPlugin);
const mockPerformChunkOnlyIndex = vi.mocked(performChunkOnlyIndex);
const mockAnalyzeComplexityFromChunks = vi.mocked(analyzeComplexityFromChunks);
const mockCloneBySha = vi.mocked(cloneBySha);
const mockResolveCommitTimestamp = vi.mocked(resolveCommitTimestamp);
const mockPostResult = vi.mocked(postReviewRunResult);
const mockPostStatus = vi.mocked(postReviewRunStatus);
const MockLogBuffer = vi.mocked(LogBuffer);

const mockEngineRegister = vi.fn();
const mockEngineRun = vi.fn();
const mockEnginePresent = vi.fn();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePayload(summaryEnabled = false): PRJobPayload {
  return {
    job_type: 'pr',
    repository: { id: 1, full_name: 'owner/repo', default_branch: 'main' },
    pull_request: {
      number: 42,
      title: 'Test PR',
      body: null,
      head_sha: 'abc123',
      base_sha: 'def456',
      head_ref: 'feature',
      base_ref: 'main',
    },
    config: {
      threshold: '15',
      review_types: { complexity: false, architectural: false, summary: summaryEnabled },
      block_on_new_errors: false,
      architectural_mode: 'off',
    },
    auth: { installation_token: 'ghp_test', service_token: 'svc_test' },
    check_run_id: 100,
    review_run_id: 200,
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

const fakeOctokit = {} as ReturnType<typeof createOctokit>;

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockCreateOctokit.mockReturnValue(fakeOctokit);
  mockUpdateCheckRun.mockResolvedValue(undefined as never);
  mockCloneBySha.mockResolvedValue({
    dir: '/tmp/head',
    cleanup: vi.fn().mockResolvedValue(undefined),
  } as never);
  mockResolveCommitTimestamp.mockResolvedValue('2024-01-01T00:00:00Z');
  mockPostResult.mockResolvedValue(true);
  mockPostStatus.mockResolvedValue(true);
  MockLogBuffer.mockImplementation(function () {
    return { add: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined) };
  });
  MockReviewEngine.mockImplementation(function () {
    return {
      register: mockEngineRegister,
      run: mockEngineRun,
      present: mockEnginePresent,
      getPluginIds: () => [],
    };
  });
  mockEngineRun.mockResolvedValue([]);
  mockEnginePresent.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handlePRReview — no-analyzable-files paths', () => {
  function setupNoAnalyzableFiles() {
    mockGetPRChangedFiles.mockResolvedValue(['README.md'] as never);
    mockFilterAnalyzableFiles.mockReturnValue([] as never);
  }

  function setupRepoScanSuccess(avgComplexity = 12.5, maxComplexity = 25) {
    const fakeChunks = [{ metadata: { file: 'src/app.ts' } }];
    const fakeReport = {
      files: {
        'src/app.ts': {
          violations: [
            {
              symbolName: 'handleRequest',
              symbolType: 'function',
              startLine: 10,
              metricType: 'cyclomatic',
              complexity: maxComplexity,
              threshold: 15,
              severity: 'error',
            },
          ],
        },
      },
      summary: {
        filesAnalyzed: 1,
        totalViolations: 1,
        bySeverity: { error: 1, warning: 0 },
        avgComplexity,
        maxComplexity,
      },
    };

    mockPerformChunkOnlyIndex.mockResolvedValue({
      success: true,
      chunks: fakeChunks,
      filesIndexed: 1,
      chunksCreated: 1,
      durationMs: 100,
    } as never);
    mockAnalyzeComplexityFromChunks.mockReturnValue(fakeReport as never);
    return { fakeReport };
  }

  function setupRepoScanEmpty() {
    mockPerformChunkOnlyIndex.mockResolvedValue({
      success: true,
      chunks: [],
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: 50,
    } as never);
  }

  describe('Path A: summary disabled', () => {
    it('posts real complexity scores when repo scan succeeds', async () => {
      setupNoAnalyzableFiles();
      setupRepoScanSuccess(12.5, 25);

      await handlePRReview(makePayload(false), makeConfig(), logger);

      expect(mockPostResult).toHaveBeenCalledOnce();
      const result = mockPostResult.mock.calls[0][2];
      expect(result).toMatchObject({
        avg_complexity: 12.5,
        max_complexity: 25,
        files_analyzed: 0,
        status: 'completed',
      });
      expect(result.complexity_snapshots).toHaveLength(1);
      expect(result.complexity_snapshots[0]).toMatchObject({
        filepath: 'src/app.ts',
        symbol_name: 'handleRequest',
        complexity: 25,
      });

      // Check run finalized with "No code files changed"
      expect(mockUpdateCheckRun).toHaveBeenCalledWith(
        fakeOctokit,
        expect.objectContaining({
          conclusion: 'success',
          output: expect.objectContaining({ title: 'No code files changed' }),
        }),
        logger,
      );

      // No ReviewEngine instantiation (early return before engine)
      expect(MockReviewEngine).not.toHaveBeenCalled();
    });

    it('posts zero complexity when repo scan returns no chunks', async () => {
      setupNoAnalyzableFiles();
      setupRepoScanEmpty();

      await handlePRReview(makePayload(false), makeConfig(), logger);

      expect(mockPostResult).toHaveBeenCalledOnce();
      const result = mockPostResult.mock.calls[0][2];
      expect(result).toMatchObject({
        avg_complexity: 0,
        max_complexity: 0,
        files_analyzed: 0,
        status: 'completed',
      });
      expect(result.complexity_snapshots).toEqual([]);
      expect(MockReviewEngine).not.toHaveBeenCalled();
    });
  });

  describe('Path B: summary enabled', () => {
    it('posts real complexity from repo scan and registers SummaryPlugin', async () => {
      setupNoAnalyzableFiles();
      setupRepoScanSuccess(7.3, 18);
      mockGetPRPatchData.mockResolvedValue({ patches: {}, diffLines: 0 } as never);

      await handlePRReview(makePayload(true), makeConfig(), logger);

      expect(mockPostResult).toHaveBeenCalledOnce();
      const result = mockPostResult.mock.calls[0][2];
      expect(result).toMatchObject({
        avg_complexity: 7.3,
        max_complexity: 18,
        files_analyzed: 0,
        status: 'completed',
      });

      // Engine instantiated, SummaryPlugin registered
      expect(MockReviewEngine).toHaveBeenCalledOnce();
      expect(MockSummaryPlugin).toHaveBeenCalledOnce();
      expect(mockEngineRegister).toHaveBeenCalledOnce();
    });

    it('posts zero complexity when repo scan returns no chunks', async () => {
      setupNoAnalyzableFiles();
      setupRepoScanEmpty();
      mockGetPRPatchData.mockResolvedValue({ patches: {}, diffLines: 0 } as never);

      await handlePRReview(makePayload(true), makeConfig(), logger);

      expect(mockPostResult).toHaveBeenCalledOnce();
      const result = mockPostResult.mock.calls[0][2];
      expect(result).toMatchObject({
        avg_complexity: 0,
        max_complexity: 0,
        files_analyzed: 0,
        status: 'completed',
      });
    });
  });
});

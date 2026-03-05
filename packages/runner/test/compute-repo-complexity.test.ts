import { describe, it, expect, vi, beforeEach } from 'vitest';

import { computeRepoComplexity } from '../src/handlers/pr-review.js';

vi.mock('@liendev/parser', () => ({
  performChunkOnlyIndex: vi.fn(),
  analyzeComplexityFromChunks: vi.fn(),
}));

import { performChunkOnlyIndex, analyzeComplexityFromChunks } from '@liendev/parser';

const mockPerformChunkOnlyIndex = vi.mocked(performChunkOnlyIndex);
const mockAnalyzeComplexityFromChunks = vi.mocked(analyzeComplexityFromChunks);

const logger = {
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computeRepoComplexity', () => {
  it('returns real avg/max when indexing succeeds with chunks', async () => {
    const fakeChunks = [
      { metadata: { file: 'src/foo.ts' } },
      { metadata: { file: 'src/bar.ts' } },
    ] as any;

    mockPerformChunkOnlyIndex.mockResolvedValue({
      success: true,
      filesIndexed: 2,
      chunksCreated: 2,
      durationMs: 100,
      chunks: fakeChunks,
    });

    const fakeReport = {
      files: {},
      summary: {
        filesAnalyzed: 2,
        totalViolations: 0,
        bySeverity: { error: 0, warning: 0 },
        avgComplexity: 12.5,
        maxComplexity: 25,
      },
    } as any;

    mockAnalyzeComplexityFromChunks.mockReturnValue(fakeReport);

    const result = await computeRepoComplexity('/tmp/clone', '15', logger);

    expect(result).not.toBeNull();
    expect(result!.avgComplexity).toBe(12.5);
    expect(result!.maxComplexity).toBe(25);
    expect(result!.report).toBe(fakeReport);
  });

  it('returns null when indexing fails', async () => {
    mockPerformChunkOnlyIndex.mockResolvedValue({
      success: false,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: 50,
      chunks: [],
    });

    const result = await computeRepoComplexity('/tmp/clone', '15', logger);
    expect(result).toBeNull();
    expect(mockAnalyzeComplexityFromChunks).not.toHaveBeenCalled();
  });

  it('returns null when no chunks produced', async () => {
    mockPerformChunkOnlyIndex.mockResolvedValue({
      success: true,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: 50,
      chunks: [],
    });

    const result = await computeRepoComplexity('/tmp/clone', '15', logger);
    expect(result).toBeNull();
    expect(mockAnalyzeComplexityFromChunks).not.toHaveBeenCalled();
  });

  it('passes threshold correctly to analyzeComplexityFromChunks', async () => {
    const fakeChunks = [{ metadata: { file: 'src/app.ts' } }] as any;

    mockPerformChunkOnlyIndex.mockResolvedValue({
      success: true,
      filesIndexed: 1,
      chunksCreated: 1,
      durationMs: 80,
      chunks: fakeChunks,
    });

    mockAnalyzeComplexityFromChunks.mockReturnValue({
      files: {},
      summary: {
        filesAnalyzed: 1,
        totalViolations: 0,
        bySeverity: { error: 0, warning: 0 },
        avgComplexity: 5,
        maxComplexity: 5,
      },
    } as any);

    await computeRepoComplexity('/tmp/clone', '20', logger);

    expect(mockAnalyzeComplexityFromChunks).toHaveBeenCalledWith(fakeChunks, ['src/app.ts'], {
      testPaths: 20,
      mentalLoad: 20,
    });
  });
});

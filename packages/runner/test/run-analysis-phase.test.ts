import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@liendev/review', () => ({
  runComplexityAnalysis: vi.fn(),
  enrichWithTestAssociations: vi.fn(),
  calculateDeltas: vi.fn(),
}));

vi.mock('@liendev/parser', () => ({
  performChunkOnlyIndex: vi.fn(),
  analyzeComplexityFromChunks: vi.fn(),
}));

vi.mock('../src/clone.js', () => ({
  cloneBySha: vi.fn(),
}));

import {
  runComplexityAnalysis,
  enrichWithTestAssociations,
  calculateDeltas,
} from '@liendev/review';
import { performChunkOnlyIndex, analyzeComplexityFromChunks } from '@liendev/parser';
import { cloneBySha } from '../src/clone.js';
import { runAnalysisPhase } from '../src/handlers/pr-review.js';

const mockRunComplexityAnalysis = vi.mocked(runComplexityAnalysis);
const mockEnrichWithTestAssociations = vi.mocked(enrichWithTestAssociations);
const mockCalculateDeltas = vi.mocked(calculateDeltas);
const mockCloneBySha = vi.mocked(cloneBySha);
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

describe('runAnalysisPhase', () => {
  describe('with analyzable files', () => {
    const files = ['src/foo.ts'];
    const fakeReport = {
      files: {},
      summary: {
        filesAnalyzed: 1,
        totalViolations: 0,
        bySeverity: { error: 0, warning: 0 },
        avgComplexity: 10,
        maxComplexity: 20,
      },
    } as any;
    const fakeChunks = [{ metadata: { file: 'src/foo.ts' } }] as any;

    it('returns analysis result when head analysis succeeds', async () => {
      mockRunComplexityAnalysis.mockResolvedValue({
        report: fakeReport,
        chunks: fakeChunks,
      });
      mockEnrichWithTestAssociations.mockResolvedValue(undefined);
      mockCloneBySha.mockResolvedValue({
        dir: '/tmp/base',
        cleanup: vi.fn(),
      } as any);
      // Base analysis returns null — no baseline
      mockRunComplexityAnalysis.mockResolvedValueOnce({
        report: fakeReport,
        chunks: fakeChunks,
      });

      const result = await runAnalysisPhase(
        files,
        '15',
        '/tmp/head',
        'owner/repo',
        'base-sha',
        'token',
        null,
        logger,
      );

      expect(result).not.toBeNull();
      expect(result!.avgComplexity).toBe(10);
      expect(result!.maxComplexity).toBe(20);
      expect(result!.chunks).toBe(fakeChunks);
      expect(result!.currentReport).toBe(fakeReport);
    });

    it('returns null when head analysis fails', async () => {
      mockRunComplexityAnalysis.mockResolvedValue(null as any);

      const result = await runAnalysisPhase(
        files,
        '15',
        '/tmp/head',
        'owner/repo',
        'base-sha',
        'token',
        null,
        logger,
      );

      expect(result).toBeNull();
      expect(logger.warning).toHaveBeenCalledWith('Failed to get complexity report for head');
    });

    it('computes deltas when base analysis succeeds', async () => {
      const baseReport = { ...fakeReport, summary: { ...fakeReport.summary, avgComplexity: 8 } };
      const fakeDeltas = [{ file: 'src/foo.ts', delta: 2 }] as any;

      mockRunComplexityAnalysis
        .mockResolvedValueOnce({ report: fakeReport, chunks: fakeChunks })
        .mockResolvedValueOnce({ report: baseReport, chunks: [] });
      mockEnrichWithTestAssociations.mockResolvedValue(undefined);
      mockCloneBySha.mockResolvedValue({ dir: '/tmp/base', cleanup: vi.fn() } as any);
      mockCalculateDeltas.mockReturnValue(fakeDeltas);

      const result = await runAnalysisPhase(
        files,
        '15',
        '/tmp/head',
        'owner/repo',
        'base-sha',
        'token',
        null,
        logger,
      );

      expect(result!.deltas).toBe(fakeDeltas);
      expect(result!.baselineReport).toBe(baseReport);
      expect(mockCalculateDeltas).toHaveBeenCalledWith(baseReport, fakeReport, files);
    });

    it('handles base clone failure gracefully', async () => {
      mockRunComplexityAnalysis.mockResolvedValue({
        report: fakeReport,
        chunks: fakeChunks,
      });
      mockEnrichWithTestAssociations.mockResolvedValue(undefined);
      mockCloneBySha.mockRejectedValue(new Error('clone failed'));

      const result = await runAnalysisPhase(
        files,
        '15',
        '/tmp/head',
        'owner/repo',
        'base-sha',
        'token',
        null,
        logger,
      );

      expect(result).not.toBeNull();
      expect(result!.baselineReport).toBeNull();
      expect(result!.deltas).toBeNull();
      expect(logger.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to analyze base branch'),
      );
    });
  });

  describe('summary-only path (no analyzable files)', () => {
    it('returns repo complexity when scan succeeds', async () => {
      const fakeChunks = [{ metadata: { file: 'src/app.ts' } }] as any;
      const fakeReport = {
        files: {},
        summary: {
          filesAnalyzed: 1,
          totalViolations: 0,
          bySeverity: { error: 0, warning: 0 },
          avgComplexity: 7.5,
          maxComplexity: 15,
        },
      } as any;

      mockPerformChunkOnlyIndex.mockResolvedValue({
        success: true,
        filesIndexed: 1,
        chunksCreated: 1,
        durationMs: 100,
        chunks: fakeChunks,
      });
      mockAnalyzeComplexityFromChunks.mockReturnValue(fakeReport);

      const result = await runAnalysisPhase(
        [],
        '15',
        '/tmp/head',
        'owner/repo',
        'base-sha',
        'token',
        null,
        logger,
      );

      expect(result).not.toBeNull();
      expect(result!.avgComplexity).toBe(7.5);
      expect(result!.maxComplexity).toBe(15);
      expect(result!.chunks).toEqual([]);
      expect(result!.baselineReport).toBeNull();
      expect(result!.deltas).toBeNull();
    });

    it('returns zero-report when scan produces no chunks', async () => {
      mockPerformChunkOnlyIndex.mockResolvedValue({
        success: true,
        filesIndexed: 0,
        chunksCreated: 0,
        durationMs: 50,
        chunks: [],
      });

      const result = await runAnalysisPhase(
        [],
        '15',
        '/tmp/head',
        'owner/repo',
        'base-sha',
        'token',
        null,
        logger,
      );

      expect(result).not.toBeNull();
      expect(result!.avgComplexity).toBe(0);
      expect(result!.maxComplexity).toBe(0);
      expect(result!.currentReport.summary.filesAnalyzed).toBe(0);
    });
  });
});

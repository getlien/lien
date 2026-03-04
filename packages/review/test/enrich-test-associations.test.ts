import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichWithTestAssociations } from '../src/analysis.js';
import { silentLogger } from '../src/test-helpers.js';
import type { ComplexityReport } from '@liendev/parser';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@liendev/parser', async importOriginal => {
  const actual = await importOriginal<typeof import('@liendev/parser')>();
  return {
    ...actual,
    performChunkOnlyIndex: vi.fn(),
    findTestAssociationsFromChunks: vi.fn(),
    isTestFile: vi.fn((p: string) => p.includes('.test.') || p.includes('.spec.')),
  };
});

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
}));

vi.mock('node:path', async importOriginal => {
  const actual = await importOriginal<typeof import('node:path')>();
  return { ...actual, join: actual.join };
});

import { performChunkOnlyIndex, findTestAssociationsFromChunks } from '@liendev/parser';
import { readdir } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(filepaths: string[] = []): ComplexityReport {
  const files: ComplexityReport['files'] = {};
  for (const fp of filepaths) {
    files[fp] = {
      violations: [],
      dependents: [],
      testAssociations: [],
      riskLevel: 'low',
    };
  }
  return {
    files,
    summary: {
      filesAnalyzed: filepaths.length,
      totalViolations: 0,
      bySeverity: { error: 0, warning: 0 },
      avgComplexity: 0,
      maxComplexity: 0,
    },
  };
}

function makeDirent(name: string, isFile = true) {
  return {
    name,
    parentPath: '/repo/src',
    isFile: () => isFile,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enrichWithTestAssociations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when no test files found', async () => {
    vi.mocked(readdir).mockResolvedValue([] as any);

    const report = makeReport(['src/app.ts']);
    await enrichWithTestAssociations(report, ['src/app.ts'], '/repo', silentLogger);

    expect(performChunkOnlyIndex).not.toHaveBeenCalled();
    expect(report.files['src/app.ts'].testAssociations).toEqual([]);
  });

  it('populates testAssociations on files already in report', async () => {
    vi.mocked(readdir).mockResolvedValue([makeDirent('app.test.ts')] as any);
    vi.mocked(performChunkOnlyIndex).mockResolvedValue({
      success: true,
      chunks: [{ metadata: { file: '/repo/src/app.test.ts', imports: ['./app'] } }],
      chunksCreated: 1,
      filesIndexed: 1,
    } as any);
    vi.mocked(findTestAssociationsFromChunks).mockReturnValue(
      new Map([['src/app.ts', ['/repo/src/app.test.ts']]]),
    );

    const report = makeReport(['src/app.ts']);
    await enrichWithTestAssociations(report, ['src/app.ts'], '/repo', silentLogger);

    expect(report.files['src/app.ts'].testAssociations).toEqual(['/repo/src/app.test.ts']);
  });

  it('creates stub entry for clean changed files not in report', async () => {
    vi.mocked(readdir).mockResolvedValue([makeDirent('utils.test.ts')] as any);
    vi.mocked(performChunkOnlyIndex).mockResolvedValue({
      success: true,
      chunks: [{ metadata: { file: '/repo/src/utils.test.ts', imports: ['./utils'] } }],
      chunksCreated: 1,
      filesIndexed: 1,
    } as any);
    vi.mocked(findTestAssociationsFromChunks).mockReturnValue(
      new Map([['src/utils.ts', ['/repo/src/utils.test.ts']]]),
    );

    // Report has no entry for src/utils.ts (clean file, no violations)
    const report = makeReport([]);
    await enrichWithTestAssociations(report, ['src/utils.ts'], '/repo', silentLogger);

    expect(report.files['src/utils.ts']).toBeDefined();
    expect(report.files['src/utils.ts'].testAssociations).toEqual(['/repo/src/utils.test.ts']);
  });

  it('sets empty testAssociations for files not in the assocMap', async () => {
    vi.mocked(readdir).mockResolvedValue([makeDirent('other.test.ts')] as any);
    vi.mocked(performChunkOnlyIndex).mockResolvedValue({
      success: true,
      chunks: [{ metadata: { file: '/repo/src/other.test.ts', imports: [] } }],
      chunksCreated: 1,
      filesIndexed: 1,
    } as any);
    // No associations for src/app.ts
    vi.mocked(findTestAssociationsFromChunks).mockReturnValue(new Map());

    const report = makeReport(['src/app.ts']);
    await enrichWithTestAssociations(report, ['src/app.ts'], '/repo', silentLogger);

    expect(report.files['src/app.ts'].testAssociations).toEqual([]);
  });

  it('returns early when indexing produces no chunks', async () => {
    vi.mocked(readdir).mockResolvedValue([makeDirent('app.test.ts')] as any);
    vi.mocked(performChunkOnlyIndex).mockResolvedValue({
      success: true,
      chunks: [],
      chunksCreated: 0,
      filesIndexed: 0,
    } as any);

    const report = makeReport(['src/app.ts']);
    await enrichWithTestAssociations(report, ['src/app.ts'], '/repo', silentLogger);

    expect(findTestAssociationsFromChunks).not.toHaveBeenCalled();
  });

  it('returns early when indexing fails', async () => {
    vi.mocked(readdir).mockResolvedValue([makeDirent('app.test.ts')] as any);
    vi.mocked(performChunkOnlyIndex).mockResolvedValue({
      success: false,
      chunks: undefined,
      chunksCreated: 0,
      filesIndexed: 0,
    } as any);

    const report = makeReport(['src/app.ts']);
    await enrichWithTestAssociations(report, ['src/app.ts'], '/repo', silentLogger);

    expect(findTestAssociationsFromChunks).not.toHaveBeenCalled();
  });
});

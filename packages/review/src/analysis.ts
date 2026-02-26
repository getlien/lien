/**
 * Analysis utilities — file filtering and complexity analysis.
 *
 * Extracted from review-engine.ts. These are the only two functions
 * from that module still used at runtime.
 */

import {
  performChunkOnlyIndex,
  analyzeComplexityFromChunks,
  getSupportedExtensions,
  type ComplexityReport,
  type CodeChunk,
} from '@liendev/parser';

import type { Logger } from './logger.js';

/**
 * Filter files to only include those that can be analyzed
 * (excludes non-code files, vendor, node_modules, etc.)
 */
export function filterAnalyzableFiles(files: string[]): string[] {
  const codeExtensions = new Set(getSupportedExtensions().map(ext => `.${ext}`));

  const excludePatterns = [
    /node_modules\//,
    /vendor\//,
    /dist\//,
    /build\//,
    /\.min\./,
    /\.bundle\./,
    /\.generated\./,
    /package-lock\.json/,
    /yarn\.lock/,
    /pnpm-lock\.yaml/,
  ];

  return files.filter(file => {
    // Check extension
    const ext = file.slice(file.lastIndexOf('.'));
    if (!codeExtensions.has(ext)) {
      return false;
    }

    // Check exclude patterns
    for (const pattern of excludePatterns) {
      if (pattern.test(file)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Run complexity analysis using @liendev/parser
 */
export async function runComplexityAnalysis(
  files: string[],
  threshold: string,
  rootDir: string,
  logger: Logger,
): Promise<{ report: ComplexityReport; chunks: CodeChunk[] } | null> {
  if (files.length === 0) {
    logger.info('No files to analyze');
    return null;
  }

  try {
    // Use performChunkOnlyIndex for fast chunk-only indexing (no VectorDB needed)
    // Pass filesToIndex to skip full repo scan — only chunk the changed files
    logger.info(`Indexing ${files.length} files (chunk-only)...`);
    const indexResult = await performChunkOnlyIndex(rootDir, { filesToIndex: files });

    logger.info(
      `Indexing complete: ${indexResult.chunksCreated} chunks from ${indexResult.filesIndexed} files (success: ${indexResult.success})`,
    );
    if (!indexResult.success || !indexResult.chunks || indexResult.chunks.length === 0) {
      logger.warning(`Indexing produced no chunks for ${rootDir}`);
      return null;
    }

    // Run complexity analysis from in-memory chunks (no VectorDB needed)
    logger.info('Analyzing complexity...');
    const thresholdNum = parseInt(threshold, 10);
    const report = analyzeComplexityFromChunks(
      indexResult.chunks,
      files,
      !isNaN(thresholdNum) ? { testPaths: thresholdNum, mentalLoad: thresholdNum } : undefined,
    );
    logger.info(`Found ${report.summary.totalViolations} violations`);

    return { report, chunks: indexResult.chunks };
  } catch (error) {
    logger.error(`Failed to run complexity analysis: ${error}`);
    return null;
  }
}

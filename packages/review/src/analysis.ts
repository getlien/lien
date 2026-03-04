/**
 * Analysis utilities — file filtering and complexity analysis.
 *
 * Extracted from review-engine.ts. These are the only two functions
 * from that module still used at runtime.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  performChunkOnlyIndex,
  analyzeComplexityFromChunks,
  getSupportedExtensions,
  findTestAssociationsFromChunks,
  isTestFile,
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

const TEST_SCAN_EXCLUDE = [/node_modules/, /vendor/, /dist/, /build/];

async function scanTestFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { recursive: true, withFileTypes: true });
  return entries
    .filter(e => e.isFile())
    .map(e => join(e.parentPath, e.name))
    .filter(p => isTestFile(p) && !TEST_SCAN_EXCLUDE.some(r => r.test(p)));
}

/**
 * Enrich a ComplexityReport with test association data.
 * Scans test files from the cloned repo and maps them to changed source files.
 */
export async function enrichWithTestAssociations(
  report: ComplexityReport,
  changedFiles: string[],
  rootDir: string,
  logger: Logger,
): Promise<void> {
  const testFiles = await scanTestFiles(rootDir);
  if (testFiles.length === 0) {
    logger.info('No test files found, skipping test association enrichment');
    return;
  }

  logger.info(`Indexing ${testFiles.length} test files for coverage associations...`);
  const result = await performChunkOnlyIndex(rootDir, { filesToIndex: testFiles });
  if (!result.success || !result.chunks?.length) {
    logger.warning('Test file indexing produced no chunks, skipping');
    return;
  }

  const assocMap = findTestAssociationsFromChunks(changedFiles, result.chunks, rootDir);

  for (const filepath of changedFiles) {
    if (!report.files[filepath]) {
      report.files[filepath] = {
        violations: [],
        dependents: [],
        testAssociations: [],
        riskLevel: 'low',
      };
    }
    report.files[filepath].testAssociations = assocMap.get(filepath) ?? [];
  }

  const coveredCount = [...assocMap.values()].filter(v => v.length > 0).length;
  logger.info(`Test associations: ${coveredCount}/${changedFiles.length} files covered`);
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

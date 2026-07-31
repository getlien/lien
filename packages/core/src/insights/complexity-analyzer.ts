import type { VectorDBInterface, SearchResult } from '../vectordb/types.js';
import type { ComplexityReport, CodeChunk } from '@liendev/parser';
import { analyzeComplexityFromChunks } from '@liendev/parser';

/**
 * Analyzer for code complexity based on indexed codebase.
 *
 * Complexity analysis (violation detection, report building, dependency and
 * test-association enrichment) is a pure function of chunks with no
 * dependency on Lien's storage layer, so the canonical implementation lives
 * in `@liendev/parser`'s `analyzeComplexityFromChunks`
 * (packages/parser/src/insights/chunk-complexity.ts). This class is a thin
 * bridge from that pure function to `VectorDBInterface` (the persisted-index
 * path) — the one piece that's genuinely core's concern. See #994 Phase 4;
 * this used to carry a hand-synchronized copy of the entire algorithm, which
 * is how #979 shipped (the copy's testAssociations enrichment was never
 * wired up).
 */
export class ComplexityAnalyzer {
  constructor(private vectorDB: VectorDBInterface) {}

  /**
   * Analyze complexity of codebase or specific files.
   * @param files - Optional list of specific files to analyze
   * @returns Complexity report with violations and summary
   */
  async analyze(files?: string[]): Promise<ComplexityReport> {
    // Fetch all chunks even with a `files` filter — analyzeComplexityFromChunks
    // needs the complete dataset for dependency and test-association
    // enrichment (a violating file's dependents/tests can live outside the
    // filtered set), and narrows `report.files` to `files` internally.
    const allChunks: SearchResult[] = await this.vectorDB.scanAll();
    return analyzeComplexityFromChunks(allChunks as CodeChunk[], files);
  }

  /**
   * Analyze complexity from in-memory chunks (no structural store needed).
   * Fast path for complexity-only analysis without a persisted index.
   */
  static analyzeFromChunks(
    chunks: CodeChunk[],
    files?: string[],
    thresholdOverrides?: { testPaths?: number; mentalLoad?: number },
  ): ComplexityReport {
    return analyzeComplexityFromChunks(chunks, files, thresholdOverrides);
  }
}

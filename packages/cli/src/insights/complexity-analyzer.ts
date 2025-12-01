import { VectorDB } from '../vectordb/lancedb.js';
import { LienConfig } from '../config/schema.js';
import { ComplexityViolation, ComplexityReport, FileComplexityData } from './types.js';
import { ChunkMetadata } from '../indexer/types.js';
import path from 'path';

/**
 * Analyzer for code complexity based on indexed codebase
 */
export class ComplexityAnalyzer {
  constructor(
    private vectorDB: VectorDB,
    private config: LienConfig
  ) {}

  /**
   * Analyze complexity of codebase or specific files
   * @param files - Optional list of specific files to analyze
   * @returns Complexity report with violations and summary
   */
  async analyze(files?: string[]): Promise<ComplexityReport> {
    // 1. Get all chunks from index
    const allChunks = await this.vectorDB.scanWithFilter({ limit: 10000 });
    
    // 2. Filter to specified files if provided
    const chunks = files 
      ? allChunks.filter(c => this.matchesAnyFile(c.metadata.file, files))
      : allChunks;
    
    // 3. Find violations
    const violations = this.findViolations(chunks);
    
    // 4. Build report grouped by file
    return this.buildReport(violations, chunks);
  }

  /**
   * Check if a chunk's file matches any of the target files
   */
  private matchesAnyFile(chunkFile: string, targetFiles: string[]): boolean {
    const normalizedChunkFile = path.normalize(chunkFile);
    return targetFiles.some(target => {
      const normalizedTarget = path.normalize(target);
      return normalizedChunkFile.includes(normalizedTarget) || 
             normalizedTarget.includes(normalizedChunkFile);
    });
  }

  /**
   * Find all complexity violations based on thresholds
   */
  private findViolations(chunks: Array<{ content: string; metadata: ChunkMetadata }>): ComplexityViolation[] {
    const violations: ComplexityViolation[] = [];
    const thresholds = this.config.complexity?.thresholds || { method: 10, file: 50, average: 6 };
    const severity = this.config.complexity?.severity || { warning: 1.0, error: 2.0 };

    for (const chunk of chunks) {
      const metadata = chunk.metadata;
      
      // Skip chunks without complexity data
      if (!metadata.complexity || metadata.complexity === undefined) {
        continue;
      }

      // Only check function/method complexity (not file-level yet)
      if (metadata.symbolType !== 'function' && metadata.symbolType !== 'method') {
        continue;
      }

      const threshold = thresholds.method;
      const complexity = metadata.complexity;

      // Check if complexity exceeds threshold
      if (complexity > threshold) {
        // Determine severity based on multiplier
        const exceedsError = complexity >= threshold * severity.error;
        const violationSeverity = exceedsError ? 'error' : 'warning';

        violations.push({
          filepath: metadata.file,
          startLine: metadata.startLine,
          endLine: metadata.endLine,
          symbolName: metadata.symbolName || 'unknown',
          symbolType: metadata.symbolType as 'function' | 'method',
          language: metadata.language,
          complexity,
          threshold,
          severity: violationSeverity,
          message: `${metadata.symbolType} complexity ${complexity} exceeds threshold ${threshold}`,
        });
      }
    }

    return violations;
  }

  /**
   * Build the final report with summary and per-file data
   */
  private buildReport(
    violations: ComplexityViolation[],
    allChunks: Array<{ content: string; metadata: ChunkMetadata }>
  ): ComplexityReport {
    // Group violations by file
    const fileViolationsMap = new Map<string, ComplexityViolation[]>();
    for (const violation of violations) {
      const existing = fileViolationsMap.get(violation.filepath) || [];
      existing.push(violation);
      fileViolationsMap.set(violation.filepath, existing);
    }

    // Get unique files from all analyzed chunks
    const analyzedFiles = new Set(allChunks.map(c => c.metadata.file));

    // Build file data
    const files: Record<string, FileComplexityData> = {};
    for (const filepath of analyzedFiles) {
      const fileViolations = fileViolationsMap.get(filepath) || [];
      files[filepath] = {
        violations: fileViolations,
        dependents: [], // Will be enriched later if needed
        testAssociations: [], // Will be enriched later if needed
        riskLevel: this.calculateRiskLevel(fileViolations),
      };
    }

    // Calculate summary statistics
    const errorCount = violations.filter(v => v.severity === 'error').length;
    const warningCount = violations.filter(v => v.severity === 'warning').length;

    // Calculate average and max complexity from all chunks with complexity data
    const complexityValues = allChunks
      .filter(c => c.metadata.complexity !== undefined && c.metadata.complexity > 0)
      .map(c => c.metadata.complexity!);

    const avgComplexity = complexityValues.length > 0
      ? complexityValues.reduce((sum, val) => sum + val, 0) / complexityValues.length
      : 0;

    const maxComplexity = complexityValues.length > 0
      ? Math.max(...complexityValues)
      : 0;

    return {
      summary: {
        filesAnalyzed: analyzedFiles.size,
        totalViolations: violations.length,
        bySeverity: { error: errorCount, warning: warningCount },
        avgComplexity: Math.round(avgComplexity * 10) / 10, // Round to 1 decimal
        maxComplexity,
      },
      files,
    };
  }

  /**
   * Calculate risk level based on violations
   */
  private calculateRiskLevel(violations: ComplexityViolation[]): 'low' | 'medium' | 'high' | 'critical' {
    if (violations.length === 0) return 'low';

    const hasErrors = violations.some(v => v.severity === 'error');
    const errorCount = violations.filter(v => v.severity === 'error').length;

    if (errorCount >= 3) return 'critical';
    if (hasErrors) return 'high';
    if (violations.length >= 3) return 'medium';
    return 'low';
  }
}


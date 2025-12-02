import { VectorDB } from '../vectordb/lancedb.js';
import { LienConfig } from '../config/schema.js';
import { ComplexityViolation, ComplexityReport, FileComplexityData, RISK_ORDER, RiskLevel } from './types.js';
import { ChunkMetadata } from '../indexer/types.js';
import { analyzeDependencies } from '../indexer/dependency-analyzer.js';
import { SearchResult } from '../vectordb/types.js';

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
    // 1. Get all chunks from index (uses full scan internally for LanceDB)
    // Note: We fetch all chunks even with --files filter because dependency analysis
    // needs the complete dataset to find dependents accurately
    const allChunks = await this.vectorDB.scanAll();
    
    // 2. Filter to specified files if provided
    const chunks = files 
      ? allChunks.filter(c => this.matchesAnyFile(c.metadata.file, files))
      : allChunks;
    
    // 3. Find violations from filtered chunks
    const violations = this.findViolations(chunks);
    
    // 4. Build report - pass filtered chunks for file list, but keep violations from those files
    const report = this.buildReport(violations, chunks);
    
    // 5. Enrich files with violations with dependency data
    this.enrichWithDependencies(report, allChunks as SearchResult[]);
    
    return report;
  }

  /**
   * Check if a chunk's file matches any of the target files
   * Uses exact match or suffix matching to avoid unintended matches
   */
  private matchesAnyFile(chunkFile: string, targetFiles: string[]): boolean {
    // Normalize to forward slashes for cross-platform consistency
    // Don't use path.normalize() as its behavior is platform-dependent
    const normalizedChunkFile = chunkFile.replace(/\\/g, '/');
    return targetFiles.some(target => {
      const normalizedTarget = target.replace(/\\/g, '/');
      // Exact match or target is a suffix of the chunk file
      return normalizedChunkFile === normalizedTarget || 
             normalizedChunkFile.endsWith('/' + normalizedTarget);
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
      
      // Skip chunks without complexity data or with 0 complexity
      if (!metadata.complexity) {
        continue;
      }

      // Only check function/method complexity (not file-level yet)
      if (metadata.symbolType !== 'function' && metadata.symbolType !== 'method') {
        continue;
      }

      const baseThreshold = thresholds.method;
      const complexity = metadata.complexity;
      
      // Apply severity multipliers to threshold
      const warningThreshold = baseThreshold * severity.warning;
      const errorThreshold = baseThreshold * severity.error;

      // Check if complexity meets or exceeds warning threshold
      if (complexity >= warningThreshold) {
        // Determine severity: error if exceeds error threshold, otherwise warning
        const violationSeverity = complexity >= errorThreshold ? 'error' : 'warning';
        const effectiveThreshold = violationSeverity === 'error' ? errorThreshold : warningThreshold;

        violations.push({
          filepath: metadata.file,
          startLine: metadata.startLine,
          endLine: metadata.endLine,
          symbolName: metadata.symbolName || 'unknown',
          symbolType: metadata.symbolType as 'function' | 'method',
          language: metadata.language,
          complexity,
          threshold: Math.round(effectiveThreshold), // Show the effective threshold that was exceeded
          severity: violationSeverity,
          message: `${metadata.symbolType} complexity ${complexity} exceeds threshold ${Math.round(effectiveThreshold)}`,
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
  private calculateRiskLevel(violations: ComplexityViolation[]): RiskLevel {
    if (violations.length === 0) return 'low';

    const hasErrors = violations.some(v => v.severity === 'error');
    const errorCount = violations.filter(v => v.severity === 'error').length;

    if (errorCount >= 3) return 'critical';
    if (hasErrors) return 'high';
    if (violations.length >= 3) return 'medium';
    return 'low';
  }

  /**
   * Enrich files with violations with dependency data
   * This adds:
   * - List of dependent files (who imports this?)
   * - Boosted risk level based on dependents + complexity
   */
  private enrichWithDependencies(
    report: ComplexityReport,
    allChunks: SearchResult[]
  ): void {
    const workspaceRoot = process.cwd();

    // Only enrich files that have violations (to save computation)
    const filesWithViolations = Object.entries(report.files)
      .filter(([_, data]) => data.violations.length > 0)
      .map(([filepath, _]) => filepath);

    for (const filepath of filesWithViolations) {
      const fileData = report.files[filepath];
      
      // Analyze dependencies for this file
      const depAnalysis = analyzeDependencies(filepath, allChunks, workspaceRoot);
      
      // Update file data with dependency information
      fileData.dependents = depAnalysis.dependents.map(d => d.filepath);
      fileData.dependentCount = depAnalysis.dependentCount;
      
      // Boost risk level based on dependency analysis
      // Take the higher of the two risk levels
      if (RISK_ORDER[depAnalysis.riskLevel] > RISK_ORDER[fileData.riskLevel]) {
        fileData.riskLevel = depAnalysis.riskLevel;
      }
      
      // Add complexity metrics if available
      if (depAnalysis.complexityMetrics) {
        fileData.dependentComplexityMetrics = {
          averageComplexity: depAnalysis.complexityMetrics.averageComplexity,
          maxComplexity: depAnalysis.complexityMetrics.maxComplexity,
          filesWithComplexityData: depAnalysis.complexityMetrics.filesWithComplexityData,
        };
      }
    }
  }
}


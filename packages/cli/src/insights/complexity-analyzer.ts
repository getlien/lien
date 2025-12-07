import { VectorDB } from '../vectordb/lancedb.js';
import { LienConfig } from '../config/schema.js';
import { ComplexityViolation, ComplexityReport, FileComplexityData, RISK_ORDER, RiskLevel, HalsteadDetails } from './types.js';
import { ChunkMetadata } from '../indexer/types.js';
import { analyzeDependencies } from '../indexer/dependency-analyzer.js';
import { SearchResult } from '../vectordb/types.js';

/**
 * Hardcoded severity multipliers:
 * - Warning: triggers at 1x threshold (e.g., testPaths >= 15)
 * - Error: triggers at 2x threshold (e.g., testPaths >= 30)
 */
const SEVERITY = { warning: 1.0, error: 2.0 } as const;

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
   * Normalize a file path to a consistent relative format
   * Converts absolute paths to relative paths from workspace root
   */
  private normalizeFilePath(filepath: string): string {
    const workspaceRoot = process.cwd();
    // Convert to forward slashes first
    const normalized = filepath.replace(/\\/g, '/');
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
    
    // Convert absolute paths to relative
    if (normalized.startsWith(normalizedRoot + '/')) {
      return normalized.slice(normalizedRoot.length + 1);
    }
    if (normalized.startsWith(normalizedRoot)) {
      return normalized.slice(normalizedRoot.length);
    }
    return normalized;
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
   * Create a violation if complexity exceeds threshold
   */
  private createViolation(
    metadata: ChunkMetadata,
    complexity: number,
    baseThreshold: number,
    metricType: ComplexityViolation['metricType']
  ): ComplexityViolation | null {
    const warningThreshold = baseThreshold * SEVERITY.warning;
    const errorThreshold = baseThreshold * SEVERITY.error;

    if (complexity < warningThreshold) return null;

    const violationSeverity = complexity >= errorThreshold ? 'error' : 'warning';
    const effectiveThreshold = violationSeverity === 'error' ? errorThreshold : warningThreshold;
    
    // Human-friendly messages
    const message = metricType === 'cyclomatic'
      ? `Needs ~${complexity} test cases for full coverage (threshold: ${Math.round(effectiveThreshold)})`
      : `Mental load ${complexity} exceeds threshold ${Math.round(effectiveThreshold)} (hard to follow)`;

    return {
      filepath: metadata.file,
      startLine: metadata.startLine,
      endLine: metadata.endLine,
      symbolName: metadata.symbolName || 'unknown',
      symbolType: metadata.symbolType as 'function' | 'method',
      language: metadata.language,
      complexity,
      threshold: Math.round(effectiveThreshold),
      severity: violationSeverity,
      message,
      metricType,
    };
  }

  /**
   * Deduplicate and filter chunks to only function/method types.
   * Handles potential index duplicates by tracking file+line ranges.
   */
  private getUniqueFunctionChunks(
    chunks: Array<{ content: string; metadata: ChunkMetadata }>
  ): ChunkMetadata[] {
    const seen = new Set<string>();
    const result: ChunkMetadata[] = [];
    
    for (const { metadata } of chunks) {
      if (metadata.symbolType !== 'function' && metadata.symbolType !== 'method') continue;
      
      const key = `${metadata.file}:${metadata.startLine}-${metadata.endLine}`;
      if (seen.has(key)) continue;
      
      seen.add(key);
      result.push(metadata);
    }
    
    return result;
  }

  /**
   * Convert Halstead effort to time in minutes.
   * Formula: Time (seconds) = Effort / 18, so Time (minutes) = Effort / 1080
   */
  private effortToMinutes(effort: number): number {
    return effort / 1080;
  }

  /**
   * Format minutes as human-readable time (e.g., "2h 30m" or "45m")
   */
  private formatTime(minutes: number): string {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${Math.round(minutes)}m`;
  }

  /**
   * Create a Halstead violation if metrics exceed thresholds
   */
  private createHalsteadViolation(
    metadata: ChunkMetadata,
    metricValue: number,
    threshold: number,
    metricType: 'halstead_effort' | 'halstead_bugs'
  ): ComplexityViolation | null {
    const warningThreshold = threshold * SEVERITY.warning;
    const errorThreshold = threshold * SEVERITY.error;

    if (metricValue < warningThreshold) return null;

    const violationSeverity = metricValue >= errorThreshold ? 'error' : 'warning';
    const effectiveThreshold = violationSeverity === 'error' ? errorThreshold : warningThreshold;
    
    // For effort, show time in minutes; for bugs, show decimal with 2 places
    let message: string;
    if (metricType === 'halstead_effort') {
      const timeMinutes = this.effortToMinutes(metricValue);
      const thresholdMinutes = this.effortToMinutes(effectiveThreshold);
      message = `Time to understand ~${this.formatTime(timeMinutes)} exceeds threshold ${this.formatTime(thresholdMinutes)}`;
    } else {
      message = `Estimated bugs ${metricValue.toFixed(2)} exceeds threshold ${effectiveThreshold.toFixed(1)}`;
    }

    const halsteadDetails: HalsteadDetails = {
      volume: metadata.halsteadVolume || 0,
      difficulty: metadata.halsteadDifficulty || 0,
      effort: metadata.halsteadEffort || 0,
      bugs: metadata.halsteadBugs || 0,
    };

    // Store human-scale values for complexity/threshold:
    // - halstead_effort: time in minutes (not raw effort)
    // - halstead_bugs: bugs estimate (decimal)
    let complexity: number;
    let displayThreshold: number;
    if (metricType === 'halstead_effort') {
      // Store time in minutes for comparable deltas
      complexity = Math.round(this.effortToMinutes(metricValue));
      displayThreshold = Math.round(this.effortToMinutes(effectiveThreshold));
    } else {
      // halstead_bugs: store as-is (small decimal)
      complexity = metricValue;
      displayThreshold = effectiveThreshold;
    }

    return {
      filepath: metadata.file,
      startLine: metadata.startLine,
      endLine: metadata.endLine,
      symbolName: metadata.symbolName || 'unknown',
      symbolType: metadata.symbolType as 'function' | 'method',
      language: metadata.language,
      complexity,
      threshold: displayThreshold,
      severity: violationSeverity,
      message,
      metricType,
      halsteadDetails,
    };
  }

  /**
   * Check complexity metrics and create violations for a single chunk.
   */
  private checkChunkComplexity(
    metadata: ChunkMetadata,
    thresholds: { testPaths: number; mentalLoad: number; halsteadEffort?: number; estimatedBugs?: number }
  ): ComplexityViolation[] {
    const violations: ComplexityViolation[] = [];
    
    // Check test paths (cyclomatic complexity)
    if (metadata.complexity) {
      const v = this.createViolation(metadata, metadata.complexity, thresholds.testPaths, 'cyclomatic');
      if (v) violations.push(v);
    }
    
    // Check mental load (cognitive complexity)
    if (metadata.cognitiveComplexity) {
      const v = this.createViolation(metadata, metadata.cognitiveComplexity, thresholds.mentalLoad, 'cognitive');
      if (v) violations.push(v);
    }
    
    // Check time to understand (Halstead effort)
    if (thresholds.halsteadEffort && metadata.halsteadEffort) {
      const v = this.createHalsteadViolation(metadata, metadata.halsteadEffort, thresholds.halsteadEffort, 'halstead_effort');
      if (v) violations.push(v);
    }
    
    // Check estimated bugs
    if (thresholds.estimatedBugs && metadata.halsteadBugs) {
      const v = this.createHalsteadViolation(metadata, metadata.halsteadBugs, thresholds.estimatedBugs, 'halstead_bugs');
      if (v) violations.push(v);
    }
    
    return violations;
  }

  /**
   * Convert time in minutes to Halstead effort.
   * Formula: Time (seconds) = Effort / 18, so Effort = Time (minutes) * 60 * 18 = Time * 1080
   */
  private minutesToEffort(minutes: number): number {
    return minutes * 1080;
  }

  /**
   * Find all complexity violations based on thresholds.
   * Checks cyclomatic, cognitive, and Halstead complexity.
   */
  private findViolations(chunks: Array<{ content: string; metadata: ChunkMetadata }>): ComplexityViolation[] {
    const configThresholds = this.config.complexity?.thresholds;
    
    // Convert timeToUnderstandMinutes to effort internally
    const halsteadEffort = configThresholds?.timeToUnderstandMinutes 
      ? this.minutesToEffort(configThresholds.timeToUnderstandMinutes)
      : this.minutesToEffort(60); // Default: 60 minutes = 64,800 effort
    
    const thresholds = { 
      testPaths: configThresholds?.testPaths ?? 15, 
      mentalLoad: configThresholds?.mentalLoad ?? 15, 
      halsteadEffort,
      estimatedBugs: configThresholds?.estimatedBugs ?? 1.5,
    };
    const functionChunks = this.getUniqueFunctionChunks(chunks);
    
    return functionChunks.flatMap(metadata => 
      this.checkChunkComplexity(metadata, thresholds)
    );
  }

  /**
   * Build the final report with summary and per-file data
   */
  private buildReport(
    violations: ComplexityViolation[],
    allChunks: Array<{ content: string; metadata: ChunkMetadata }>
  ): ComplexityReport {
    // Normalize violation filepaths and group by normalized path
    const fileViolationsMap = new Map<string, ComplexityViolation[]>();
    for (const violation of violations) {
      const normalizedPath = this.normalizeFilePath(violation.filepath);
      // Update violation's filepath to normalized form
      violation.filepath = normalizedPath;
      const existing = fileViolationsMap.get(normalizedPath) || [];
      existing.push(violation);
      fileViolationsMap.set(normalizedPath, existing);
    }

    // Get unique files from all analyzed chunks, normalized to relative paths
    const analyzedFiles = new Set(allChunks.map(c => this.normalizeFilePath(c.metadata.file)));

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


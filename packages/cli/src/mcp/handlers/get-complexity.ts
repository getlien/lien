import collect from 'collect.js';
import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetComplexitySchema } from '../schemas/index.js';
import type { GetComplexityInput } from '../schemas/index.js';
import { ComplexityAnalyzer } from '@liendev/core';
import type { ComplexityViolation, FileComplexityData, ComplexityReport } from '@liendev/parser';
import type { ToolContext, MCPToolResult } from '../types.js';

// ============================================================================
// Types
// ============================================================================

type TransformedViolation = ReturnType<typeof transformViolation>;

interface ProcessedViolations {
  violations: TransformedViolation[];
  topViolations: TransformedViolation[];
  bySeverity: { error: number; warning: number };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Transform a violation with file-level metadata for API response.
 */
function transformViolation(v: ComplexityViolation, fileData: FileComplexityData) {
  return {
    filepath: v.filepath,
    symbolName: v.symbolName,
    symbolType: v.symbolType,
    startLine: v.startLine,
    endLine: v.endLine,
    complexity: v.complexity,
    metricType: v.metricType,
    threshold: v.threshold,
    severity: v.severity,
    language: v.language,
    message: v.message,
    dependentCount: fileData.dependentCount || 0,
    riskLevel: fileData.riskLevel,
    ...(v.halsteadDetails && { halsteadDetails: v.halsteadDetails }),
  };
}

/**
 * Process violations from complexity report.
 * Transforms, filters, and sorts violations.
 */
function processViolations(
  report: ComplexityReport,
  threshold: number | undefined,
  top: number,
  metricType?: GetComplexityInput['metricType'],
): ProcessedViolations {
  const allViolations: TransformedViolation[] = collect(Object.entries(report.files))
    .flatMap(([, /* filepath unused */ fileData]) =>
      fileData.violations
        .filter(v => !metricType || v.metricType === metricType)
        .filter(v => threshold === undefined || v.complexity >= threshold)
        .map(v => transformViolation(v, fileData)),
    )
    .sortByDesc('complexity')
    .all() as unknown as TransformedViolation[];

  const violations = allViolations;

  const severityCounts = collect(violations).countBy('severity').all() as {
    error?: number;
    warning?: number;
  };

  return {
    violations,
    topViolations: violations.slice(0, top),
    bySeverity: {
      error: severityCounts['error'] || 0,
      warning: severityCounts['warning'] || 0,
    },
  };
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle get_complexity tool calls.
 * Analyzes complexity for files or the entire codebase.
 */
export async function handleGetComplexity(args: unknown, ctx: ToolContext): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(GetComplexitySchema, async validatedArgs => {
    const { files, top, threshold, metricType } = validatedArgs;
    log('Analyzing complexity...');
    await checkAndReconnect();

    // Step 1: Run complexity analysis
    const analyzer = new ComplexityAnalyzer(vectorDB);
    const report = await analyzer.analyze(files);
    log(`Analyzed ${report.summary.filesAnalyzed} files`);

    // Step 2: Process violations
    const { violations, topViolations, bySeverity } = processViolations(
      report,
      threshold,
      top ?? 10,
      metricType,
    );

    return {
      indexInfo: getIndexMetadata(),
      summary: {
        filesAnalyzed: report.summary.filesAnalyzed,
        avgComplexity: report.summary.avgComplexity,
        maxComplexity: report.summary.maxComplexity,
        violationCount: violations.length,
        bySeverity,
      },
      violations: topViolations,
    };
  })(args);
}

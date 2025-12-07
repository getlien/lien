import collect from 'collect.js';
import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetComplexitySchema } from '../schemas/index.js';
import { ComplexityAnalyzer } from '../../insights/complexity-analyzer.js';
import type { ToolContext, MCPToolResult } from '../types.js';
import type { ComplexityViolation, FileComplexityData } from '../../insights/types.js';

/**
 * Transform a violation with file-level metadata for API response
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
 * Handle get_complexity tool calls.
 * Analyzes complexity for files or the entire codebase.
 */
export async function handleGetComplexity(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, config, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    GetComplexitySchema,
    async (validatedArgs) => {
      log('Analyzing complexity...');
      await checkAndReconnect();

      const analyzer = new ComplexityAnalyzer(vectorDB, config);
      const report = await analyzer.analyze(validatedArgs.files);
      log(`Analyzed ${report.summary.filesAnalyzed} files`);

      // Transform violations using collect.js
      type TransformedViolation = ReturnType<typeof transformViolation>;
      const allViolations: TransformedViolation[] = collect(Object.entries(report.files))
        .flatMap(([_, fileData]) => 
          fileData.violations.map(v => transformViolation(v, fileData))
        )
        .sortByDesc('complexity')
        .all() as TransformedViolation[];

      // Apply custom threshold filter if provided
      const violations = validatedArgs.threshold !== undefined
        ? allViolations.filter(v => v.complexity >= validatedArgs.threshold!)
        : allViolations;

      const topViolations = violations.slice(0, validatedArgs.top);

      // Calculate severity counts - countBy returns { error?: number, warning?: number }
      const bySeverity = collect(violations).countBy('severity').all() as { error?: number; warning?: number };

      return {
        indexInfo: getIndexMetadata(),
        summary: {
          filesAnalyzed: report.summary.filesAnalyzed,
          avgComplexity: report.summary.avgComplexity,
          maxComplexity: report.summary.maxComplexity,
          violationCount: violations.length,
          bySeverity: {
            error: bySeverity['error'] || 0,
            warning: bySeverity['warning'] || 0,
          },
        },
        violations: topViolations,
      };
    }
  )(args);
}

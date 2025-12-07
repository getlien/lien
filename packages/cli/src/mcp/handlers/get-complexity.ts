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

      // Transform and filter violations using collect.js
      const violations = collect(Object.entries(report.files))
        .flatMap(([_, fileData]) => 
          fileData.violations.map(v => transformViolation(v, fileData))
        )
        .when(validatedArgs.threshold !== undefined, items => 
          items.filter(v => v.complexity >= validatedArgs.threshold!)
        )
        .sortByDesc('complexity')
        .all();

      const topViolations = collect(violations).take(validatedArgs.top).all();

      // Calculate severity counts
      const bySeverity = collect(violations).countBy('severity').all() as unknown as Record<string, number>;

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

import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetComplexitySchema } from '../schemas/index.js';
import { ComplexityAnalyzer } from '../../insights/complexity-analyzer.js';
import type { ToolContext, MCPToolResult } from '../types.js';

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

      // Check if index has been updated and reconnect if needed
      await checkAndReconnect();

      // Use ComplexityAnalyzer with current config
      const analyzer = new ComplexityAnalyzer(vectorDB, config);
      const report = await analyzer.analyze(validatedArgs.files);

      log(`Analyzed ${report.summary.filesAnalyzed} files`);

      // Flatten violations from all files
      let violations = Object.entries(report.files)
        .flatMap(([_filepath, fileData]) =>
          fileData.violations.map(v => ({
            filepath: v.filepath,
            symbolName: v.symbolName,
            symbolType: v.symbolType,
            startLine: v.startLine,
            endLine: v.endLine,
            complexity: v.complexity,
            threshold: v.threshold,
            severity: v.severity,
            language: v.language,
            message: v.message,
            dependentCount: fileData.dependentCount || 0,
            riskLevel: fileData.riskLevel,
          }))
        );

      // Apply custom threshold filter if provided
      if (validatedArgs.threshold !== undefined) {
        violations = violations.filter(v => v.complexity >= validatedArgs.threshold!);
      }

      // Sort by complexity descending
      violations.sort((a, b) => b.complexity - a.complexity);

      // Apply top limit
      const topViolations = violations.slice(0, validatedArgs.top);

      // Recalculate bySeverity after threshold filtering for consistency
      const bySeverity = {
        error: violations.filter(v => v.severity === 'error').length,
        warning: violations.filter(v => v.severity === 'warning').length,
      };

      // Build response
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
    }
  )(args);
}

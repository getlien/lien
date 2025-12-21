import collect from 'collect.js';
import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetComplexitySchema } from '../schemas/index.js';
import { ComplexityAnalyzer, QdrantDB } from '@liendev/core';
import type { ComplexityViolation, FileComplexityData } from '@liendev/core';
import type { ToolContext, MCPToolResult } from '../types.js';

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
/**
 * Group complexity violations by repository ID.
 */
function groupViolationsByRepo(
  violations: Array<{ filepath: string; [key: string]: any }>,
  allChunks: Array<{ metadata: { file: string; repoId?: string } }>
): Record<string, typeof violations> {
  const fileToRepo = new Map<string, string>();
  
  // Build map of filepath -> repoId
  for (const chunk of allChunks) {
    const repoId = chunk.metadata.repoId || 'unknown';
    fileToRepo.set(chunk.metadata.file, repoId);
  }
  
  // Group violations by repo
  const grouped: Record<string, typeof violations> = {};
  for (const violation of violations) {
    const repoId = fileToRepo.get(violation.filepath) || 'unknown';
    if (!grouped[repoId]) {
      grouped[repoId] = [];
    }
    grouped[repoId].push(violation);
  }
  
  return grouped;
}

export async function handleGetComplexity(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    GetComplexitySchema,
    async (validatedArgs) => {
      const { crossRepo, repoIds, files, top, threshold } = validatedArgs;
      log(`Analyzing complexity${crossRepo ? ' (cross-repo)' : ''}...`);
      await checkAndReconnect();

      // For cross-repo, we need to use scanCrossRepo to get all chunks
      // then pass them to ComplexityAnalyzer
      let allChunks: Array<{ metadata: { file: string; repoId?: string } }> = [];
      
      if (crossRepo && vectorDB instanceof QdrantDB) {
        // Get all chunks across repos for cross-repo analysis
        allChunks = await vectorDB.scanCrossRepo({ 
          limit: 100000,
          repoIds 
        });
        log(`Scanned ${allChunks.length} chunks across repos`);
      }

      const analyzer = new ComplexityAnalyzer(vectorDB);
      
      // Pass cross-repo parameters to analyzer
      const report = await analyzer.analyze(files, crossRepo && vectorDB instanceof QdrantDB ? crossRepo : false, repoIds);
      log(`Analyzed ${report.summary.filesAnalyzed} files`);

      // Transform violations using collect.js
      type TransformedViolation = ReturnType<typeof transformViolation>;
      const allViolations: TransformedViolation[] = collect(Object.entries(report.files))
        .flatMap(([/* filepath unused */, fileData]) => 
          fileData.violations.map(v => transformViolation(v, fileData))
        )
        .sortByDesc('complexity')
        .all() as unknown as TransformedViolation[];

      // Apply custom threshold filter if provided
      const violations = threshold !== undefined
        ? allViolations.filter(v => v.complexity >= threshold)
        : allViolations;

      const topViolations = violations.slice(0, top);

      // Calculate severity counts - countBy returns { error?: number, warning?: number }
      const bySeverity = collect(violations).countBy('severity').all() as { error?: number; warning?: number };

      const response: any = {
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

      // Group by repo if cross-repo search
      if (crossRepo && vectorDB instanceof QdrantDB && allChunks.length > 0) {
        response.groupedByRepo = groupViolationsByRepo(topViolations, allChunks);
      } else if (crossRepo) {
        log('Warning: crossRepo=true requires Qdrant backend. Falling back to single-repo analysis.', 'warning');
      }

      return response;
    }
  )(args);
}

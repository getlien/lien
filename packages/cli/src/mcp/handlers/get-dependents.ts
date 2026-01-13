import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetDependentsSchema } from '../schemas/index.js';
import type { ToolContext, MCPToolResult } from '../types.js';
import { QdrantDB } from '@liendev/core';
import {
  findDependents,
  calculateRiskLevel,
  groupDependentsByRepo,
} from './dependency-analyzer.js';


/**
 * Handle get_dependents tool calls.
 * Finds all code that depends on a file (reverse dependency lookup).
 * 
 * When the optional `symbol` parameter is provided, returns specific call sites
 * for that exported symbol instead of just file-level dependencies.
 */
export async function handleGetDependents(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    GetDependentsSchema,
    async (validatedArgs) => {
      const { crossRepo, filepath, symbol } = validatedArgs;
      const symbolSuffix = symbol ? ` (symbol: ${symbol})` : '';
      const crossRepoSuffix = crossRepo ? ' (cross-repo)' : '';
      log(`Finding dependents of: ${filepath}${symbolSuffix}${crossRepoSuffix}`);
      await checkAndReconnect();

      // Find dependents using dependency analysis functions
      const analysis = await findDependents(vectorDB, filepath, crossRepo ?? false, log, symbol);

      const riskLevel = calculateRiskLevel(
        analysis.dependents.length,
        analysis.complexityMetrics.complexityRiskBoost,
        analysis.productionDependentCount
      );
      
      // Log message varies based on whether symbol-level analysis was done
      if (symbol && analysis.totalUsageCount !== undefined) {
        log(
          `Found ${analysis.totalUsageCount} usages of '${symbol}' across ${analysis.dependents.length} files (${analysis.productionDependentCount} prod, ${analysis.testDependentCount} test) - risk: ${riskLevel}`
        );
      } else {
        log(
          `Found ${analysis.dependents.length} dependents (${analysis.productionDependentCount} prod, ${analysis.testDependentCount} test) - risk: ${riskLevel}`
        );
      }

      // Build note(s) for warnings
      const notes: string[] = [];
      const crossRepoFallback = crossRepo && !(vectorDB instanceof QdrantDB);
      
      if (crossRepoFallback) {
        notes.push('Cross-repo search requires Qdrant backend. Fell back to single-repo search.');
      }
      if (analysis.hitLimit) {
        notes.push('Scanned 10,000 chunks (limit reached). Results may be incomplete.');
      }

      // Build response
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = {
        indexInfo: getIndexMetadata(),
        filepath: validatedArgs.filepath,
        ...(symbol && { symbol }),
        dependentCount: analysis.dependents.length,
        productionDependentCount: analysis.productionDependentCount,
        testDependentCount: analysis.testDependentCount,
        ...(analysis.totalUsageCount !== undefined && { totalUsageCount: analysis.totalUsageCount }),
        riskLevel,
        dependents: analysis.dependents,
        complexityMetrics: analysis.complexityMetrics,
        ...(notes.length > 0 && { note: notes.join(' ') }),
      };

      // Group by repo if cross-repo search
      if (crossRepo && vectorDB instanceof QdrantDB) {
        response.groupedByRepo = groupDependentsByRepo(analysis.dependents, analysis.allChunks);
      }

      return response;
    }
  )(args);
}

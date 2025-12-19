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
 */
export async function handleGetDependents(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    GetDependentsSchema,
    async (validatedArgs) => {
      const { crossRepo, filepath } = validatedArgs;
      log(`Finding dependents of: ${filepath}${crossRepo ? ' (cross-repo)' : ''}`);
      await checkAndReconnect();

      // Find dependents using dependency analysis functions
      const analysis = await findDependents(vectorDB, filepath, crossRepo ?? false, log);

      const riskLevel = calculateRiskLevel(
        analysis.dependents.length,
        analysis.complexityMetrics.complexityRiskBoost
      );
      log(
        `Found ${analysis.dependents.length} dependent files (risk: ${riskLevel}${
          analysis.complexityMetrics.filesWithComplexityData > 0 ? ', complexity-boosted' : ''
        })`
      );

      const response: any = {
        indexInfo: getIndexMetadata(),
        filepath: validatedArgs.filepath,
        dependentCount: analysis.dependents.length,
        riskLevel,
        dependents: analysis.dependents,
        complexityMetrics: analysis.complexityMetrics,
        note: analysis.hitLimit
          ? `Warning: Scanned 10000 chunks (limit reached). Results may be incomplete.`
          : undefined,
      };

      // Group by repo if cross-repo search
      if (crossRepo && vectorDB instanceof QdrantDB) {
        response.groupedByRepo = groupDependentsByRepo(analysis.dependents, analysis.allChunks);
      }

      return response;
    }
  )(args);
}

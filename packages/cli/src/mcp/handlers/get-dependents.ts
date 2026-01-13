import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetDependentsSchema } from '../schemas/index.js';
import type { ToolContext, MCPToolResult } from '../types.js';
import type { VectorDBInterface } from '@liendev/core';
import { QdrantDB } from '@liendev/core';
import {
  findDependents,
  calculateRiskLevel,
  groupDependentsByRepo,
  type DependencyAnalysisResult,
  type DependentInfo,
  type ComplexityMetrics,
} from './dependency-analyzer.js';


// Types for validated args and response building
interface ValidatedArgs {
  filepath: string;
  symbol?: string;
  crossRepo?: boolean;
}

interface IndexInfo {
  indexVersion: number;
  indexDate: string;
}

/**
 * Response structure for get_dependents tool.
 */
interface DependentsResponse {
  indexInfo: IndexInfo;
  filepath: string;
  symbol?: string;
  dependentCount: number;
  productionDependentCount: number;
  testDependentCount: number;
  totalUsageCount?: number;
  riskLevel: string;
  dependents: DependentInfo[];
  complexityMetrics: ComplexityMetrics;
  note?: string;
  groupedByRepo?: Record<string, DependentInfo[]>;
}

/**
 * Check if cross-repo search is requested but not supported.
 */
function checkCrossRepoFallback(crossRepo: boolean | undefined, vectorDB: VectorDBInterface): boolean {
  return Boolean(crossRepo && !(vectorDB instanceof QdrantDB));
}

/**
 * Build warning notes for the response.
 */
function buildNotes(crossRepoFallback: boolean, hitLimit: boolean): string[] {
  const notes: string[] = [];
  if (crossRepoFallback) {
    notes.push('Cross-repo search requires Qdrant backend. Fell back to single-repo search.');
  }
  if (hitLimit) {
    notes.push('Scanned 10,000 chunks (limit reached). Results may be incomplete.');
  }
  return notes;
}

/**
 * Log the analysis results with risk assessment.
 */
function logRiskAssessment(
  analysis: DependencyAnalysisResult,
  riskLevel: string,
  symbol: string | undefined,
  log: (msg: string) => void
): void {
  if (symbol && analysis.totalUsageCount !== undefined) {
    const usageInfo = analysis.totalUsageCount > 0
      ? `Found ${analysis.totalUsageCount} tracked call sites`
      : `Found ${analysis.dependents.length} files importing '${symbol}' (no call sites tracked)`;
    log(
      `${usageInfo} across ${analysis.dependents.length} files ` +
      `(${analysis.productionDependentCount} prod, ${analysis.testDependentCount} test) - risk: ${riskLevel}`
    );
  } else {
    log(
      `Found ${analysis.dependents.length} dependents ` +
      `(${analysis.productionDependentCount} prod, ${analysis.testDependentCount} test) - risk: ${riskLevel}`
    );
  }
}

/**
 * Build the response object from analysis results.
 */
function buildDependentsResponse(
  analysis: DependencyAnalysisResult,
  args: ValidatedArgs,
  riskLevel: string,
  indexInfo: IndexInfo,
  notes: string[],
  crossRepo: boolean | undefined,
  vectorDB: VectorDBInterface
): DependentsResponse {
  const { symbol, filepath } = args;
  
  const response: DependentsResponse = {
    indexInfo,
    filepath,
    dependentCount: analysis.dependents.length,
    productionDependentCount: analysis.productionDependentCount,
    testDependentCount: analysis.testDependentCount,
    riskLevel,
    dependents: analysis.dependents,
    complexityMetrics: analysis.complexityMetrics,
  };

  // Add optional fields
  if (symbol) {
    response.symbol = symbol;
  }
  if (analysis.totalUsageCount !== undefined) {
    response.totalUsageCount = analysis.totalUsageCount;
  }
  if (notes.length > 0) {
    response.note = notes.join(' ');
  }

  // Group by repo if cross-repo search with Qdrant
  if (crossRepo && vectorDB instanceof QdrantDB) {
    response.groupedByRepo = groupDependentsByRepo(analysis.dependents, analysis.allChunks);
  }

  return response;
}

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
      
      // Log initial request
      const symbolSuffix = symbol ? ` (symbol: ${symbol})` : '';
      const crossRepoSuffix = crossRepo ? ' (cross-repo)' : '';
      log(`Finding dependents of: ${filepath}${symbolSuffix}${crossRepoSuffix}`);
      
      await checkAndReconnect();

      // Analyze dependencies
      const analysis = await findDependents(vectorDB, filepath, crossRepo ?? false, log, symbol);

      // Calculate risk level
      const riskLevel = calculateRiskLevel(
        analysis.dependents.length,
        analysis.complexityMetrics.complexityRiskBoost,
        analysis.productionDependentCount
      );
      
      // Log results with risk assessment
      logRiskAssessment(analysis, riskLevel, symbol, log);

      // Build and return response
      const crossRepoFallback = checkCrossRepoFallback(crossRepo, vectorDB);
      const notes = buildNotes(crossRepoFallback, analysis.hitLimit);
      
      return buildDependentsResponse(
        analysis,
        validatedArgs,
        riskLevel,
        getIndexMetadata(),
        notes,
        crossRepo,
        vectorDB
      );
    }
  )(args);
}

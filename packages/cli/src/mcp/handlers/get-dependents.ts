import type { z } from 'zod';
import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetDependentsSchema } from '../schemas/index.js';
import type { ToolContext, MCPToolResult } from '../types.js';
import type { VectorDBInterface } from '@liendev/core';
import { computeBlastRadiusRisk, type BlastRadiusRisk } from '@liendev/parser';
import {
  findDependents,
  groupDependentsByRepo,
  type DependencyAnalysisResult,
  type DependentInfo,
  type ComplexityMetrics,
} from './dependency-analyzer.js';

// Complexity threshold above which an uncovered dependent escalates risk.
// Matches the review-side blast-radius default (DEFAULT_HIGH_COMPLEXITY_THRESHOLD).
const HIGH_COMPLEXITY_THRESHOLD = 15;

// Validated args mirror the schema exactly — `depth` and `maxNodes` are
// always present post-parse thanks to Zod `.default(...)`.
type ValidatedArgs = z.infer<typeof GetDependentsSchema>;

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
  depth: number;
  dependentCount: number;
  productionDependentCount: number;
  testDependentCount: number;
  totalUsageCount?: number;
  /** Alias for dependentCount following the CRG naming convention. */
  totalImpacted: number;
  /** True when BFS stopped at the maxNodes cap. */
  truncated: boolean;
  riskLevel: string;
  /** Short phrases explaining why the risk level was assigned. */
  riskReasoning: string[];
  dependents: DependentInfo[];
  complexityMetrics: ComplexityMetrics;
  note?: string;
  groupedByRepo?: Record<string, DependentInfo[]>;
}

/**
 * Check if cross-repo search is requested but not supported.
 */
function checkCrossRepoFallback(
  crossRepo: boolean | undefined,
  vectorDB: VectorDBInterface,
): boolean {
  return Boolean(crossRepo && !vectorDB.supportsCrossRepo);
}

/**
 * Build warning notes for the response.
 */
function buildNotes(crossRepoFallback: boolean, hitLimit: boolean): string[] {
  const notes: string[] = [];
  if (crossRepoFallback) {
    notes.push(
      'Cross-repo search requires a cross-repo-capable backend. Fell back to single-repo search.',
    );
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
  log: (msg: string) => void,
): void {
  const prodTest = `(${analysis.productionDependentCount} prod, ${analysis.testDependentCount} test)`;
  const truncatedSuffix = analysis.truncated ? ' [truncated]' : '';

  if (symbol && analysis.totalUsageCount !== undefined) {
    if (analysis.totalUsageCount > 0) {
      // Symbol tracking with call sites found
      log(
        `Found ${analysis.totalUsageCount} tracked call sites across ${analysis.dependents.length} files ` +
          `${prodTest} - risk: ${riskLevel}${truncatedSuffix}`,
      );
    } else {
      // Files import the symbol but no call sites were tracked
      // This happens when call site tracking isn't available for those chunks
      // (e.g., chunks without complexity analysis)
      log(
        `Found ${analysis.dependents.length} files importing '${symbol}' ` +
          `${prodTest} - risk: ${riskLevel}${truncatedSuffix} (Note: Call site tracking unavailable for these chunks)`,
      );
    }
  } else {
    log(
      `Found ${analysis.dependents.length} dependents ` +
        `${prodTest} - risk: ${riskLevel}${truncatedSuffix}`,
    );
  }
}

/**
 * Compose blast-radius risk inputs from analysis results and compute the
 * shared risk level via the parser primitive.
 */
function computeRisk(analysis: DependencyAnalysisResult): BlastRadiusRisk {
  const { productionDependentCount, uncoveredProductionDependents, complexityMetrics } = analysis;
  const maxComplexity = complexityMetrics.maxComplexity;
  // Any high-complexity dependent that is also untested escalates risk.
  const hasHighComplexityUncovered =
    uncoveredProductionDependents > 0 && maxComplexity >= HIGH_COMPLEXITY_THRESHOLD;
  return computeBlastRadiusRisk({
    dependentCount: productionDependentCount,
    uncoveredDependents: uncoveredProductionDependents,
    maxDependentComplexity: maxComplexity > 0 ? maxComplexity : undefined,
    hasHighComplexityUncovered,
  });
}

/**
 * Build the response object from analysis results.
 */
function buildDependentsResponse(
  analysis: DependencyAnalysisResult,
  args: ValidatedArgs,
  risk: BlastRadiusRisk,
  indexInfo: IndexInfo,
  notes: string[],
  crossRepo: boolean | undefined,
  vectorDB: VectorDBInterface,
): DependentsResponse {
  const { symbol, filepath, depth } = args;

  const response: DependentsResponse = {
    indexInfo,
    filepath,
    depth,
    dependentCount: analysis.dependents.length,
    productionDependentCount: analysis.productionDependentCount,
    testDependentCount: analysis.testDependentCount,
    totalImpacted: analysis.dependents.length,
    truncated: analysis.truncated,
    riskLevel: risk.level,
    riskReasoning: risk.reasoning,
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
  if (crossRepo && vectorDB.supportsCrossRepo) {
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
 *
 * Note: Symbol tracking only works for direct imports from the target file.
 * Re-exported symbols (e.g., via barrel files or package entry points) are not tracked.
 */
export async function handleGetDependents(args: unknown, ctx: ToolContext): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(GetDependentsSchema, async raw => {
    // `wrapToolHandler`'s generic loses Zod's input-vs-output distinction, so
    // defaults aren't reflected in `raw`'s type. At runtime Zod has already
    // applied them, so the cast is sound.
    const validatedArgs = raw as ValidatedArgs;
    const { crossRepo, filepath, symbol, depth, maxNodes } = validatedArgs;

    // Log initial request
    const symbolSuffix = symbol ? ` (symbol: ${symbol})` : '';
    const crossRepoSuffix = crossRepo ? ' (cross-repo)' : '';
    const depthSuffix = depth > 1 ? ` (depth: ${depth})` : '';
    log(`Finding dependents of: ${filepath}${symbolSuffix}${crossRepoSuffix}${depthSuffix}`);

    await checkAndReconnect();

    // Capture index metadata once to avoid inconsistency from concurrent reindex
    const indexInfo = getIndexMetadata();

    // Analyze dependencies (pass indexVersion for scan cache)
    const analysis = await findDependents(
      vectorDB,
      filepath,
      crossRepo ?? false,
      log,
      symbol,
      indexInfo.indexVersion,
      depth,
      maxNodes,
    );

    // Compose risk via the shared parser primitive.
    const risk = computeRisk(analysis);

    // Log results with risk assessment
    logRiskAssessment(analysis, risk.level, symbol, log);

    // Build and return response
    const crossRepoFallback = checkCrossRepoFallback(crossRepo, vectorDB);
    const notes = buildNotes(crossRepoFallback, analysis.hitLimit);

    return buildDependentsResponse(
      analysis,
      validatedArgs,
      risk,
      indexInfo,
      notes,
      crossRepo,
      vectorDB,
    );
  })(args);
}

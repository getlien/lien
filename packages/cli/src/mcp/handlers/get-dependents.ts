import type { z } from 'zod';
import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetDependentsSchema } from '../schemas/index.js';
import { findUnindexedPaths, formatUnindexedPathsNote } from '../utils/unindexed-paths.js';
import type { ToolContext, MCPToolResult } from '../types.js';
import { computeBlastRadiusRisk, type BlastRadiusRisk } from '@liendev/parser';
import {
  findDependents,
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
  /**
   * Set either when `filepath` has no entry in the index manifest at all
   * (see unindexed-paths.ts), or — when the manifest check doesn't already
   * explain it — when `filepath` has zero chunks anywhere in the current
   * scan (#928). Either way, every count above is then a deliberate `0`, not
   * a fuzzy-matched answer: read this before trusting `dependentCount: 0` /
   * `riskLevel: "low"` as "safe to edit". See `buildDependentsResponse` for
   * the precedence between the two sources.
   */
  note?: string;
  /**
   * True when `symbol` couldn't be attributed at the symbol level (it's not
   * a top-level export of `filepath` -- the shape of a method or
   * constructor) and the response was widened to file-level dependents
   * instead of asserting an unverifiable symbol-scoped count. When set,
   * treat `dependentCount`/`riskLevel` as a floor over ALL of this file's
   * dependents, not a confirmed count of callers of `symbol` specifically.
   */
  symbolAttributionDegraded?: boolean;
  /** Human-readable explanation, present only when `symbolAttributionDegraded` is true. */
  symbolAttributionNote?: string;
  /**
   * True for a file-level query (no `symbol`) that found zero dependents in
   * a language where the import graph structurally can't see every real
   * usage (see `DependencyAnalysisResult.dependentAttributionIncomplete`).
   * When set, `dependentCount: 0` / `riskLevel: "low"` means "nothing found,"
   * not "nothing depends on this file" — don't treat it as a verified clear.
   */
  dependentAttributionIncomplete?: boolean;
  /** Human-readable explanation, present only when `dependentAttributionIncomplete` is true. */
  dependentAttributionNote?: string;
}

/**
 * Log the analysis results with risk assessment.
 */
function logRiskAssessment(
  analysis: DependencyAnalysisResult,
  riskLevel: string,
  symbol: string | undefined,
  log: (msg: string, level?: 'warning') => void,
): void {
  const prodTest = `(${analysis.productionDependentCount} prod, ${analysis.testDependentCount} test)`;
  const truncatedSuffix = analysis.truncated ? ' [truncated]' : '';

  if (symbol && analysis.symbolAttributionDegraded) {
    log(
      `Symbol-level attribution degraded for "${symbol}" — falling back to ` +
        `${analysis.dependents.length} file-level dependents ${prodTest} - risk: ${riskLevel}${truncatedSuffix}`,
    );
    return;
  }

  if (analysis.dependentAttributionIncomplete) {
    // findDependents already logged the underlying warning (dependency-analyzer.ts);
    // just skip the generic "Found 0 dependents" log below rather than duplicate it.
    return;
  }

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
  const risk = computeBlastRadiusRisk({
    dependentCount: productionDependentCount,
    uncoveredDependents: uncoveredProductionDependents,
    maxDependentComplexity: maxComplexity > 0 ? maxComplexity : undefined,
    hasHighComplexityUncovered,
  });
  return { ...risk, reasoning: clarifyCallerReasoning(risk.reasoning) };
}

/**
 * Relabel the shared primitive's generic "N callers"/"N caller" reasoning
 * entry to make explicit that it counts PRODUCTION dependents only (#928).
 * `computeRisk` above deliberately feeds `productionDependentCount` in — a
 * test file calling the target shouldn't weigh into risk the same way a
 * production caller does — but the response's own top-level `dependentCount`
 * field is the WIDER total (production + test). Left unrelabeled, a reader
 * sees two different numbers answering what looks like the same question
 * ("14 callers" next to `dependentCount: 80`) with nothing to indicate
 * they're deliberately scoped differently; this makes the scoping explicit
 * instead of changing either number. Scoped to this handler's own response
 * rather than the shared `blast-radius-risk.ts` primitive, which the review-
 * side blast-radius injection also consumes with its own (unrelated) scoping.
 */
function clarifyCallerReasoning(reasoning: string[]): string[] {
  return reasoning.map(entry =>
    /^\d+ callers?$/.test(entry) ? entry.replace(/ callers?$/, m => ` production${m}`) : entry,
  );
}

/**
 * Build the response object from analysis results.
 */
function buildDependentsResponse(
  analysis: DependencyAnalysisResult,
  args: ValidatedArgs,
  risk: BlastRadiusRisk,
  indexInfo: IndexInfo,
  note?: string,
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
  // #927's manifest-based note takes precedence: it's the more authoritative
  // "is this path even part of the indexed project" signal (independent of
  // chunk count), and in the overwhelming common case (a typo'd/nonexistent
  // path) both it and the #928 chunk-based check below would fire for the
  // same reason -- setting both would just be two notes saying the same
  // thing. The #928 check still adds real value on its own for the narrower
  // gap the manifest can't see: a path the manifest lists as indexed but
  // that produced zero chunks in this scan (e.g. a genuinely empty file).
  if (note) {
    response.note = note;
  } else if (!analysis.targetIndexed) {
    response.note =
      `⚠ Lien: "${filepath}" has no chunks anywhere in the index — every count above ` +
      'is a deliberate 0, not a confirmed empty dependency graph. This can mean the ' +
      'path was never indexed, is misspelled (wrong directory prefix, wrong case), or ' +
      'genuinely has no extractable content. Do not treat this as a low-risk or ' +
      'dependency-free file; check for a typo before editing, try search_code or ' +
      'list_functions to find the real path, or run "lien index" if the file was added ' +
      'recently.';
  }
  if (analysis.symbolAttributionDegraded) {
    response.symbolAttributionDegraded = true;
    response.symbolAttributionNote =
      `"${symbol}" doesn't appear in ${filepath}'s tracked top-level exports (likely a ` +
      `method or constructor — no import statement names one of those independently of ` +
      `its class/package). Symbol-level call sites couldn't be confirmed, so dependentCount, ` +
      `riskLevel, and dependents below are the file-level answer (every file that imports ` +
      `${filepath}) rather than a verified count of callers of "${symbol}" specifically.`;
  }
  if (analysis.dependentAttributionIncomplete) {
    response.dependentAttributionIncomplete = true;
    response.dependentAttributionNote =
      `No import-based dependents were found for ${filepath}, but its language lets real ` +
      `callers use its exports with no per-file import naming it at all (C#'s "global using" ` +
      `/ implicit enclosing-namespace member access). The import graph has no signal for ` +
      `that usage shape, so dependentCount: 0 and riskLevel: "low" here mean "the scan found ` +
      `nothing," not "nothing depends on this file" — don't treat this as a verified clear.`;
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
    const { filepath, symbol, depth, maxNodes } = validatedArgs;

    // Log initial request
    const symbolSuffix = symbol ? ` (symbol: ${symbol})` : '';
    const depthSuffix = depth > 1 ? ` (depth: ${depth})` : '';
    log(`Finding dependents of: ${filepath}${symbolSuffix}${depthSuffix}`);

    await checkAndReconnect();

    // Capture index metadata once to avoid inconsistency from concurrent reindex
    const indexInfo = getIndexMetadata();

    // Distinguish "path unknown to the index" from "indexed, zero
    // dependents" — a bare dependentCount:0/riskLevel:"low" reads as "safe to
    // edit" unless a mistyped path is called out explicitly.
    const workspaceRoot = process.cwd().replace(/\\/g, '/');
    const unindexedPaths = await findUnindexedPaths(vectorDB, [filepath], workspaceRoot);
    const unindexedNote = formatUnindexedPathsNote(unindexedPaths);
    if (unindexedPaths.length > 0) {
      log(`Path not found in index: ${filepath}`, 'warning');
    }

    // Analyze dependencies (pass indexVersion for scan cache)
    const analysis = await findDependents(
      vectorDB,
      filepath,
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
    return buildDependentsResponse(analysis, validatedArgs, risk, indexInfo, unindexedNote);
  })(args);
}

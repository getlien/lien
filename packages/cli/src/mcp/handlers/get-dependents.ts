import type { z } from 'zod';
import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetDependentsSchema } from '../schemas/index.js';
import { findUnindexedPaths, formatUnindexedPathsNote } from '../utils/unindexed-paths.js';
import type { ToolContext, MCPToolResult } from '../types.js';
import { computeBlastRadiusRisk, type BlastRadiusRisk } from '@liendev/parser';
import type { AttributionCaveatReason } from '../attribution-caveat-reasons.js';
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

// `AttributionCaveatReason` and its doc comment (which four reasons exist,
// what triggers each, and why they're mutually exclusive) now live in
// `../attribution-caveat-reasons.js` -- the single source that every
// model/user-facing prose surface interpolates from (#980). Re-exported here
// for callers that already import the type from this handler.
export type { AttributionCaveatReason };

export interface AttributionCaveat {
  reason: AttributionCaveatReason;
  /** Human-readable explanation of what happened and what to do about it. */
  note: string;
}

/**
 * Response structure for get_dependents tool.
 */
interface DependentsResponse {
  indexInfo: IndexInfo;
  filepath: string;
  symbol?: string;
  /**
   * The depth that actually ran, NOT necessarily the requested `depth` arg.
   * A symbol-scoped query (`symbol` set) always runs at depth 1 regardless
   * of what was requested — `@liendev/parser`'s `runBfsIfRequested`
   * (in its `dependency-analyzer.ts`) skips BFS entirely for symbol queries,
   * since transitive symbol-renaming chains are out of scope. Echoing the
   * requested value unchanged in that
   * case would let a caller believe a multi-hop symbol walk ran when it
   * didn't.
   */
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
   * Present when this answer's counts can't be trusted as a verified clear
   * -- read `reason` to tell which of the four ways that can happen (see
   * `AttributionCaveatReason`'s doc comment) and `note` for the specific
   * explanation. Absent entirely on a normal, fully-attributed answer.
   */
  attributionCaveat?: AttributionCaveat;
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
    // findDependents already logged the underlying warning (@liendev/parser's
    // dependency-analyzer.ts); just skip the generic "Found 0 dependents" log
    // below rather than duplicate it.
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
    complexityRiskBoost: complexityMetrics.complexityRiskBoost,
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
 * Decide which (if any) attribution caveat applies, and build its note.
 *
 * The four reasons are mutually exclusive by construction, so at most one
 * ever fires:
 * - `unresolvedTargetNote` is only non-empty when `filepath` has no chunks
 *   anywhere in the index, in which case `findDependents` returns an empty
 *   `chunksByFile` up front -- so `symbolAttributionDegraded` (which
 *   requires `chunksByFile.size > 0` to fire), `dependentAttributionPartial`,
 *   and `dependentAttributionIncomplete` (both of which explicitly skip
 *   when `!targetIndexed`) can never also be set.
 * - `symbolAttributionDegraded` only fires for a `symbol` query;
 *   `dependentAttributionPartial`/`dependentAttributionIncomplete` only fire
 *   for a file-level query (no `symbol`) -- see
 *   `enrichWithCSharpTypeReferenceDependents`/
 *   `checkDependentAttributionIncomplete` in `@liendev/parser`'s
 *   `dependency-analyzer.ts`. So those can't co-occur with
 *   `symbolAttributionDegraded` either.
 * - `dependentAttributionPartial` requires the FINAL `dependents.length`
 *   (after the type-reference-matching fallback runs) to be positive;
 *   `dependentAttributionIncomplete` requires that same final count to be
 *   zero. So those two can never both be set.
 *
 * #927's manifest-based unresolved-target note takes precedence over #928's
 * chunk-based one where both could apply (a typo'd/nonexistent path trips
 * both for the same underlying reason); `unresolvedTargetNote` already
 * encodes that precedence before this function sees it.
 */
function buildAttributionCaveat(
  analysis: DependencyAnalysisResult,
  filepath: string,
  symbol: string | undefined,
  unresolvedTargetNote: string | undefined,
): AttributionCaveat | undefined {
  if (unresolvedTargetNote) {
    return { reason: 'unresolved-target', note: unresolvedTargetNote };
  }
  if (!analysis.targetIndexed) {
    return {
      reason: 'unresolved-target',
      note:
        `⚠ Lien: "${filepath}" has no chunks anywhere in the index — every count above ` +
        'is a deliberate 0, not a confirmed empty dependency graph. This can mean the ' +
        'path was never indexed, is misspelled (wrong directory prefix, wrong case), or ' +
        'genuinely has no extractable content. Do not treat this as a low-risk or ' +
        'dependency-free file; check for a typo before editing, try search_code or ' +
        'list_functions to find the real path, or run "lien index" if the file was added ' +
        'recently.',
    };
  }
  if (analysis.symbolAttributionDegraded) {
    // "Not a top-level export, no confirmed call sites" has more than one
    // real cause: a genuine method/constructor and a typo'd/hallucinated/
    // removed symbol look identical on that signal alone.
    // `symbolFoundInFile` is the cheap, already-scanned check that tells them
    // apart (does `symbol` match ANY chunk in the file, not just its
    // top-level exports) — only assert the method/constructor reading when
    // it's actually backed by a hit; otherwise hedge across the real
    // possibilities instead of confidently naming the wrong one. The second
    // sentence (file-level answer, not a verified per-symbol count) holds
    // either way and stays identical.
    const note = analysis.symbolFoundInFile
      ? `"${symbol}" doesn't appear in ${filepath}'s tracked top-level exports (likely a ` +
        `method or constructor — no import statement names one of those independently of ` +
        `its class/package). Symbol-level call sites couldn't be confirmed, so dependentCount, ` +
        `riskLevel, and dependents below are the file-level answer (every file that imports ` +
        `${filepath}) rather than a verified count of callers of "${symbol}" specifically.`
      : `"${symbol}" doesn't appear anywhere in ${filepath} — not as a top-level export, nor in ` +
        `any indexed chunk of the file. This may be a typo, a hallucinated name, or a symbol ` +
        `that used to exist and was removed. Symbol-level call sites couldn't be confirmed, so ` +
        `dependentCount, riskLevel, and dependents below are the file-level answer (every file ` +
        `that imports ${filepath}) rather than a verified count of callers of "${symbol}" ` +
        `specifically.`;
    return { reason: 'symbol-attribution-degraded', note };
  }
  if (analysis.dependentAttributionPartial) {
    const inferredCount = analysis.dependents.filter(d => d.confidence === 'inferred').length;
    return {
      reason: 'dependent-attribution-partial',
      note:
        `The import graph found zero import-based dependents for ${filepath} (its language, C#, ` +
        `lets real callers use its exports with no per-file import naming it at all — "global ` +
        `using" / implicit enclosing-namespace member access), but ${inferredCount} of the ` +
        `${analysis.dependents.length} dependent(s) below were recovered by matching a ` +
        `uniquely-declared type name against other files' source text (marked ` +
        `"confidence": "inferred" in \`dependents\`). Treat dependentCount/riskLevel as a ` +
        `recovered LOWER BOUND, not a verified/complete answer — this heuristic can still miss a ` +
        `real dependent that references the type via an alias, a generic type argument, or ` +
        `reflection.`,
    };
  }
  if (analysis.dependentAttributionIncomplete) {
    return {
      reason: 'dependent-attribution-incomplete',
      note:
        `No import-based dependents were found for ${filepath}, but its language lets real ` +
        `callers use its exports with no per-file import naming it at all (C#'s "global using" ` +
        `/ implicit enclosing-namespace member access). The import graph has no signal for ` +
        `that usage shape, so dependentCount: 0 and riskLevel: "low" here mean "the scan found ` +
        `nothing," not "nothing depends on this file" — don't treat this as a verified clear.`,
    };
  }
  return undefined;
}

/**
 * Build the response object from analysis results.
 */
function buildDependentsResponse(
  analysis: DependencyAnalysisResult,
  args: ValidatedArgs,
  risk: BlastRadiusRisk,
  indexInfo: IndexInfo,
  unresolvedTargetNote?: string,
): DependentsResponse {
  const { symbol, filepath, depth } = args;
  // Symbol queries always run at depth 1 (see `depth`'s doc comment above) —
  // echo the depth that actually ran, not the requested value.
  const effectiveDepth = symbol ? 1 : depth;

  const response: DependentsResponse = {
    indexInfo,
    filepath,
    depth: effectiveDepth,
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

  if (symbol) {
    response.symbol = symbol;
  }
  if (analysis.totalUsageCount !== undefined) {
    response.totalUsageCount = analysis.totalUsageCount;
  }
  const attributionCaveat = buildAttributionCaveat(
    analysis,
    filepath,
    symbol,
    unresolvedTargetNote,
  );
  if (attributionCaveat) {
    response.attributionCaveat = attributionCaveat;
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

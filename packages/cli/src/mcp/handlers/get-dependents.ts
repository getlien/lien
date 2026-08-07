import type { z } from 'zod';
import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetDependentsSchema } from '../schemas/index.js';
import { findUnindexedPaths, formatUnindexedPathsNote } from '../utils/unindexed-paths.js';
import { relabelCallerReasoning } from '../../utils/blast-radius-reasoning.js';
import type { ToolContext, MCPToolResult } from '../types.js';
import {
  computeBlastRadiusRisk,
  describeInferredDependentRecovery,
  detectLanguage,
  hasDependentAttributionBlindSpot,
  isImportOnlyEvidenceTier,
  getCanonicalPath,
  type BlastRadiusRisk,
  type DependencyGraph,
} from '@liendev/parser';
import type { AttributionCaveatReason } from '../attribution-caveat-reasons.js';
import {
  findDependents,
  getOrBuildDependencyGraph,
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

// `AttributionCaveatReason` and its doc comment (which five reasons exist,
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
   * -- read `reason` to tell which of the five ways that can happen (see
   * `AttributionCaveatReason`'s doc comment) and `note` for the specific
   * explanation. Absent entirely on a normal, fully-attributed answer.
   */
  attributionCaveat?: AttributionCaveat;
  /**
   * Files that the call-site-level dependency graph (`@liendev/parser`'s
   * `buildDependencyGraph`) can VERIFY import `symbol` even though no
   * literal call site names it -- e.g. a constructor call, a type hint, or
   * a generic type argument, none of which surface as a tracked `callSite`.
   * Always a subset of `dependents` BY CONSTRUCTION -- `computeImportOnlyEvidence`
   * intersects the graph's candidates against `analysis.dependents` before
   * returning, rather than trusting the two mechanisms to keep agreeing.
   * Only ever present for a type-symbol query where `attributionCaveat.reason`
   * (the FINAL decided reason, via `decideAttributionCaveatReason` -- not the
   * raw `typeSymbolAttributionIncomplete` flag, which an earlier-priority
   * reason can still override) is `'type-symbol-attribution-incomplete'`;
   * present as `[]` (not omitted) whenever that caveat fires, so its
   * presence always means "checked", never "not applicable".
   *
   * Deliberately carries NO line number: unlike `dependents[].usages`
   * (`{callerSymbol, line, snippet}`, a real call site), this evidence's
   * only verified fact is "this file imports the symbol" -- attaching a
   * line here would either have to fabricate one or reuse an unrelated
   * chunk's line, which an earlier draft of this fix did and which
   * adversarial review found wrong in every case tested (see #1015's PR
   * body). `importedBy` stays file-level, on purpose.
   */
  importedBy?: string[];
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

  if (symbol && analysis.typeSymbolAttributionIncomplete) {
    log(
      `Symbol "${symbol}" is a type declaration — totalUsageCount ` +
        `(${analysis.totalUsageCount ?? 0}) is a partial, call-site-only floor, not a ` +
        `verified total ${prodTest} - risk: ${riskLevel}${truncatedSuffix}`,
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
  return { ...risk, reasoning: relabelCallerReasoning(risk.reasoning) };
}

/**
 * The `dependent-attribution-partial` note, describing the fallback(s) that
 * ACTUALLY recovered these dependents rather than assuming which one ran.
 *
 * Every mechanism-specific clause comes from `@liendev/parser`'s
 * `INFERRED_DEPENDENT_MECHANISMS`, keyed by each dependent's own `inferredVia`.
 * This sentence previously hard-coded C#'s language and mechanism, so when
 * #1039 added Go's root-package fallback — same `confidence: 'inferred'` tag,
 * same caveat reason — every recovered Go file was told "its language, C#" and
 * that its dependents came from matching a type name against source text.
 * Measured on a real `go-chi/chi` clone: 24 of 24 recovered edges across
 * `context.go`/`mux.go`/`chain.go`. See #1018.
 */
function buildPartialRecoveryNote(analysis: DependencyAnalysisResult, filepath: string): string {
  const inferred = analysis.dependents.filter(d => d.confidence === 'inferred');
  const mechanisms = [
    ...new Set(
      inferred.map(d => d.inferredVia).filter((m): m is NonNullable<typeof m> => m !== undefined),
    ),
  ];
  const { languageLabel, importGraphBlindSpot, recovery, residualRisk } =
    describeInferredDependentRecovery(mechanisms);
  return (
    `The import graph found zero import-based dependents for ${filepath} (its language, ` +
    `${languageLabel}, ${importGraphBlindSpot}), but ${inferred.length} of the ` +
    `${analysis.dependents.length} dependent(s) below were recovered by ${recovery} ` +
    `(marked "confidence": "inferred" in \`dependents\`, with \`inferredVia\` naming the ` +
    `fallback). Treat dependentCount/riskLevel as a recovered LOWER BOUND, not a ` +
    `verified/complete answer — this heuristic ${residualRisk}.`
  );
}

/**
 * Real, non-call-site evidence that files verifiably import a type-shaped
 * symbol, recovered from `@liendev/parser`'s call-site-level dependency
 * graph -- filling exactly the gap `typeSymbolAttributionIncomplete` names:
 * nothing "calls" a class/struct/interface/enum by its own name, so
 * `totalUsageCount`/`usages` structurally miss constructor calls, type
 * hints, and `extends`/`implements` clauses (the graph's `import-only`
 * tier -- see `EdgeProvenance`'s doc comment in `@liendev/parser`).
 *
 * `canonicalFilepath` MUST already be canonicalized (`getCanonicalPath`)
 * before calling this: the graph's `getCallers` keys on the RAW
 * `chunk.metadata.file` string it was built from, not on whatever form the
 * MCP caller happened to type -- passing the raw argument through
 * unchanged silently returns `[]` on any path that needed normalizing
 * (backslashes, an accidental absolute prefix).
 *
 * `dependentFiles` is `analysis.dependents`'s filepaths, and every candidate
 * the graph reports is INTERSECTED against it before being returned. The
 * two mechanisms verify the same import specifier via the same guarded
 * `importMatchesTarget` primitive (see `dependency-graph.test.ts`'s "subset
 * property" tests for the structural argument for why the graph's output is
 * expected to already be a subset in practice), but that argument is a
 * belief about how two independently-evolving algorithms currently behave,
 * not a language-level guarantee -- so this function enforces the subset
 * property BY CONSTRUCTION rather than trusting the two to keep agreeing
 * (CodeRabbit finding on this PR: the earlier version returned the graph's
 * raw output unintersected). Ordering is not guaranteed to match
 * `dependents`; this returns whatever survives the intersection, sorted for
 * a stable response.
 */
function computeImportOnlyEvidence(
  graph: DependencyGraph,
  canonicalFilepath: string,
  symbol: string,
  dependents: DependentInfo[],
): string[] {
  const dependentFiles = new Set(dependents.map(d => d.filepath));
  const files = new Set<string>();
  for (const edge of graph.getCallers(canonicalFilepath, symbol)) {
    if (isImportOnlyEvidenceTier(edge.provenance) && dependentFiles.has(edge.caller.filepath)) {
      files.add(edge.caller.filepath);
    }
  }
  return [...files].sort();
}

/**
 * Build the `type-symbol-attribution-incomplete` note. Two independently
 * true facts can both apply to the SAME response, so both are folded into
 * this ONE note rather than a second caveat -- the five
 * `AttributionCaveatReason`s stay mutually exclusive (#980, see
 * `buildAttributionCaveat`'s doc comment below):
 *
 * - #1015: whether the graph recovered real, non-call-site import evidence
 *   for the symbol (`importedBy.length > 0`) or genuinely found nothing.
 * - #1057: whether `filepath`'s language ALSO has a
 *   `hasDependentAttributionBlindSpot` (C#, Java, Kotlin, Swift -- #1005).
 *   The note used to assert "dependentCount/dependents ... remain
 *   reliable" unconditionally; for these languages that reassurance is
 *   false -- the identical file's file-level (no `symbol`) query gets a
 *   DIFFERENT caveat (`dependent-attribution-incomplete`) whose own text
 *   says the opposite. Hedging both counts together for these languages,
 *   instead of asserting one is fine while the other isn't, is what #1057
 *   asked for.
 */
function buildTypeSymbolCaveatNote(
  symbol: string | undefined,
  filepath: string,
  importedBy: string[],
  isBlindSpotLanguage: boolean,
): string {
  const intro =
    `"${symbol}" is a class/struct/interface/enum declaration in ${filepath}, not a ` +
    `function or method. Usage attribution here is call-site-driven, and nothing "calls" ` +
    `a type by its own name the way a function call does — constructor calls, type hints, ` +
    `extends/implements clauses, generic type arguments, and dependency-injected property ` +
    `access don't reliably surface as a tracked call site. totalUsageCount/usages below ` +
    `are a partial, best-effort floor — often 0 even when real usages exist — not a ` +
    `verified total.`;

  const evidence =
    importedBy.length > 0
      ? ` ${importedBy.length} file(s) among the dependents below verifiably import ` +
        `"${symbol}" per the dependency graph even though no literal call site names it ` +
        `(see \`importedBy\`) — real usage there is likely, just not call-site-attributable.`
      : ` The dependency graph found no non-call-site import evidence either (checked — ` +
        `\`importedBy\` is empty), which is a genuine absence of signal, not a confirmed 0 usages.`;

  const dependentCountClause = isBlindSpotLanguage
    ? ` dependentCount/dependents (which files import "${symbol}") aren't a verified clear ` +
      `either — this file's language has an import-invisible same-unit access shape (e.g. ` +
      `C#'s enclosing-namespace access, Java/Kotlin's same-package access, or Swift's ` +
      `whole-module access) the import graph can't see, so a real caller could exist with no ` +
      `import naming "${symbol}" at all.`
    : ` dependentCount/dependents (which files import "${symbol}") remain reliable.`;

  return (
    `${intro}${evidence}${dependentCountClause} Verify with grep before concluding "${symbol}" ` +
    `is unused or safe to rename.`
  );
}

/**
 * Which attribution caveat reason wins, per the priority order documented on
 * `buildAttributionCaveat` below -- extracted into its own function so a
 * caller can find out WHICH reason will be surfaced before that reason's
 * note is built, without duplicating the priority order at a second site.
 *
 * `handleGetDependents` needs exactly this for #1015's `importedBy`: it must
 * only be computed/attached when this decides `'type-symbol-attribution-
 * incomplete'` actually WINS, not whenever the raw
 * `analysis.typeSymbolAttributionIncomplete` flag happens to be true. An
 * earlier-priority reason can still win even when that flag is set --
 * concretely, `unresolved-target` via `unresolvedTargetNote`: that note
 * comes from #927's manifest-based check, which runs independently of (and
 * before) `findDependents`'s own #928 chunk-based scan, so the two can
 * disagree on the same path (that disagreement is the entire reason both
 * checks exist). Gating `importedBy` on the raw flag instead of this
 * decision would let a response carry a populated `importedBy` while
 * `attributionCaveat.reason` names something else entirely -- contradicting
 * the field's own documented contract (found and fixed after CodeRabbit
 * flagged it on this PR).
 *
 * The five reasons are mutually exclusive by construction, so at most one
 * ever fires:
 * - `unresolvedTargetNote` is only non-empty when `filepath` has no chunks
 *   anywhere in the index, in which case `findDependents` returns an empty
 *   `chunksByFile` up front -- so `symbolAttributionDegraded`/
 *   `typeSymbolAttributionIncomplete` (both of which require
 *   `chunksByFile.size > 0` or a resolved target to fire), and
 *   `dependentAttributionPartial`/`dependentAttributionIncomplete` (both of
 *   which explicitly skip when `!targetIndexed`) can never also be set.
 * - `symbolAttributionDegraded`/`typeSymbolAttributionIncomplete` only fire
 *   for a `symbol` query; `dependentAttributionPartial`/
 *   `dependentAttributionIncomplete` only fire for a file-level query (no
 *   `symbol`) -- see `enrichWithCSharpTypeReferenceDependents`/
 *   `checkDependentAttributionIncomplete` in `@liendev/parser`'s
 *   `dependency-analyzer.ts`. So those two pairs can never co-occur.
 * - `symbolAttributionDegraded` and `typeSymbolAttributionIncomplete` are
 *   themselves mutually exclusive: `buildDependentsList` (parser-side) only
 *   ever checks `isTypeDeclarationSymbol` in the branch where `symbol`
 *   did NOT degrade to the file-level fallback -- see that function's doc
 *   comment.
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
function decideAttributionCaveatReason(
  analysis: DependencyAnalysisResult,
  unresolvedTargetNote: string | undefined,
): AttributionCaveatReason | undefined {
  if (unresolvedTargetNote || !analysis.targetIndexed) return 'unresolved-target';
  if (analysis.symbolAttributionDegraded) return 'symbol-attribution-degraded';
  if (analysis.typeSymbolAttributionIncomplete) return 'type-symbol-attribution-incomplete';
  if (analysis.dependentAttributionPartial) return 'dependent-attribution-partial';
  if (analysis.dependentAttributionIncomplete) return 'dependent-attribution-incomplete';
  return undefined;
}

/**
 * Build the note for whichever reason `decideAttributionCaveatReason`
 * chose. `importedBy` is only ever read in the `type-symbol-attribution-
 * incomplete` case -- see that function's doc comment for why the caller
 * (`handleGetDependents`) only computes it when that reason has already won.
 */
function buildAttributionCaveat(
  analysis: DependencyAnalysisResult,
  filepath: string,
  symbol: string | undefined,
  unresolvedTargetNote: string | undefined,
  importedBy: string[] | undefined,
): AttributionCaveat | undefined {
  const reason = decideAttributionCaveatReason(analysis, unresolvedTargetNote);

  switch (reason) {
    case undefined:
      return undefined;

    case 'unresolved-target':
      return {
        reason,
        note:
          unresolvedTargetNote ??
          `⚠ Lien: "${filepath}" has no chunks anywhere in the index — every count above ` +
            'is a deliberate 0, not a confirmed empty dependency graph. This can mean the ' +
            'path was never indexed, is misspelled (wrong directory prefix, wrong case), or ' +
            'genuinely has no extractable content. Do not treat this as a low-risk or ' +
            'dependency-free file; check for a typo before editing, try search_code or ' +
            'list_functions to find the real path, or run "lien index" if the file was added ' +
            'recently.',
      };

    case 'symbol-attribution-degraded': {
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
      return { reason, note };
    }

    case 'type-symbol-attribution-incomplete': {
      const language = detectLanguage(filepath);
      const isBlindSpotLanguage = language !== null && hasDependentAttributionBlindSpot(language);
      const note = buildTypeSymbolCaveatNote(
        symbol,
        filepath,
        importedBy ?? [],
        isBlindSpotLanguage,
      );
      return { reason, note };
    }

    case 'dependent-attribution-partial':
      return { reason, note: buildPartialRecoveryNote(analysis, filepath) };

    case 'dependent-attribution-incomplete':
      return {
        reason,
        note:
          `No import-based dependents were found for ${filepath}, but its language lets real ` +
          `callers use its exports with no per-file import naming it at all (e.g. C#'s "global ` +
          `using" / implicit enclosing-namespace access, Java/Kotlin's same-package visibility, ` +
          `or Swift's whole-module access). The import graph has no signal for that usage shape, ` +
          `so dependentCount: 0 and riskLevel: "low" here mean "the scan found nothing," not ` +
          `"nothing depends on this file" — don't treat this as a verified clear.`,
      };
  }
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
  importedBy?: string[],
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
  if (importedBy !== undefined) {
    response.importedBy = importedBy;
  }
  const attributionCaveat = buildAttributionCaveat(
    analysis,
    filepath,
    symbol,
    unresolvedTargetNote,
    importedBy,
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

    // #1015 fix direction 2: a type-symbol query with zero call-site usages
    // may still have real, non-call-site import evidence in the call-graph
    // (`import-only`/`import-verified` edges — a constructor call, a type
    // hint, an `extends`/`implements` clause). Only built lazily here, for
    // this one query shape — see `getOrBuildDependencyGraph`'s doc comment.
    //
    // Gated on `decideAttributionCaveatReason`'s ACTUAL winner, not the raw
    // `analysis.typeSymbolAttributionIncomplete` flag: an earlier-priority
    // reason (`unresolved-target`, when the #927 manifest check and #928's
    // chunk-based scan disagree) can still win even when that flag is set,
    // and `importedBy` must never populate for a response whose surfaced
    // `attributionCaveat.reason` says something else.
    const attributionReason = decideAttributionCaveatReason(analysis, unindexedNote);
    const importedBy =
      attributionReason === 'type-symbol-attribution-incomplete'
        ? computeImportOnlyEvidence(
            await getOrBuildDependencyGraph(vectorDB, log, indexInfo.indexVersion),
            getCanonicalPath(filepath, workspaceRoot),
            // Invariant: `typeSymbolAttributionIncomplete` is only ever set
            // for a symbol-scoped query (see `FindDependentsResult`'s doc
            // comment in `@liendev/parser`), so `symbol` is defined here.
            symbol as string,
            analysis.dependents,
          )
        : undefined;

    // Build and return response
    return buildDependentsResponse(
      analysis,
      validatedArgs,
      risk,
      indexInfo,
      unindexedNote,
      importedBy,
    );
  })(args);
}

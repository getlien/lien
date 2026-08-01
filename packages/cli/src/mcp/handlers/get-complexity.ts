import collect from 'collect.js';
import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetComplexitySchema } from '../schemas/index.js';
import type { GetComplexityInput } from '../schemas/index.js';
import {
  findUnindexedPaths,
  formatUnindexedPathsNote,
  formatNoIndexNote,
} from '../utils/unindexed-paths.js';
import { ComplexityAnalyzer } from '@liendev/core';
import type { ComplexityViolation, FileComplexityData, ComplexityReport } from '@liendev/parser';
import type { ToolContext, MCPToolResult } from '../types.js';

// ============================================================================
// Types
// ============================================================================

type TransformedViolation = ReturnType<typeof transformViolation>;

interface ProcessedViolations {
  violations: TransformedViolation[];
  topViolations: TransformedViolation[];
  bySeverity: { error: number; warning: number };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Transform a violation with file-level metadata for API response.
 *
 * `complexityRiskLevel` (renamed from `riskLevel` — CLI-4/REVIEW-6) is
 * `FileComplexityData.riskLevel`: the file's own complexity severity, boosted
 * (never downgraded) by dependent count/complexity — see that field's doc
 * comment in `@liendev/parser`'s `insights/types.ts`. It is a DIFFERENT
 * metric from `get_dependents`/`lien annotate`/`lien api-delta`'s
 * `riskLevel` (blast-radius risk, `computeBlastRadiusRisk` in
 * `@liendev/parser`'s `risk/blast-radius-risk.ts`), which weighs dependents'
 * test coverage and applies a complexity floor instead of a ceiling-less
 * boost. The two can disagree for the same file at the same moment by
 * design — see docs/architecture/blast-radius-nudge.md's "Two risk
 * concepts" section. Do not rename this back to `riskLevel`: that name
 * collision, observed side-by-side across `get_complexity` and the other
 * three surfaces, is the exact defect this rename fixes.
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
    complexityRiskLevel: fileData.riskLevel,
    testAssociations: fileData.testAssociations,
    ...(v.halsteadDetails && { halsteadDetails: v.halsteadDetails }),
  };
}

/**
 * Process violations from complexity report.
 * Transforms, filters, and sorts violations.
 */
function processViolations(
  report: ComplexityReport,
  threshold: number | undefined,
  top: number,
  metricType?: GetComplexityInput['metricType'],
): ProcessedViolations {
  const allViolations: TransformedViolation[] = collect(Object.entries(report.files))
    .flatMap(([, /* filepath unused */ fileData]) =>
      fileData.violations
        .filter(v => !metricType || v.metricType === metricType)
        .filter(v => threshold === undefined || v.complexity >= threshold)
        .map(v => transformViolation(v, fileData)),
    )
    .sortByDesc('complexity')
    .all() as unknown as TransformedViolation[];

  const violations = allViolations;

  const severityCounts = collect(violations).countBy('severity').all() as {
    error?: number;
    warning?: number;
  };

  return {
    violations,
    topViolations: violations.slice(0, top),
    bySeverity: {
      error: severityCounts['error'] || 0,
      warning: severityCounts['warning'] || 0,
    },
  };
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle get_complexity tool calls.
 * Analyzes complexity for files or the entire codebase.
 */
export async function handleGetComplexity(args: unknown, ctx: ToolContext): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(GetComplexitySchema, async validatedArgs => {
    const { files, top, threshold, metricType } = validatedArgs;
    log('Analyzing complexity...');
    await checkAndReconnect();

    // When `files` is given, distinguish "path unknown to the index" from
    // "indexed, zero violations" — filesAnalyzed silently dropping a mistyped
    // path to 0 (or, in a mixed batch, just quietly excluding it) reads as a
    // clean bill of health unless called out explicitly.
    let unindexedNote: string | undefined;
    if (files && files.length > 0) {
      const workspaceRoot = process.cwd().replace(/\\/g, '/');
      const unindexedPaths = await findUnindexedPaths(vectorDB, files, workspaceRoot);
      unindexedNote = formatUnindexedPathsNote(unindexedPaths);
      if (unindexedPaths.length > 0) {
        log(`Path(s) not found in index: ${unindexedPaths.join(', ')}`, 'warning');
      }
    }

    // Step 1: Run complexity analysis
    const analyzer = new ComplexityAnalyzer(vectorDB);
    const report = await analyzer.analyze(files);
    log(`Analyzed ${report.summary.filesAnalyzed} files`);

    // Step 2: Process violations
    const { violations, topViolations, bySeverity } = processViolations(
      report,
      threshold,
      top ?? 10,
      metricType,
    );

    // A whole-repo scan (no `files` filter) over a structural store that has
    // no data at all (never indexed, cleared, or mid-rebuild) produces
    // exactly the same "0 files analyzed, 0 violations" shape as a
    // genuinely clean, fully-indexed codebase — that's backwards for a tool
    // whose entire purpose is a confidence check before relying on the
    // answer. `unindexedNote` above already covers the scoped-`files` case
    // (every requested path already reads as unknown-to-the-index when the
    // whole store is empty); this only fires the ADDITIONAL "the index
    // itself is empty" fact when `files` was omitted, mirroring
    // search_code/list_functions's own `hasData()` gate for the identical
    // 0-results ambiguity.
    let note = unindexedNote;
    if (!note && report.summary.filesAnalyzed === 0 && !(await vectorDB.hasData())) {
      note = formatNoIndexNote();
    }

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
      ...(note && { note }),
    };
  })(args);
}

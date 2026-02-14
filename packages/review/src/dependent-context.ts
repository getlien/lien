/**
 * Dependent context assembly for high-risk functions in PR reviews.
 *
 * Scans in-memory CodeChunks for call sites referencing high-risk functions
 * and produces prompt-ready markdown snippets showing how those functions
 * are used in dependent files within the same PR.
 */

import type { CodeChunk } from '@liendev/core';
import type { ComplexityReport } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single dependent usage snippet showing where a symbol is called. */
export interface DependentSnippet {
  /** Path of the file that depends on the target */
  filepath: string;
  /** Name of the function/method containing the call site */
  callerSymbol: string;
  /** Line number of the call site */
  line: number;
  /** ~5-line code snippet around the call site */
  snippet: string;
  /** Complexity of the caller function (if available) */
  callerComplexity?: number;
}

/** Dependent context for a single high-risk function. */
export interface DependentContext {
  /** The target function key ("filepath::symbolName") */
  targetKey: string;
  /** Filepath of the target */
  filepath: string;
  /** Symbol name of the target */
  symbolName: string;
  /** Total dependent count from the report */
  totalDependentCount: number;
  /** Risk level from the report */
  riskLevel: string;
  /** Top N dependent snippets, sorted by caller complexity descending */
  snippets: DependentSnippet[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FUNCTIONS = 3;
const MAX_SNIPPETS_PER_FUNCTION = 3;
const CONTEXT_LINES_BEFORE = 2;
const CONTEXT_LINES_AFTER = 2;
const MAX_LINE_LENGTH = 120;

const RISK_WEIGHTS: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface QualifyingFunction {
  filepath: string;
  symbolName: string;
  dependentCount: number;
  riskLevel: string;
  impactScore: number;
  dependents: string[];
}

/**
 * Select top N high-risk functions by impact score (dependentCount * risk weight).
 * Only includes functions with riskLevel "high" or "critical" and dependentCount > 0.
 */
export function selectTopFunctions(report: ComplexityReport): QualifyingFunction[] {
  const candidates: QualifyingFunction[] = [];

  for (const [filepath, fileData] of Object.entries(report.files)) {
    if (!['high', 'critical'].includes(fileData.riskLevel)) continue;
    if (!fileData.dependentCount || fileData.dependentCount === 0) continue;

    for (const violation of fileData.violations) {
      const weight = RISK_WEIGHTS[fileData.riskLevel] ?? 1;
      candidates.push({
        filepath,
        symbolName: violation.symbolName,
        dependentCount: fileData.dependentCount,
        riskLevel: fileData.riskLevel,
        impactScore: fileData.dependentCount * weight,
        dependents: fileData.dependents ?? [],
      });
    }
  }

  candidates.sort((a, b) => b.impactScore - a.impactScore);
  return candidates.slice(0, MAX_FUNCTIONS);
}

/**
 * Find chunks from dependent files that have callSites referencing the given symbol.
 * Returns at most MAX_SNIPPETS_PER_FUNCTION results, sorted by caller complexity descending.
 */
export function findCallSitesForSymbol(
  symbolName: string,
  dependentFilepaths: string[],
  chunks: CodeChunk[],
): DependentSnippet[] {
  const dependentSet = new Set(dependentFilepaths);
  const results: DependentSnippet[] = [];
  // Track seen files to pick only one call site per dependent file
  const seenFiles = new Set<string>();

  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    if (!dependentSet.has(file) || seenFiles.has(file)) continue;

    const callSite = findMatchingCallSite(chunk, symbolName);
    if (!callSite) continue;

    const snippet = extractSnippetWindow(chunk, callSite.line);
    if (!snippet) continue;

    seenFiles.add(file);
    results.push({
      filepath: file,
      callerSymbol: chunk.metadata.symbolName ?? 'unknown',
      line: callSite.line,
      snippet,
      callerComplexity: chunk.metadata.complexity,
    });
  }

  // Sort by caller complexity descending (undefined treated as 0)
  results.sort((a, b) => (b.callerComplexity ?? 0) - (a.callerComplexity ?? 0));
  return results.slice(0, MAX_SNIPPETS_PER_FUNCTION);
}

function findMatchingCallSite(chunk: CodeChunk, symbolName: string): { line: number } | undefined {
  if (!chunk.metadata.callSites || chunk.metadata.callSites.length === 0) return undefined;

  const callSite = chunk.metadata.callSites.find(cs => cs.symbol === symbolName);
  if (!callSite) return undefined;

  // Validate call site is within chunk range
  if (callSite.line < chunk.metadata.startLine || callSite.line > chunk.metadata.endLine) {
    return undefined;
  }

  return callSite;
}

/**
 * Extract a ~5-line window around a call site line from a chunk's content.
 * Converts the absolute line number to chunk-relative and clamps to bounds.
 * Truncates lines longer than MAX_LINE_LENGTH.
 */
export function extractSnippetWindow(chunk: CodeChunk, callSiteLine: number): string | null {
  const lines = chunk.content.split('\n');
  const relativeLine = callSiteLine - chunk.metadata.startLine;

  if (relativeLine < 0 || relativeLine >= lines.length) return null;

  const start = Math.max(0, relativeLine - CONTEXT_LINES_BEFORE);
  const end = Math.min(lines.length - 1, relativeLine + CONTEXT_LINES_AFTER);

  const windowLines = lines
    .slice(start, end + 1)
    .map(line => (line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '...' : line));

  return windowLines.join('\n');
}

/**
 * Format a DependentContext into prompt-ready markdown.
 */
export function formatDependentContext(ctx: DependentContext): string {
  if (ctx.snippets.length === 0) {
    // Fallback: list dependent file names without code snippets
    return formatFallbackContext(ctx);
  }

  const totalLabel =
    ctx.totalDependentCount > ctx.snippets.length
      ? `top ${ctx.snippets.length} of ${ctx.totalDependentCount} dependents`
      : `${ctx.snippets.length} dependent${ctx.snippets.length === 1 ? '' : 's'}`;

  const snippetBlocks = ctx.snippets
    .map(s => {
      const complexityNote = s.callerComplexity ? ` (complexity: ${s.callerComplexity})` : '';
      return `\`\`\`\n// ${s.filepath}:${s.line} — in ${s.callerSymbol}()${complexityNote}\n${s.snippet}\n\`\`\``;
    })
    .join('\n\n');

  return `**Dependent Usage Context** (${totalLabel}):\n\n${snippetBlocks}`;
}

/**
 * Fallback formatting when we have dependents listed but no call-site snippets.
 */
function formatFallbackContext(ctx: DependentContext): string {
  if (ctx.totalDependentCount === 0) return '';

  return `**Dependent Usage Context** (no call-site data available):\n- ${ctx.totalDependentCount} file(s) depend on \`${ctx.symbolName}\``;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Assemble dependent-context snippets for high-risk functions in a PR.
 *
 * @param report - The complexity report with per-file dependency data
 * @param chunks - All CodeChunks from changed files (in-memory, no VectorDB)
 * @returns Map of "filepath::symbolName" -> formatted dependent context string
 */
export function assembleDependentContext(
  report: ComplexityReport,
  chunks: CodeChunk[],
): Map<string, string> {
  const result = new Map<string, string>();
  const topFunctions = selectTopFunctions(report);

  if (topFunctions.length === 0) return result;

  for (const func of topFunctions) {
    const key = `${func.filepath}::${func.symbolName}`;

    // Find dependent chunks with matching call sites
    const snippets = findCallSitesForSymbol(func.symbolName, func.dependents, chunks);

    // If we have dependents listed but none in memory, skip —
    // the existing buildDependencyContext() in prompt.ts handles this.
    if (snippets.length === 0 && func.dependents.length === 0) continue;

    const ctx: DependentContext = {
      targetKey: key,
      filepath: func.filepath,
      symbolName: func.symbolName,
      totalDependentCount: func.dependentCount,
      riskLevel: func.riskLevel,
      snippets,
    };

    const formatted = formatDependentContext(ctx);
    if (formatted) {
      result.set(key, formatted);
    }
  }

  return result;
}

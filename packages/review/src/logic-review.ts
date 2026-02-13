/**
 * Logic review detection engine.
 * Analyzes CodeChunks and ComplexityReport to find logic issues backed by AST evidence.
 */

import type { CodeChunk, ComplexityReport } from '@liendev/core';
import type { LogicFinding } from './types.js';

/**
 * Detect logic findings from AST data.
 * Runs enabled category detectors and returns prioritized findings.
 */
export function detectLogicFindings(
  chunks: CodeChunk[],
  report: ComplexityReport,
  baselineReport: ComplexityReport | null,
  categories: string[],
): LogicFinding[] {
  const findings: LogicFinding[] = [];
  const enabledCategories = new Set(categories);

  if (enabledCategories.has('breaking_change') && baselineReport) {
    findings.push(...detectBreakingChanges(chunks, report, baselineReport));
  }

  if (enabledCategories.has('unchecked_return')) {
    findings.push(...detectUncheckedReturns(chunks));
  }

  if (enabledCategories.has('missing_tests')) {
    findings.push(...detectMissingTestCoverage(chunks, report));
  }

  return prioritizeFindings(findings, report);
}

/**
 * Build a map of file -> Set<exportName> from chunks metadata.
 */
function buildExportsMap(chunks: CodeChunk[]): Map<string, Set<string>> {
  const exports = new Map<string, Set<string>>();
  for (const chunk of chunks) {
    if (chunk.metadata.exports && chunk.metadata.exports.length > 0) {
      const existing = exports.get(chunk.metadata.file) || new Set();
      for (const exp of chunk.metadata.exports) {
        existing.add(exp);
      }
      exports.set(chunk.metadata.file, existing);
    }
  }
  return exports;
}

/**
 * Find symbols that exist in the baseline but are missing from the current version.
 */
function findRemovedSymbols(
  filepath: string,
  baseFileData: ComplexityReport['files'][string],
  currentFileData: ComplexityReport['files'][string],
  currentFileExports: Set<string>,
): LogicFinding[] {
  const dependentCount = currentFileData.dependentCount || 0;
  const baseSymbols = new Set(baseFileData.violations.map(v => v.symbolName));
  const currentSymbols = new Set(currentFileData.violations.map(v => v.symbolName));

  return [...baseSymbols]
    .filter(symbol => !currentSymbols.has(symbol) && !currentFileExports.has(symbol))
    .map(symbol => ({
      filepath,
      symbolName: symbol,
      line: 1,
      category: 'breaking_change' as const,
      severity: 'error' as const,
      message: `Exported symbol \`${symbol}\` was removed or renamed. ${dependentCount} file(s) depend on this module.`,
      evidence: `Symbol "${symbol}" exists in baseline but not in current. ${dependentCount} dependent(s).`,
    }));
}

/**
 * Detect breaking changes: exported symbols removed or renamed between baseline and current.
 */
function detectBreakingChanges(
  chunks: CodeChunk[],
  report: ComplexityReport,
  baselineReport: ComplexityReport,
): LogicFinding[] {
  const currentExports = buildExportsMap(chunks);

  return Object.entries(baselineReport.files).flatMap(([filepath, baseFileData]) => {
    const currentFileData = report.files[filepath];
    if (!currentFileData || (currentFileData.dependentCount || 0) === 0) return [];

    return findRemovedSymbols(
      filepath,
      baseFileData,
      currentFileData,
      currentExports.get(filepath) || new Set(),
    );
  });
}

/**
 * Check a single call site for unchecked return value and return a finding if applicable.
 */
function checkCallSite(
  chunk: CodeChunk,
  callSite: { symbol: string; line: number },
  lines: string[],
  startLine: number,
): LogicFinding | null {
  const lineIndex = callSite.line - startLine;
  if (lineIndex < 0 || lineIndex >= lines.length) return null;

  const lineContent = lines[lineIndex].trim();
  if (!isLikelyUncheckedCall(lineContent, callSite.symbol)) return null;

  return {
    filepath: chunk.metadata.file,
    symbolName: chunk.metadata.symbolName!,
    line: callSite.line,
    category: 'unchecked_return',
    severity: 'warning',
    message: `Return value of \`${callSite.symbol}()\` is not captured. If it returns an error or important data, this could lead to silent failures.`,
    evidence: `Call to "${callSite.symbol}" at line ${callSite.line} appears to discard its return value. Line: "${lineContent}"`,
  };
}

/**
 * Detect unchecked return values: call sites where the return value is not captured.
 * Builds evidence for LLM validation — the LLM confirms whether ignoring the return is a bug.
 */
function detectUncheckedReturns(chunks: CodeChunk[]): LogicFinding[] {
  const findings: LogicFinding[] = [];

  for (const chunk of chunks) {
    if (!chunk.metadata.callSites || chunk.metadata.callSites.length === 0) continue;
    if (!chunk.metadata.symbolName) continue;

    const lines = chunk.content.split('\n');
    for (const callSite of chunk.metadata.callSites) {
      const finding = checkCallSite(chunk, callSite, lines, chunk.metadata.startLine);
      if (finding) findings.push(finding);
    }
  }

  return findings;
}

/**
 * Heuristic check: does this line look like an unchecked function call?
 * Returns true if the call result is likely not assigned to anything.
 */
function isLikelyUncheckedCall(lineContent: string, symbol: string): boolean {
  // Skip if line is a return statement
  if (lineContent.startsWith('return ')) return false;

  // Skip if line has an assignment before the call
  if (/^(?:const|let|var|this\.\w+)\s/.test(lineContent)) return false;
  if (/^\w+\s*=/.test(lineContent)) return false;

  // Skip if it's a chained call (e.g., foo().bar())
  // — the intermediate result is consumed by the chain
  const callIndex = lineContent.indexOf(symbol + '(');
  if (callIndex === -1) return false;

  // Skip common patterns that intentionally ignore returns
  // - void expressions
  if (lineContent.startsWith('void ')) return false;
  // - await without assignment (could be intentional for side effects)
  if (lineContent.startsWith('await ') && !lineContent.includes('=')) {
    // Keep this — awaiting without capturing is a common pattern for side effects
    // but it's still worth flagging for LLM review
    return true;
  }

  // The call appears to be a standalone statement
  // Check that the symbol call starts approximately at the beginning of the line
  // (allowing for `await` prefix)
  const stripped = lineContent.replace(/^await\s+/, '');
  if (stripped.startsWith(symbol + '(') || stripped.startsWith(`this.${symbol}(`)) {
    return true;
  }

  return false;
}

/**
 * Detect functions with missing test coverage that are high-risk:
 * - High complexity (>= 10)
 * - Many dependents (>= 3)
 * - No test associations
 */
function detectMissingTestCoverage(chunks: CodeChunk[], report: ComplexityReport): LogicFinding[] {
  const findings: LogicFinding[] = [];
  const seen = new Set<string>(); // Avoid duplicates per file::symbol

  for (const chunk of chunks) {
    if (!chunk.metadata.symbolName) continue;
    if (chunk.metadata.type !== 'function') continue;

    const key = `${chunk.metadata.file}::${chunk.metadata.symbolName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const complexity = chunk.metadata.complexity || 0;
    const fileData = report.files[chunk.metadata.file];
    const dependentCount = fileData?.dependentCount || 0;
    const hasTests = fileData?.testAssociations && fileData.testAssociations.length > 0;

    // Only flag high-risk functions: complex + depended-upon + no tests
    if (complexity >= 10 && dependentCount >= 3 && !hasTests) {
      findings.push({
        filepath: chunk.metadata.file,
        symbolName: chunk.metadata.symbolName,
        line: chunk.metadata.startLine,
        category: 'missing_tests',
        severity: 'warning',
        message: `\`${chunk.metadata.symbolName}\` has complexity ${complexity} and ${dependentCount} dependents but no test coverage. This is a high-risk function.`,
        evidence: `Complexity: ${complexity}, Dependents: ${dependentCount}, Test files: none`,
      });
    }
  }

  return findings;
}

/**
 * Prioritize findings by risk: dependents * severity weight, then complexity.
 * Returns the top 15 findings to avoid review fatigue.
 */
function prioritizeFindings(findings: LogicFinding[], report: ComplexityReport): LogicFinding[] {
  const MAX_FINDINGS = 15;

  const severityWeight = { error: 10, warning: 5 };

  return findings
    .sort((a, b) => {
      const fileA = report.files[a.filepath];
      const fileB = report.files[b.filepath];
      const scoreA = (fileA?.dependentCount || 0) * severityWeight[a.severity];
      const scoreB = (fileB?.dependentCount || 0) * severityWeight[b.severity];

      if (scoreB !== scoreA) return scoreB - scoreA;

      // Tie-break: errors first
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;

      return 0;
    })
    .slice(0, MAX_FINDINGS);
}

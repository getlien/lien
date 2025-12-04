/**
 * Complexity delta calculation
 * Compares base branch complexity to head branch complexity
 */

import * as core from '@actions/core';
import type { ComplexityReport, ComplexityDelta, DeltaSummary, ComplexityViolation } from './types.js';

/**
 * Create a key for a function to match across base/head
 */
function getFunctionKey(filepath: string, symbolName: string): string {
  return `${filepath}::${symbolName}`;
}

/**
 * Build a map of function complexities from a report
 */
function buildComplexityMap(
  report: ComplexityReport | null,
  files: string[]
): Map<string, { complexity: number; violation: ComplexityViolation }> {
  const map = new Map<string, { complexity: number; violation: ComplexityViolation }>();

  if (!report) return map;

  for (const filepath of files) {
    const fileData = report.files[filepath];
    if (!fileData) continue;

    for (const violation of fileData.violations) {
      const key = getFunctionKey(filepath, violation.symbolName);
      map.set(key, { complexity: violation.complexity, violation });
    }
  }

  return map;
}

/**
 * Calculate complexity deltas between base and head
 */
export function calculateDeltas(
  baseReport: ComplexityReport | null,
  headReport: ComplexityReport,
  changedFiles: string[]
): ComplexityDelta[] {
  const deltas: ComplexityDelta[] = [];

  const baseMap = buildComplexityMap(baseReport, changedFiles);
  const headMap = buildComplexityMap(headReport, changedFiles);

  // Track which base functions we've seen
  const seenBaseKeys = new Set<string>();

  // Process all head violations
  for (const [key, headData] of headMap) {
    const baseData = baseMap.get(key);
    if (baseData) {
      seenBaseKeys.add(key);
    }

    const baseComplexity = baseData?.complexity ?? null;
    const headComplexity = headData.complexity;
    const delta = baseComplexity !== null ? headComplexity - baseComplexity : headComplexity;

    // Determine severity based on delta
    let severity: ComplexityDelta['severity'];
    if (baseComplexity === null) {
      severity = 'new';
    } else if (delta < 0) {
      severity = 'improved';
    } else if (headComplexity >= headData.violation.threshold * 2) {
      severity = 'error';
    } else {
      severity = 'warning';
    }

    deltas.push({
      filepath: headData.violation.filepath,
      symbolName: headData.violation.symbolName,
      symbolType: headData.violation.symbolType,
      startLine: headData.violation.startLine,
      baseComplexity,
      headComplexity,
      delta,
      threshold: headData.violation.threshold,
      severity,
    });
  }

  // Process deleted functions (in base but not in head)
  for (const [key, baseData] of baseMap) {
    if (seenBaseKeys.has(key)) continue;

    deltas.push({
      filepath: baseData.violation.filepath,
      symbolName: baseData.violation.symbolName,
      symbolType: baseData.violation.symbolType,
      startLine: baseData.violation.startLine,
      baseComplexity: baseData.complexity,
      headComplexity: null,
      delta: -baseData.complexity, // Negative = improvement (removed complexity)
      threshold: baseData.violation.threshold,
      severity: 'deleted',
    });
  }

  // Sort by delta (worst first), then by absolute complexity
  deltas.sort((a, b) => {
    // Errors first, then warnings, then new, then improved, then deleted
    const severityOrder = { error: 0, warning: 1, new: 2, improved: 3, deleted: 4 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    // Within same severity, sort by delta (worse first)
    return b.delta - a.delta;
  });

  return deltas;
}

/**
 * Calculate summary statistics for deltas
 */
export function calculateDeltaSummary(deltas: ComplexityDelta[]): DeltaSummary {
  let totalDelta = 0;
  let improved = 0;
  let degraded = 0;
  let newFunctions = 0;
  let deletedFunctions = 0;
  let unchanged = 0;

  for (const d of deltas) {
    totalDelta += d.delta;

    switch (d.severity) {
      case 'improved':
        improved++;
        break;
      case 'error':
      case 'warning':
        if (d.delta > 0) degraded++;
        else if (d.delta === 0) unchanged++;
        else improved++;
        break;
      case 'new':
        newFunctions++;
        break;
      case 'deleted':
        deletedFunctions++;
        break;
    }
  }

  return {
    totalDelta,
    improved,
    degraded,
    newFunctions,
    deletedFunctions,
    unchanged,
  };
}

/**
 * Format delta for display
 */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta} ⬆️`;
  if (delta < 0) return `${delta} ⬇️`;
  return '±0';
}

/**
 * Format severity emoji
 */
export function formatSeverityEmoji(severity: ComplexityDelta['severity']): string {
  switch (severity) {
    case 'error':
      return '🔴';
    case 'warning':
      return '🟡';
    case 'improved':
      return '🟢';
    case 'new':
      return '🆕';
    case 'deleted':
      return '🗑️';
  }
}

/**
 * Log delta summary
 */
export function logDeltaSummary(summary: DeltaSummary): void {
  const sign = summary.totalDelta >= 0 ? '+' : '';
  core.info(`Complexity delta: ${sign}${summary.totalDelta}`);
  core.info(`  Degraded: ${summary.degraded}, Improved: ${summary.improved}`);
  core.info(`  New: ${summary.newFunctions}, Deleted: ${summary.deletedFunctions}`);
}


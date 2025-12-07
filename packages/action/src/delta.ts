/**
 * Complexity delta calculation
 * Compares base branch complexity to head branch complexity
 */

import * as core from '@actions/core';
import collect from 'collect.js';
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
  if (!report) return new Map();

  type MapEntry = [string, { complexity: number; violation: ComplexityViolation }];
  
  // Flatten violations from all requested files and build map entries
  const entries = collect(files)
    .map(filepath => ({ filepath, fileData: report.files[filepath] }))
    .filter(({ fileData }) => !!fileData)
    .flatMap(({ filepath, fileData }) =>
      fileData.violations.map(violation => [
        getFunctionKey(filepath, violation.symbolName),
        { complexity: violation.complexity, violation }
      ] as MapEntry)
    )
    .all() as unknown as MapEntry[];

  return new Map(entries);
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
      metricType: headData.violation.metricType,
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
      metricType: baseData.violation.metricType,
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
  const collection = collect(deltas);
  
  // Categorize each delta
  const categorized = collection.map(d => {
    if (d.severity === 'improved') return 'improved';
    if (d.severity === 'new') return 'new';
    if (d.severity === 'deleted') return 'deleted';
    // error/warning: check delta direction
    if (d.delta > 0) return 'degraded';
    if (d.delta === 0) return 'unchanged';
    return 'improved';
  });

  const counts = categorized.countBy().all() as unknown as Record<string, number>;

  return {
    totalDelta: collection.sum('delta') as number,
    improved: counts['improved'] || 0,
    degraded: counts['degraded'] || 0,
    newFunctions: counts['new'] || 0,
    deletedFunctions: counts['deleted'] || 0,
    unchanged: counts['unchanged'] || 0,
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


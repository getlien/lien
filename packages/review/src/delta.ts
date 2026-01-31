/**
 * Complexity delta calculation
 * Compares base branch complexity to head branch complexity
 */

import collect from 'collect.js';
import type {
  ComplexityReport,
  ComplexityViolation,
} from '@liendev/core';
import type { Logger } from './logger.js';

/**
 * Complexity delta for a single function/method
 */
export interface ComplexityDelta {
  filepath: string;
  symbolName: string;
  symbolType: string;
  startLine: number;
  metricType: string; // which metric this delta is for
  baseComplexity: number | null; // null = new function
  headComplexity: number | null; // null = deleted function
  delta: number; // positive = worse, negative = better
  threshold: number;
  severity: 'warning' | 'error' | 'improved' | 'new' | 'deleted';
}

/**
 * Summary of complexity changes in a PR
 */
export interface DeltaSummary {
  totalDelta: number; // net change across all functions
  improved: number; // count of functions that got simpler
  degraded: number; // count of functions that got more complex
  newFunctions: number; // count of new functions with violations
  deletedFunctions: number; // count of deleted functions (freed complexity)
  unchanged: number; // count of functions with same complexity
}

/**
 * Create a key for a function+metric to match across base/head
 * Includes metricType since a function can have multiple metric violations
 */
function getFunctionKey(filepath: string, symbolName: string, metricType: string): string {
  return `${filepath}::${symbolName}::${metricType}`;
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
        getFunctionKey(filepath, violation.symbolName, violation.metricType),
        { complexity: violation.complexity, violation }
      ] as MapEntry)
    )
    .all() as unknown as MapEntry[];

  return new Map(entries);
}

/**
 * Determine severity based on complexity change
 */
function determineSeverity(
  baseComplexity: number | null,
  headComplexity: number,
  delta: number,
  threshold: number
): ComplexityDelta['severity'] {
  if (baseComplexity === null) return 'new';
  if (delta < 0) return 'improved';
  return headComplexity >= threshold * 2 ? 'error' : 'warning';
}

/**
 * Create a delta object from violation data
 */
function createDelta(
  violation: ComplexityViolation,
  baseComplexity: number | null,
  headComplexity: number | null,
  severity: ComplexityDelta['severity']
): ComplexityDelta {
  const delta = baseComplexity !== null && headComplexity !== null
    ? headComplexity - baseComplexity
    : headComplexity ?? -(baseComplexity ?? 0);

  return {
    filepath: violation.filepath,
    symbolName: violation.symbolName,
    symbolType: violation.symbolType,
    startLine: violation.startLine,
    metricType: violation.metricType,
    baseComplexity,
    headComplexity,
    delta,
    threshold: violation.threshold,
    severity,
  };
}

/**
 * Sort deltas by severity (errors first), then by delta magnitude (worst first)
 */
const SEVERITY_ORDER: Record<ComplexityDelta['severity'], number> = {
  error: 0, warning: 1, new: 2, improved: 3, deleted: 4,
};

function sortDeltas(deltas: ComplexityDelta[]): ComplexityDelta[] {
  return deltas.sort((a, b) => {
    if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    }
    return b.delta - a.delta;
  });
}

/**
 * Process head violations into deltas, tracking which base keys were matched
 */
function processHeadViolations(
  headMap: Map<string, { complexity: number; violation: ComplexityViolation }>,
  baseMap: Map<string, { complexity: number; violation: ComplexityViolation }>,
): { deltas: ComplexityDelta[]; seenBaseKeys: Set<string> } {
  const seenBaseKeys = new Set<string>();

  const deltas = collect(Array.from(headMap.entries()))
    .map(([key, headData]) => {
      const baseData = baseMap.get(key);
      if (baseData) seenBaseKeys.add(key);

      const baseComplexity = baseData?.complexity ?? null;
      const headComplexity = headData.complexity;
      const delta = baseComplexity !== null ? headComplexity - baseComplexity : headComplexity;
      const severity = determineSeverity(baseComplexity, headComplexity, delta, headData.violation.threshold);

      return createDelta(headData.violation, baseComplexity, headComplexity, severity);
    })
    .all() as ComplexityDelta[];

  return { deltas, seenBaseKeys };
}

/**
 * Calculate complexity deltas between base and head
 */
export function calculateDeltas(
  baseReport: ComplexityReport | null,
  headReport: ComplexityReport,
  changedFiles: string[]
): ComplexityDelta[] {
  const baseMap = buildComplexityMap(baseReport, changedFiles);
  const headMap = buildComplexityMap(headReport, changedFiles);

  const { deltas: headDeltas, seenBaseKeys } = processHeadViolations(headMap, baseMap);

  // Process deleted functions (in base but not in head)
  const deletedDeltas = collect(Array.from(baseMap.entries()))
    .filter(([key]) => !seenBaseKeys.has(key))
    .map(([_, baseData]) => createDelta(baseData.violation, baseData.complexity, null, 'deleted'))
    .all() as ComplexityDelta[];

  return sortDeltas([...headDeltas, ...deletedDeltas]);
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
export function logDeltaSummary(summary: DeltaSummary, logger: Logger): void {
  const sign = summary.totalDelta >= 0 ? '+' : '';
  logger.info(`Complexity delta: ${sign}${summary.totalDelta}`);
  logger.info(`  Degraded: ${summary.degraded}, Improved: ${summary.improved}`);
  logger.info(`  New: ${summary.newFunctions}, Deleted: ${summary.deletedFunctions}`);
}

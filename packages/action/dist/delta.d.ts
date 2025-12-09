/**
 * Complexity delta calculation
 * Compares base branch complexity to head branch complexity
 */
import type { ComplexityReport } from '@liendev/core';
/**
 * Complexity delta for a single function/method
 */
export interface ComplexityDelta {
    filepath: string;
    symbolName: string;
    symbolType: string;
    startLine: number;
    metricType: string;
    baseComplexity: number | null;
    headComplexity: number | null;
    delta: number;
    threshold: number;
    severity: 'warning' | 'error' | 'improved' | 'new' | 'deleted';
}
/**
 * Summary of complexity changes in a PR
 */
export interface DeltaSummary {
    totalDelta: number;
    improved: number;
    degraded: number;
    newFunctions: number;
    deletedFunctions: number;
    unchanged: number;
}
/**
 * Calculate complexity deltas between base and head
 */
export declare function calculateDeltas(baseReport: ComplexityReport | null, headReport: ComplexityReport, changedFiles: string[]): ComplexityDelta[];
/**
 * Calculate summary statistics for deltas
 */
export declare function calculateDeltaSummary(deltas: ComplexityDelta[]): DeltaSummary;
/**
 * Format delta for display
 */
export declare function formatDelta(delta: number): string;
/**
 * Format severity emoji
 */
export declare function formatSeverityEmoji(severity: ComplexityDelta['severity']): string;
/**
 * Log delta summary
 */
export declare function logDeltaSummary(summary: DeltaSummary): void;

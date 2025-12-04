/**
 * Complexity delta calculation
 * Compares base branch complexity to head branch complexity
 */
import type { ComplexityReport, ComplexityDelta, DeltaSummary } from './types.js';
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

/**
 * Format time in minutes as human-readable (e.g., "7h 54m", "-7h 54m", or "45m")
 * Handles both positive values (for thresholds) and negative values (for deltas).
 * Rounds total minutes first to avoid edge cases like "1h 60m".
 */
export declare function formatTime(minutes: number): string;
/**
 * Format delta value for display based on metric type.
 * - halstead_bugs: 2 decimal places
 * - halstead_effort: human-readable time (e.g., "-7h 54m")
 * - others: rounded integer
 */
export declare function formatDeltaValue(metricType: string, delta: number): string;

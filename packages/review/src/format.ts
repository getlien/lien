/**
 * Format time in minutes as human-readable (e.g., "7h 54m", "-7h 54m", or "45m")
 * Handles both positive values (for thresholds) and negative values (for deltas).
 * Rounds total minutes first to avoid edge cases like "1h 60m".
 */
export function formatTime(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const roundedMinutes = Math.round(Math.abs(minutes));
  if (roundedMinutes >= 60) {
    const hours = Math.floor(roundedMinutes / 60);
    const mins = roundedMinutes % 60;
    return mins > 0 ? `${sign}${hours}h ${mins}m` : `${sign}${hours}h`;
  }
  return `${sign}${roundedMinutes}m`;
}

/**
 * Format delta value for display based on metric type.
 * - halstead_bugs: 2 decimal places
 * - halstead_effort: human-readable time (e.g., "-7h 54m")
 * - others: rounded integer
 */
export function formatDeltaValue(metricType: string, delta: number): string {
  if (metricType === 'halstead_bugs') {
    return delta.toFixed(2);
  }
  // halstead_effort is stored in minutes - format as hours for readability
  if (metricType === 'halstead_effort') {
    return formatTime(delta);
  }
  return String(Math.round(delta));
}

/** Validate that a value is a positive integer. */
export function validatePositiveInt(value: unknown, name: string): number {
  const num = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (isNaN(num) || num < 1 || !Number.isInteger(num)) {
    throw new Error(`${name} must be a positive integer, got: ${value}`);
  }
  return num;
}

/** Validate a threshold value. */
export function validateThreshold(value: unknown): number {
  return validatePositiveInt(value, 'threshold');
}

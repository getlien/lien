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
/**
 * Format a duration in milliseconds as human-readable.
 */
export function formatDuration(durationMs: number): string {
  const totalMinutes = Math.round(durationMs / 60000);
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${totalMinutes}m`;
}

/**
 * Format a complexity score as time estimate.
 */
export function formatComplexityAsTime(complexity: number): string {
  const minutes = Math.round(complexity);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/**
 * Format a file count with optional label.
 */
export function formatFileCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

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

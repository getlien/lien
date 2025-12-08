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

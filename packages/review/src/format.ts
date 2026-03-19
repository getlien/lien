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

/**
 * Format a review run summary for display.
 * Builds the full summary string including stats, timing, and status.
 */
export function formatRunSummary(
  filesAnalyzed: number,
  violations: number,
  avgComplexity: number,
  maxComplexity: number,
  durationMs: number,
  status: string,
  tokenUsage: number,
  cost: number,
  model: string,
): string {
  // Format duration — duplicates formatTime logic
  const totalMinutes = Math.round(durationMs / 60000);
  let durationStr: string;
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    durationStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  } else {
    durationStr = `${totalMinutes}m`;
  }

  // Format cost
  const costStr = cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;

  // Build severity label
  let severityLabel: string;
  if (violations === 0) {
    severityLabel = 'Clean';
  } else if (violations <= 3) {
    severityLabel = 'Minor issues';
  } else if (violations <= 10) {
    severityLabel = 'Needs attention';
  } else {
    severityLabel = 'Critical';
  }

  // Format complexity — duplicates similar pattern from delta.ts
  const complexityStr =
    avgComplexity >= 60
      ? `${Math.floor(avgComplexity / 60)}h ${Math.round(avgComplexity % 60)}m`
      : `${Math.round(avgComplexity)}m`;

  return [
    `**${severityLabel}** — ${filesAnalyzed} files, ${violations} violations`,
    `Complexity: avg ${complexityStr}, max ${maxComplexity}`,
    `Duration: ${durationStr}`,
    `LLM: ${model} (${tokenUsage} tokens, ${costStr})`,
    `Status: ${status}`,
  ].join('\n');
}

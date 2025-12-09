"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTime = formatTime;
exports.formatDeltaValue = formatDeltaValue;
/**
 * Format time in minutes as human-readable (e.g., "7h 54m", "-7h 54m", or "45m")
 * Handles both positive values (for thresholds) and negative values (for deltas).
 * Rounds total minutes first to avoid edge cases like "1h 60m".
 */
function formatTime(minutes) {
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
function formatDeltaValue(metricType, delta) {
    if (metricType === 'halstead_bugs') {
        return delta.toFixed(2);
    }
    // halstead_effort is stored in minutes - format as hours for readability
    if (metricType === 'halstead_effort') {
        return formatTime(delta);
    }
    return String(Math.round(delta));
}
//# sourceMappingURL=format.js.map
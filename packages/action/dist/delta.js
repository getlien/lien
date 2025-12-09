"use strict";
/**
 * Complexity delta calculation
 * Compares base branch complexity to head branch complexity
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDeltas = calculateDeltas;
exports.calculateDeltaSummary = calculateDeltaSummary;
exports.formatDelta = formatDelta;
exports.formatSeverityEmoji = formatSeverityEmoji;
exports.logDeltaSummary = logDeltaSummary;
const core = __importStar(require("@actions/core"));
const collect_js_1 = __importDefault(require("collect.js"));
/**
 * Create a key for a function+metric to match across base/head
 * Includes metricType since a function can have multiple metric violations
 */
function getFunctionKey(filepath, symbolName, metricType) {
    return `${filepath}::${symbolName}::${metricType}`;
}
/**
 * Build a map of function complexities from a report
 */
function buildComplexityMap(report, files) {
    if (!report)
        return new Map();
    // Flatten violations from all requested files and build map entries
    const entries = (0, collect_js_1.default)(files)
        .map(filepath => ({ filepath, fileData: report.files[filepath] }))
        .filter(({ fileData }) => !!fileData)
        .flatMap(({ filepath, fileData }) => fileData.violations.map(violation => [
        getFunctionKey(filepath, violation.symbolName, violation.metricType),
        { complexity: violation.complexity, violation }
    ]))
        .all();
    return new Map(entries);
}
/**
 * Determine severity based on complexity change
 */
function determineSeverity(baseComplexity, headComplexity, delta, threshold) {
    if (baseComplexity === null)
        return 'new';
    if (delta < 0)
        return 'improved';
    return headComplexity >= threshold * 2 ? 'error' : 'warning';
}
/**
 * Create a delta object from violation data
 */
function createDelta(violation, baseComplexity, headComplexity, severity) {
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
 * Calculate complexity deltas between base and head
 */
function calculateDeltas(baseReport, headReport, changedFiles) {
    const baseMap = buildComplexityMap(baseReport, changedFiles);
    const headMap = buildComplexityMap(headReport, changedFiles);
    const seenBaseKeys = new Set();
    // Process head violations
    const headDeltas = (0, collect_js_1.default)(Array.from(headMap.entries()))
        .map(([key, headData]) => {
        const baseData = baseMap.get(key);
        if (baseData)
            seenBaseKeys.add(key);
        const baseComplexity = baseData?.complexity ?? null;
        const headComplexity = headData.complexity;
        const delta = baseComplexity !== null ? headComplexity - baseComplexity : headComplexity;
        const severity = determineSeverity(baseComplexity, headComplexity, delta, headData.violation.threshold);
        return createDelta(headData.violation, baseComplexity, headComplexity, severity);
    })
        .all();
    // Process deleted functions (in base but not in head)
    const deletedDeltas = (0, collect_js_1.default)(Array.from(baseMap.entries()))
        .filter(([key]) => !seenBaseKeys.has(key))
        .map(([_, baseData]) => createDelta(baseData.violation, baseData.complexity, null, 'deleted'))
        .all();
    const deltas = [...headDeltas, ...deletedDeltas];
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
function calculateDeltaSummary(deltas) {
    const collection = (0, collect_js_1.default)(deltas);
    // Categorize each delta
    const categorized = collection.map(d => {
        if (d.severity === 'improved')
            return 'improved';
        if (d.severity === 'new')
            return 'new';
        if (d.severity === 'deleted')
            return 'deleted';
        // error/warning: check delta direction
        if (d.delta > 0)
            return 'degraded';
        if (d.delta === 0)
            return 'unchanged';
        return 'improved';
    });
    const counts = categorized.countBy().all();
    return {
        totalDelta: collection.sum('delta'),
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
function formatDelta(delta) {
    if (delta > 0)
        return `+${delta} ⬆️`;
    if (delta < 0)
        return `${delta} ⬇️`;
    return '±0';
}
/**
 * Format severity emoji
 */
function formatSeverityEmoji(severity) {
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
function logDeltaSummary(summary) {
    const sign = summary.totalDelta >= 0 ? '+' : '';
    core.info(`Complexity delta: ${sign}${summary.totalDelta}`);
    core.info(`  Degraded: ${summary.degraded}, Improved: ${summary.improved}`);
    core.info(`  New: ${summary.newFunctions}, Deleted: ${summary.deletedFunctions}`);
}
//# sourceMappingURL=delta.js.map
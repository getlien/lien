"use strict";
/**
 * Lien AI Code Review GitHub Action
 *
 * Entry point for the action. Orchestrates:
 * 1. Getting PR changed files
 * 2. Running complexity analysis (with delta from base branch)
 * 3. Generating AI review
 * 4. Posting comment to PR (line-specific or summary)
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
// Debug: Write to stderr so it always appears
process.stderr.write('🔍 [DEBUG] Action file loaded\n');
process.stderr.write(`🔍 [DEBUG] Node: ${process.version}, CWD: ${process.cwd()}\n`);
process.stderr.write('🔍 [DEBUG] Loading imports...\n');
process.stderr.write('  → @actions/core...\n');
const core = __importStar(require("@actions/core"));
process.stderr.write('  ✓ @actions/core\n');
process.stderr.write('  → fs, child_process...\n');
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
process.stderr.write('  ✓ fs, child_process\n');
process.stderr.write('  → collect.js...\n');
const collect_js_1 = __importDefault(require("collect.js"));
process.stderr.write('  ✓ collect.js\n');
process.stderr.write('  → @liendev/core...\n');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const coreModulePath = require.resolve('@liendev/core');
process.stderr.write(`    [core path: ${coreModulePath}]\n`);
const core_1 = require("@liendev/core");
process.stderr.write('  ✓ @liendev/core\n');
process.stderr.write('  → ./github.js...\n');
const github_js_1 = require("./github.js");
process.stderr.write('  ✓ ./github.js\n');
process.stderr.write('  → ./openrouter.js...\n');
const openrouter_js_1 = require("./openrouter.js");
process.stderr.write('  ✓ ./openrouter.js\n');
process.stderr.write('  → ./prompt.js...\n');
const prompt_js_1 = require("./prompt.js");
process.stderr.write('  ✓ ./prompt.js\n');
process.stderr.write('  → ./format.js...\n');
const format_js_1 = require("./format.js");
process.stderr.write('  ✓ ./format.js\n');
process.stderr.write('  → ./delta.js...\n');
const delta_js_1 = require("./delta.js");
process.stderr.write('  ✓ ./delta.js\n');
process.stderr.write('✅ [DEBUG] All imports loaded\n');
/**
 * Get action configuration from inputs
 */
function getConfig() {
    const reviewStyle = core.getInput('review_style') || 'line';
    const enableDeltaTracking = core.getInput('enable_delta_tracking') === 'true';
    return {
        openrouterApiKey: core.getInput('openrouter_api_key', { required: true }),
        model: core.getInput('model') || 'anthropic/claude-sonnet-4',
        threshold: core.getInput('threshold') || '15',
        githubToken: core.getInput('github_token') || process.env.GITHUB_TOKEN || '',
        reviewStyle: reviewStyle === 'summary' ? 'summary' : 'line',
        enableDeltaTracking,
        baselineComplexityPath: core.getInput('baseline_complexity') || '',
    };
}
/**
 * Load baseline complexity report from file
 */
function loadBaselineComplexity(path) {
    if (!path) {
        core.info('No baseline complexity path provided, skipping delta calculation');
        return null;
    }
    try {
        if (!fs.existsSync(path)) {
            core.warning(`Baseline complexity file not found: ${path}`);
            return null;
        }
        const content = fs.readFileSync(path, 'utf-8');
        const report = JSON.parse(content);
        if (!report.files || !report.summary) {
            core.warning('Baseline complexity file has invalid format');
            return null;
        }
        core.info(`Loaded baseline complexity: ${report.summary.totalViolations} violations`);
        return report;
    }
    catch (error) {
        core.warning(`Failed to load baseline complexity: ${error}`);
        return null;
    }
}
/**
 * Setup and validate PR analysis prerequisites
 */
function setupPRAnalysis() {
    const config = getConfig();
    core.info(`Using model: ${config.model}`);
    core.info(`Complexity threshold: ${config.threshold}`);
    core.info(`Review style: ${config.reviewStyle}`);
    if (!config.githubToken) {
        throw new Error('GitHub token is required');
    }
    const prContext = (0, github_js_1.getPRContext)();
    if (!prContext) {
        core.warning('Not running in PR context, skipping');
        return null;
    }
    core.info(`Reviewing PR #${prContext.pullNumber}: ${prContext.title}`);
    return { config, prContext, octokit: (0, github_js_1.createOctokit)(config.githubToken) };
}
/**
 * Filter files to only include those that can be analyzed
 * (excludes non-code files, vendor, node_modules, etc.)
 */
function filterAnalyzableFiles(files) {
    const codeExtensions = new Set([
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.py',
        '.php',
    ]);
    const excludePatterns = [
        /node_modules\//,
        /vendor\//,
        /dist\//,
        /build\//,
        /\.min\./,
        /\.bundle\./,
        /\.generated\./,
        /package-lock\.json/,
        /yarn\.lock/,
        /pnpm-lock\.yaml/,
    ];
    return files.filter((file) => {
        // Check extension
        const ext = file.slice(file.lastIndexOf('.'));
        if (!codeExtensions.has(ext)) {
            return false;
        }
        // Check exclude patterns
        for (const pattern of excludePatterns) {
            if (pattern.test(file)) {
                return false;
            }
        }
        return true;
    });
}
/**
 * Get and filter files eligible for complexity analysis
 */
async function getFilesToAnalyze(octokit, prContext) {
    const allChangedFiles = await (0, github_js_1.getPRChangedFiles)(octokit, prContext);
    core.info(`Found ${allChangedFiles.length} changed files in PR`);
    const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
    core.info(`${filesToAnalyze.length} files eligible for complexity analysis`);
    return filesToAnalyze;
}
/**
 * Run complexity analysis using @liendev/core
 */
async function runComplexityAnalysis(files, threshold) {
    if (files.length === 0) {
        core.info('No files to analyze');
        return null;
    }
    try {
        const rootDir = process.cwd();
        // Load or create config
        let config;
        try {
            config = await (0, core_1.loadConfig)(rootDir);
            core.info('Loaded lien config');
        }
        catch {
            core.info('No lien config found, using defaults');
            config = (0, core_1.createDefaultConfig)();
        }
        // Override threshold from action input
        const thresholdNum = parseInt(threshold, 10);
        config.complexity = {
            ...config.complexity,
            enabled: true,
            thresholds: {
                testPaths: thresholdNum,
                mentalLoad: thresholdNum,
                timeToUnderstandMinutes: 60,
                estimatedBugs: 1.5,
                ...config.complexity?.thresholds,
            },
        };
        // Index the codebase
        core.info('📁 Indexing codebase...');
        await (0, core_1.indexCodebase)({
            rootDir,
            config,
        });
        core.info('✓ Indexing complete');
        // Load the vector database
        const vectorDB = await core_1.VectorDB.load(rootDir);
        // Run complexity analysis
        core.info('🔍 Analyzing complexity...');
        const analyzer = new core_1.ComplexityAnalyzer(vectorDB, config);
        const report = await analyzer.analyze(files);
        core.info(`✓ Found ${report.summary.totalViolations} violations`);
        return report;
    }
    catch (error) {
        core.error(`Failed to run complexity analysis: ${error}`);
        return null;
    }
}
/**
 * Sort violations by severity and collect code snippets
 */
async function prepareViolationsForReview(report, octokit, prContext) {
    // Collect and sort violations
    const violations = Object.values(report.files)
        .flatMap((fileData) => fileData.violations)
        .sort((a, b) => {
        if (a.severity !== b.severity)
            return a.severity === 'error' ? -1 : 1;
        return b.complexity - a.complexity;
    })
        .slice(0, 10);
    // Collect code snippets
    const codeSnippets = new Map();
    for (const violation of violations) {
        const snippet = await (0, github_js_1.getFileContent)(octokit, prContext, violation.filepath, violation.startLine, violation.endLine);
        if (snippet) {
            codeSnippets.set((0, prompt_js_1.getViolationKey)(violation), snippet);
        }
    }
    core.info(`Collected ${codeSnippets.size} code snippets for review`);
    return { violations, codeSnippets };
}
/**
 * Analyze base branch complexity for delta tracking
 */
async function analyzeBaseBranch(baseSha, filesToAnalyze, threshold) {
    try {
        core.info(`Checking out base branch at ${baseSha.substring(0, 7)}...`);
        // Save current HEAD
        const currentHead = (0, child_process_1.execSync)('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
        // Checkout base branch
        (0, child_process_1.execSync)(`git checkout --force ${baseSha}`, { stdio: 'pipe' });
        core.info('✓ Base branch checked out');
        // Analyze base
        core.info('Analyzing base branch complexity...');
        const baseReport = await runComplexityAnalysis(filesToAnalyze, threshold);
        // Restore HEAD
        (0, child_process_1.execSync)(`git checkout --force ${currentHead}`, { stdio: 'pipe' });
        core.info('✓ Restored to HEAD');
        if (baseReport) {
            core.info(`Base branch: ${baseReport.summary.totalViolations} violations`);
        }
        return baseReport;
    }
    catch (error) {
        core.warning(`Failed to analyze base branch: ${error}`);
        // Attempt to restore HEAD even if analysis failed
        try {
            const currentHead = (0, child_process_1.execSync)('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
            (0, child_process_1.execSync)(`git checkout --force ${currentHead}`, { stdio: 'pipe' });
        }
        catch (restoreError) {
            core.warning(`Failed to restore HEAD: ${restoreError}`);
        }
        return null;
    }
}
/**
 * Main action logic - orchestrates the review flow
 */
async function run() {
    try {
        core.info('🚀 Starting Lien AI Code Review...');
        core.info(`Node version: ${process.version}`);
        core.info(`Working directory: ${process.cwd()}`);
        const setup = setupPRAnalysis();
        if (!setup) {
            core.info('⚠️ Setup returned null, exiting gracefully');
            return;
        }
        const { config, prContext, octokit } = setup;
        const filesToAnalyze = await getFilesToAnalyze(octokit, prContext);
        if (filesToAnalyze.length === 0) {
            core.info('No analyzable files found, skipping review');
            return;
        }
        // Get baseline complexity for delta calculation
        let baselineReport = null;
        if (config.enableDeltaTracking) {
            core.info('🔄 Delta tracking enabled - analyzing base branch...');
            baselineReport = await analyzeBaseBranch(prContext.baseSha, filesToAnalyze, config.threshold);
        }
        else if (config.baselineComplexityPath) {
            // Backwards compatibility: support old baseline_complexity input
            core.warning('baseline_complexity input is deprecated. Use enable_delta_tracking: true instead.');
            baselineReport = loadBaselineComplexity(config.baselineComplexityPath);
        }
        const report = await runComplexityAnalysis(filesToAnalyze, config.threshold);
        if (!report) {
            core.warning('Failed to get complexity report');
            return;
        }
        core.info(`Analysis complete: ${report.summary.totalViolations} violations found`);
        // Calculate deltas if we have a baseline
        const deltas = baselineReport
            ? (0, delta_js_1.calculateDeltas)(baselineReport, report, filesToAnalyze)
            : null;
        const deltaSummary = deltas ? (0, delta_js_1.calculateDeltaSummary)(deltas) : null;
        if (deltaSummary) {
            (0, delta_js_1.logDeltaSummary)(deltaSummary);
            core.setOutput('total_delta', deltaSummary.totalDelta);
            core.setOutput('improved', deltaSummary.improved);
            core.setOutput('degraded', deltaSummary.degraded);
        }
        // Always update PR description with stats badge
        const badge = (0, prompt_js_1.buildDescriptionBadge)(report, deltaSummary, deltas);
        await (0, github_js_1.updatePRDescription)(octokit, prContext, badge);
        if (report.summary.totalViolations === 0) {
            core.info('No complexity violations found');
            // Skip the regular comment - the description badge is sufficient
            return;
        }
        const { violations, codeSnippets } = await prepareViolationsForReview(report, octokit, prContext);
        (0, openrouter_js_1.resetTokenUsage)();
        if (config.reviewStyle === 'summary') {
            await postSummaryReview(octokit, prContext, report, codeSnippets, config, false, deltas);
        }
        else {
            await postLineReview(octokit, prContext, report, violations, codeSnippets, config, deltas);
        }
        core.setOutput('violations', report.summary.totalViolations);
        core.setOutput('errors', report.summary.bySeverity.error);
        core.setOutput('warnings', report.summary.bySeverity.warning);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const stack = error instanceof Error ? error.stack : '';
        core.error(`Action failed: ${message}`);
        if (stack) {
            core.error(`Stack trace:\n${stack}`);
        }
        core.setFailed(message);
    }
}
/**
 * Find the best line to comment on for a violation
 * Returns startLine if it's in diff, otherwise first diff line in function range, or null
 */
function findCommentLine(violation, diffLines) {
    const fileLines = diffLines.get(violation.filepath);
    if (!fileLines)
        return null;
    // Prefer startLine (function declaration)
    if (fileLines.has(violation.startLine)) {
        return violation.startLine;
    }
    // Find first diff line within the function range
    for (let line = violation.startLine; line <= violation.endLine; line++) {
        if (fileLines.has(line)) {
            return line;
        }
    }
    return null;
}
/**
 * Create a unique key for delta lookups
 * Includes metricType since a function can have multiple metric violations
 */
function createDeltaKey(v) {
    return `${v.filepath}::${v.symbolName}::${v.metricType}`;
}
/**
 * Build delta lookup map from deltas array
 */
function buildDeltaMap(deltas) {
    if (!deltas)
        return new Map();
    return new Map((0, collect_js_1.default)(deltas)
        .map(d => [createDeltaKey(d), d])
        .all());
}
/**
 * Build line comments from violations and AI comments
 */
function buildLineComments(violationsWithLines, aiComments, deltaMap) {
    return (0, collect_js_1.default)(violationsWithLines)
        .filter(({ violation }) => aiComments.has(violation))
        .map(({ violation, commentLine }) => {
        const comment = aiComments.get(violation);
        const delta = deltaMap.get(createDeltaKey(violation));
        const deltaStr = delta ? ` (${(0, delta_js_1.formatDelta)(delta.delta)})` : '';
        const severityEmoji = delta
            ? (0, delta_js_1.formatSeverityEmoji)(delta.severity)
            : (violation.severity === 'error' ? '🔴' : '🟡');
        // If comment is not on symbol's starting line, note where it actually starts
        const lineNote = commentLine !== violation.startLine
            ? ` *(\`${violation.symbolName}\` starts at line ${violation.startLine})*`
            : '';
        // Format human-friendly complexity display
        const metricLabel = (0, prompt_js_1.getMetricLabel)(violation.metricType || 'cyclomatic');
        const valueDisplay = (0, prompt_js_1.formatComplexityValue)(violation.metricType || 'cyclomatic', violation.complexity);
        const thresholdDisplay = (0, prompt_js_1.formatThresholdValue)(violation.metricType || 'cyclomatic', violation.threshold);
        core.info(`Adding comment for ${violation.filepath}:${commentLine} (${violation.symbolName})${deltaStr}`);
        return {
            path: violation.filepath,
            line: commentLine,
            body: `${severityEmoji} **${metricLabel.charAt(0).toUpperCase() + metricLabel.slice(1)}: ${valueDisplay}**${deltaStr} (threshold: ${thresholdDisplay})${lineNote}\n\n${comment}`,
        };
    })
        .all();
}
/**
 * Get emoji for metric type
 */
function getMetricEmoji(metricType) {
    switch (metricType) {
        case 'cyclomatic': return '🔀';
        case 'cognitive': return '🧠';
        case 'halstead_effort': return '⏱️';
        case 'halstead_bugs': return '🐛';
        default: return '📊';
    }
}
/**
 * Build uncovered violations note for summary
 */
function buildUncoveredNote(uncoveredViolations, deltaMap) {
    if (uncoveredViolations.length === 0)
        return '';
    const uncoveredList = uncoveredViolations
        .map(v => {
        const delta = deltaMap.get(createDeltaKey(v));
        const deltaStr = delta ? ` (${(0, delta_js_1.formatDelta)(delta.delta)})` : '';
        const emoji = getMetricEmoji(v.metricType);
        const metricLabel = (0, prompt_js_1.getMetricLabel)(v.metricType || 'cyclomatic');
        const valueDisplay = (0, prompt_js_1.formatComplexityValue)(v.metricType || 'cyclomatic', v.complexity);
        return `* \`${v.symbolName}\` in \`${v.filepath}\`: ${emoji} ${metricLabel} ${valueDisplay}${deltaStr}`;
    })
        .join('\n');
    return `\n\n<details>\n<summary>⚠️ ${uncoveredViolations.length} violation${uncoveredViolations.length === 1 ? '' : 's'} outside diff (no inline comment)</summary>\n\n${uncoveredList}\n\n> 💡 *These exist in files touched by this PR but the function declarations aren't in the diff. Consider the [boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html)!*\n\n</details>`;
}
/**
 * Build note for skipped pre-existing violations (no inline comment, no LLM cost)
 */
function buildSkippedNote(skippedViolations) {
    if (skippedViolations.length === 0)
        return '';
    const skippedList = skippedViolations
        .map(v => `  - \`${v.symbolName}\` in \`${v.filepath}\`: complexity ${v.complexity}`)
        .join('\n');
    return `\n\n<details>\n<summary>ℹ️ ${skippedViolations.length} pre-existing violation${skippedViolations.length === 1 ? '' : 's'} (unchanged)</summary>\n\n${skippedList}\n\n> *These violations existed before this PR and haven't changed. No inline comments added to reduce noise.*\n\n</details>`;
}
/**
 * Format token usage cost display
 */
function formatCostDisplay(usage) {
    return usage.totalTokens > 0
        ? `\n- Tokens: ${usage.totalTokens.toLocaleString()} ($${usage.cost.toFixed(4)})`
        : '';
}
/**
 * Group deltas by metric type and sum their values
 */
function groupDeltasByMetric(deltas) {
    // Note: collect.js groupBy returns groups needing sum() - types are limited
    return (0, collect_js_1.default)(deltas)
        .groupBy('metricType')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((group) => group.sum('delta'))
        .all();
}
/**
 * Build metric breakdown string with emojis
 */
function buildMetricBreakdown(deltaByMetric) {
    const metricOrder = ['cyclomatic', 'cognitive', 'halstead_effort', 'halstead_bugs'];
    return (0, collect_js_1.default)(metricOrder)
        .map(metricType => {
        const metricDelta = deltaByMetric[metricType] || 0;
        const emoji = getMetricEmoji(metricType);
        const sign = metricDelta >= 0 ? '+' : '';
        return `${emoji} ${sign}${(0, format_js_1.formatDeltaValue)(metricType, metricDelta)}`;
    })
        .all()
        .join(' | ');
}
/**
 * Format delta display with metric breakdown and summary
 */
function formatDeltaDisplay(deltas) {
    if (!deltas || deltas.length === 0)
        return '';
    const deltaSummary = (0, delta_js_1.calculateDeltaSummary)(deltas);
    const deltaByMetric = groupDeltasByMetric(deltas);
    const metricBreakdown = buildMetricBreakdown(deltaByMetric);
    const trend = deltaSummary.totalDelta > 0 ? '⬆️' : deltaSummary.totalDelta < 0 ? '⬇️' : '➡️';
    let display = `\n\n**Complexity Change:** ${metricBreakdown} ${trend}`;
    if (deltaSummary.improved > 0)
        display += ` (${deltaSummary.improved} improved)`;
    if (deltaSummary.degraded > 0)
        display += ` (${deltaSummary.degraded} degraded)`;
    return display;
}
/**
 * Build review summary body for line comments mode
 */
function buildReviewSummary(report, deltas, uncoveredNote) {
    const { summary } = report;
    const costDisplay = formatCostDisplay((0, openrouter_js_1.getTokenUsage)());
    const deltaDisplay = formatDeltaDisplay(deltas);
    return `<!-- lien-ai-review -->
## 👁️ Veille

${summary.totalViolations} issue${summary.totalViolations === 1 ? '' : 's'} spotted in this PR.${deltaDisplay}

See inline comments on the diff for specific suggestions.${uncoveredNote}

<details>
<summary>📊 Analysis Details</summary>

- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}${costDisplay}

</details>

*[Veille](https://lien.dev) by Lien*`;
}
/**
 * Post review with line-specific comments for all violations
 */
async function postLineReview(octokit, prContext, report, violations, codeSnippets, config, deltas = null) {
    const diffLines = await (0, github_js_1.getPRDiffLines)(octokit, prContext);
    core.info(`Diff covers ${diffLines.size} files`);
    // Partition violations into those we can comment on and those we can't
    const violationsWithLines = [];
    const uncoveredViolations = [];
    for (const v of violations) {
        const commentLine = findCommentLine(v, diffLines);
        if (commentLine !== null) {
            violationsWithLines.push({ violation: v, commentLine });
        }
        else {
            uncoveredViolations.push(v);
        }
    }
    core.info(`${violationsWithLines.length}/${violations.length} violations can have inline comments ` +
        `(${uncoveredViolations.length} outside diff)`);
    const deltaMap = buildDeltaMap(deltas);
    // Filter to only new or degraded violations (skip unchanged pre-existing ones)
    // This saves LLM costs and prevents duplicate comments on each push
    const newOrDegradedViolations = violationsWithLines.filter(({ violation }) => {
        const key = createDeltaKey(violation);
        const delta = deltaMap.get(key);
        // Comment if: no baseline data, or new violation, or got worse
        return !delta || delta.severity === 'new' || delta.delta > 0;
    });
    const skippedCount = violationsWithLines.length - newOrDegradedViolations.length;
    if (skippedCount > 0) {
        core.info(`Skipping ${skippedCount} unchanged pre-existing violations (no LLM calls needed)`);
    }
    if (newOrDegradedViolations.length === 0) {
        core.info('No new or degraded violations to comment on');
        // Still post a summary if there are violations, just no inline comments needed
        if (violationsWithLines.length > 0) {
            // Only include actual uncovered violations (outside diff)
            const uncoveredNote = buildUncoveredNote(uncoveredViolations, deltaMap);
            // Build skipped note for unchanged violations in the diff (not "outside diff")
            const skippedInDiff = violationsWithLines
                .filter(({ violation }) => {
                const key = createDeltaKey(violation);
                const delta = deltaMap.get(key);
                return delta && delta.severity !== 'new' && delta.delta === 0;
            })
                .map(v => v.violation);
            const skippedNote = buildSkippedNote(skippedInDiff);
            const summaryBody = buildReviewSummary(report, deltas, uncoveredNote + skippedNote);
            await (0, github_js_1.postPRComment)(octokit, prContext, summaryBody);
        }
        return;
    }
    // Generate AI comments only for new/degraded violations
    const commentableViolations = newOrDegradedViolations.map(v => v.violation);
    core.info(`Generating AI comments for ${commentableViolations.length} new/degraded violations...`);
    const aiComments = await (0, openrouter_js_1.generateLineComments)(commentableViolations, codeSnippets, config.openrouterApiKey, config.model);
    // Build and post review (only for new/degraded)
    const lineComments = buildLineComments(newOrDegradedViolations, aiComments, deltaMap);
    core.info(`Built ${lineComments.length} line comments for new/degraded violations`);
    // Include skipped (pre-existing unchanged) violations in skipped note
    // Note: delta === 0 means truly unchanged; delta < 0 means improved (not "unchanged")
    const skippedViolations = violationsWithLines
        .filter(({ violation }) => {
        const key = createDeltaKey(violation);
        const delta = deltaMap.get(key);
        return delta && delta.severity !== 'new' && delta.delta === 0;
    })
        .map(v => v.violation);
    const uncoveredNote = buildUncoveredNote(uncoveredViolations, deltaMap);
    const skippedNote = buildSkippedNote(skippedViolations);
    const summaryBody = buildReviewSummary(report, deltas, uncoveredNote + skippedNote);
    await (0, github_js_1.postPRReview)(octokit, prContext, lineComments, summaryBody);
    core.info(`Posted review with ${lineComments.length} line comments`);
}
/**
 * Post review as a single summary comment
 * @param isFallback - true if this is a fallback because violations aren't on diff lines
 * @param deltas - complexity deltas for delta display
 */
async function postSummaryReview(octokit, prContext, report, codeSnippets, config, isFallback = false, deltas = null) {
    const prompt = (0, prompt_js_1.buildReviewPrompt)(report, prContext, codeSnippets, deltas);
    core.debug(`Prompt length: ${prompt.length} characters`);
    const aiReview = await (0, openrouter_js_1.generateReview)(prompt, config.openrouterApiKey, config.model);
    const usage = (0, openrouter_js_1.getTokenUsage)();
    const comment = (0, prompt_js_1.formatReviewComment)(aiReview, report, isFallback, usage, deltas);
    await (0, github_js_1.postPRComment)(octokit, prContext, comment);
    core.info('Successfully posted AI review summary comment');
}
// Run the action
process.stderr.write('🎬 [DEBUG] Calling run()...\n');
run().catch((error) => {
    process.stderr.write(`❌ [DEBUG] Uncaught error: ${error}\n`);
    if (error instanceof Error && error.stack) {
        process.stderr.write(`Stack: ${error.stack}\n`);
    }
    core.setFailed(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
//# sourceMappingURL=index.js.map
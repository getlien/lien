/**
 * Review engine — orchestrates complexity analysis, delta tracking, and review posting.
 * Extracted from packages/action/src/index.ts for reuse across Action and App.
 */

import * as fs from 'fs';
import { execSync } from 'child_process';
import collect from 'collect.js';
import {
  indexCodebase,
  createVectorDB,
  ComplexityAnalyzer,
  RISK_ORDER,
  type ComplexityReport,
  type ComplexityViolation,
} from '@liendev/core';

import type { Octokit } from '@octokit/rest';
import type { PRContext, ReviewConfig, LineComment } from './types.js';
import type { Logger } from './logger.js';
import {
  getPRChangedFiles,
  getFileContent,
  postPRComment,
  postPRReview,
  getPRDiffLines,
  updatePRDescription,
} from './github-api.js';
import { generateReview, generateLineComments, resetTokenUsage, getTokenUsage } from './openrouter.js';
import {
  buildReviewPrompt,
  buildNoViolationsMessage,
  formatReviewComment,
  getViolationKey,
  buildDescriptionBadge,
  buildHeaderLine,
  getMetricLabel,
  formatComplexityValue,
  formatThresholdValue,
} from './prompt.js';
import { formatDeltaValue } from './format.js';
import {
  calculateDeltas,
  calculateDeltaSummary,
  formatDelta,
  formatSeverityEmoji,
  logDeltaSummary,
  type ComplexityDelta,
  type DeltaSummary,
} from './delta.js';

/**
 * Result of analysis orchestration
 */
export interface AnalysisResult {
  currentReport: ComplexityReport;
  baselineReport: ComplexityReport | null;
  deltas: ComplexityDelta[] | null;
  filesToAnalyze: string[];
}

/**
 * Setup result for orchestration
 */
export interface ReviewSetup {
  config: ReviewConfig;
  prContext: PRContext;
  octokit: Octokit;
  logger: Logger;
  rootDir: string;
}

/**
 * Filter files to only include those that can be analyzed
 * (excludes non-code files, vendor, node_modules, etc.)
 */
export function filterAnalyzableFiles(files: string[]): string[] {
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
async function getFilesToAnalyze(octokit: Octokit, prContext: PRContext, logger: Logger): Promise<string[]> {
  const allChangedFiles = await getPRChangedFiles(octokit, prContext);
  logger.info(`Found ${allChangedFiles.length} changed files in PR`);

  const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
  logger.info(`${filesToAnalyze.length} files eligible for complexity analysis`);

  return filesToAnalyze;
}

/**
 * Run complexity analysis using @liendev/core
 */
export async function runComplexityAnalysis(
  files: string[],
  threshold: string,
  rootDir: string,
  logger: Logger
): Promise<ComplexityReport | null> {
  if (files.length === 0) {
    logger.info('No files to analyze');
    return null;
  }

  try {
    // Index the codebase (no config needed - uses defaults)
    logger.info('Indexing codebase...');
    const indexResult = await indexCodebase({
      rootDir,
    });
    logger.info(`Indexing complete: ${indexResult.chunksCreated} chunks from ${indexResult.filesIndexed} files (success: ${indexResult.success})`);
    if (!indexResult.success || indexResult.chunksCreated === 0) {
      logger.warning(`Indexing produced no chunks for ${rootDir}`);
      return null;
    }

    // Load the vector database (uses global config or defaults to LanceDB)
    const vectorDB = await createVectorDB(rootDir);
    await vectorDB.initialize();

    // Run complexity analysis (uses default thresholds)
    logger.info('Analyzing complexity...');
    const analyzer = new ComplexityAnalyzer(vectorDB);
    const report = await analyzer.analyze(files);
    logger.info(`Found ${report.summary.totalViolations} violations`);

    return report;
  } catch (error) {
    logger.error(`Failed to run complexity analysis: ${error}`);
    return null;
  }
}

/**
 * Prioritize violations by impact (dependents + severity)
 * High dependents + High severity = Highest priority
 */
function prioritizeViolations(
  violations: ComplexityViolation[],
  report: ComplexityReport
): ComplexityViolation[] {
  return violations.sort((a, b) => {
    const fileA = report.files[a.filepath];
    const fileB = report.files[b.filepath];

    // Priority: High dependents + High severity = Highest priority
    const impactA = (fileA?.dependentCount || 0) * 10 + RISK_ORDER[fileA?.riskLevel || 'low'];
    const impactB = (fileB?.dependentCount || 0) * 10 + RISK_ORDER[fileB?.riskLevel || 'low'];

    if (impactB !== impactA) return impactB - impactA;

    // Fallback: severity
    const severityOrder = { error: 2, warning: 1 };
    return severityOrder[b.severity] - severityOrder[a.severity];
  });
}

/**
 * Sort violations by severity and collect code snippets
 */
async function prepareViolationsForReview(
  report: ComplexityReport,
  octokit: Octokit,
  prContext: PRContext,
  logger: Logger
): Promise<{ violations: ComplexityViolation[]; codeSnippets: Map<string, string> }> {
  // Collect violations
  const allViolations = Object.values(report.files)
    .flatMap((fileData) => fileData.violations);

  // Prioritize by impact (dependents + severity)
  const violations = prioritizeViolations(allViolations, report)
    .slice(0, 10);

  // Collect code snippets
  const codeSnippets = new Map<string, string>();
  for (const violation of violations) {
    const snippet = await getFileContent(
      octokit,
      prContext,
      violation.filepath,
      violation.startLine,
      violation.endLine,
      logger
    );
    if (snippet) {
      codeSnippets.set(getViolationKey(violation), snippet);
    }
  }
  logger.info(`Collected ${codeSnippets.size} code snippets for review`);

  return { violations, codeSnippets };
}

/**
 * Load baseline complexity report from file
 */
function loadBaselineComplexity(path: string, logger: Logger): ComplexityReport | null {
  if (!path) {
    logger.info('No baseline complexity path provided, skipping delta calculation');
    return null;
  }

  try {
    if (!fs.existsSync(path)) {
      logger.warning(`Baseline complexity file not found: ${path}`);
      return null;
    }

    const content = fs.readFileSync(path, 'utf-8');
    const report = JSON.parse(content) as ComplexityReport;

    if (!report.files || !report.summary) {
      logger.warning('Baseline complexity file has invalid format');
      return null;
    }

    logger.info(`Loaded baseline complexity: ${report.summary.totalViolations} violations`);
    return report;
  } catch (error) {
    logger.warning(`Failed to load baseline complexity: ${error}`);
    return null;
  }
}

/**
 * Analyze base branch complexity for delta tracking.
 * Uses git checkout — only suitable for the Action context where the repo is isolated.
 * The App clones base separately via clone.ts instead.
 */
async function analyzeBaseBranch(
  baseSha: string,
  filesToAnalyze: string[],
  threshold: string,
  rootDir: string,
  logger: Logger
): Promise<ComplexityReport | null> {
  try {
    logger.info(`Checking out base branch at ${baseSha.substring(0, 7)}...`);

    // Save current HEAD
    const currentHead = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();

    // Checkout base branch
    execSync(`git checkout --force ${baseSha}`, { stdio: 'pipe' });
    logger.info('Base branch checked out');

    // Analyze base
    logger.info('Analyzing base branch complexity...');
    const baseReport = await runComplexityAnalysis(filesToAnalyze, threshold, rootDir, logger);

    // Restore HEAD
    execSync(`git checkout --force ${currentHead}`, { stdio: 'pipe' });
    logger.info('Restored to HEAD');

    if (baseReport) {
      logger.info(`Base branch: ${baseReport.summary.totalViolations} violations`);
    }

    return baseReport;
  } catch (error) {
    logger.warning(`Failed to analyze base branch: ${error}`);
    // Attempt to restore HEAD even if analysis failed
    try {
      const currentHead = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
      execSync(`git checkout --force ${currentHead}`, { stdio: 'pipe' });
    } catch (restoreError) {
      logger.warning(`Failed to restore HEAD: ${restoreError}`);
    }
    return null;
  }
}

/**
 * Get baseline complexity report for delta calculation
 * Handles both delta tracking (analyzes base branch) and legacy baseline file
 */
async function getBaselineReport(
  config: ReviewConfig,
  prContext: PRContext,
  filesToAnalyze: string[],
  rootDir: string,
  logger: Logger
): Promise<ComplexityReport | null> {
  if (config.enableDeltaTracking) {
    logger.info('Delta tracking enabled - analyzing base branch...');
    return await analyzeBaseBranch(prContext.baseSha, filesToAnalyze, config.threshold, rootDir, logger);
  }

  if (config.baselineComplexityPath) {
    // Backwards compatibility: support old baseline_complexity input
    logger.warning('baseline_complexity input is deprecated. Use enable_delta_tracking: true instead.');
    return loadBaselineComplexity(config.baselineComplexityPath, logger);
  }

  return null;
}

/**
 * Orchestrate complexity analysis (file discovery, baseline, current analysis)
 * Returns null if no files to analyze or analysis fails
 */
export async function orchestrateAnalysis(setup: ReviewSetup): Promise<AnalysisResult | null> {
  const { config, prContext, octokit, logger, rootDir } = setup;

  const filesToAnalyze = await getFilesToAnalyze(octokit, prContext, logger);
  if (filesToAnalyze.length === 0) {
    logger.info('No analyzable files found, skipping review');
    return null;
  }

  const baselineReport = await getBaselineReport(config, prContext, filesToAnalyze, rootDir, logger);
  const currentReport = await runComplexityAnalysis(filesToAnalyze, config.threshold, rootDir, logger);

  if (!currentReport) {
    logger.warning('Failed to get complexity report');
    return null;
  }

  logger.info(`Analysis complete: ${currentReport.summary.totalViolations} violations found`);

  const deltas = baselineReport
    ? calculateDeltas(baselineReport, currentReport, filesToAnalyze)
    : null;

  return {
    currentReport,
    baselineReport,
    deltas,
    filesToAnalyze,
  };
}

/**
 * Handle analysis outputs (badge, logging)
 * Updates PR description badge
 */
export async function handleAnalysisOutputs(
  result: AnalysisResult,
  setup: ReviewSetup
): Promise<DeltaSummary | null> {
  const { octokit, prContext, logger } = setup;
  const deltaSummary = result.deltas ? calculateDeltaSummary(result.deltas) : null;

  if (deltaSummary) {
    logDeltaSummary(deltaSummary, logger);
  }

  const badge = buildDescriptionBadge(result.currentReport, deltaSummary, result.deltas);
  await updatePRDescription(octokit, prContext, badge, logger);

  return deltaSummary;
}

// ─── Helper functions for review posting ────────────────────────────────────

/**
 * Find the best line to comment on for a violation
 * Returns startLine if it's in diff, otherwise first diff line in function range, or null
 */
function findCommentLine(
  violation: ComplexityViolation,
  diffLines: Map<string, Set<number>>
): number | null {
  const fileLines = diffLines.get(violation.filepath);
  if (!fileLines) return null;

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
 */
function createDeltaKey(v: { filepath: string; symbolName: string; metricType: string }): string {
  return `${v.filepath}::${v.symbolName}::${v.metricType}`;
}

/**
 * Build delta lookup map from deltas array
 */
function buildDeltaMap(deltas: ComplexityDelta[] | null): Map<string, ComplexityDelta> {
  if (!deltas) return new Map();

  return new Map(
    collect(deltas)
      .map(d => [createDeltaKey(d), d] as [string, ComplexityDelta])
      .all()
  );
}

/**
 * Get emoji for metric type
 */
function getMetricEmoji(metricType: string): string {
  switch (metricType) {
    case 'cyclomatic': return '🔀';
    case 'cognitive': return '🧠';
    case 'halstead_effort': return '⏱️';
    case 'halstead_bugs': return '🐛';
    default: return '📊';
  }
}

/**
 * Format a single uncovered violation line
 */
function formatUncoveredLine(v: ComplexityViolation, deltaMap: Map<string, ComplexityDelta>): string {
  const delta = deltaMap.get(createDeltaKey(v));
  const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : '';
  const emoji = getMetricEmoji(v.metricType);
  const metricLabel = getMetricLabel(v.metricType || 'cyclomatic');
  const valueDisplay = formatComplexityValue(v.metricType || 'cyclomatic', v.complexity);
  return `* \`${v.symbolName}\` in \`${v.filepath}\`: ${emoji} ${metricLabel} ${valueDisplay}${deltaStr}`;
}

const BOY_SCOUT_LINK = '[boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html)';

/**
 * Categorize uncovered violations into new/worsened vs pre-existing
 */
function categorizeUncoveredViolations(
  violations: ComplexityViolation[],
  deltaMap: Map<string, ComplexityDelta>
): { newOrWorsened: ComplexityViolation[]; preExisting: ComplexityViolation[] } {
  const newOrWorsened = violations.filter(v => {
    const delta = deltaMap.get(createDeltaKey(v));
    return delta && (delta.severity === 'new' || delta.delta > 0);
  });

  const preExisting = violations.filter(v => {
    const delta = deltaMap.get(createDeltaKey(v));
    return !delta || delta.delta === 0;
  });

  return { newOrWorsened, preExisting };
}

/**
 * Format new/worsened violations section (shown prominently)
 */
function buildNewWorsenedSection(violations: ComplexityViolation[], deltaMap: Map<string, ComplexityDelta>): string {
  if (violations.length === 0) return '';
  const list = violations.map(v => formatUncoveredLine(v, deltaMap)).join('\n');
  return `\n\n⚠️ **${violations.length} new/worsened violation${violations.length === 1 ? '' : 's'} outside diff:**\n\n${list}`;
}

/**
 * Format pre-existing violations section (collapsed)
 */
function buildPreExistingSection(violations: ComplexityViolation[], deltaMap: Map<string, ComplexityDelta>): string {
  if (violations.length === 0) return '';
  const list = violations.map(v => formatUncoveredLine(v, deltaMap)).join('\n');
  return `\n\n<details>\n<summary>ℹ️ ${violations.length} pre-existing violation${violations.length === 1 ? '' : 's'} outside diff</summary>\n\n${list}\n\n> *These violations existed before this PR. No action required, but consider the ${BOY_SCOUT_LINK}!*\n\n</details>`;
}

/**
 * Format fallback section when no delta data is available (legacy)
 */
function buildFallbackUncoveredSection(violations: ComplexityViolation[], deltaMap: Map<string, ComplexityDelta>): string {
  const list = violations.map(v => formatUncoveredLine(v, deltaMap)).join('\n');
  return `\n\n<details>\n<summary>⚠️ ${violations.length} violation${violations.length === 1 ? '' : 's'} outside diff (no inline comment)</summary>\n\n${list}\n\n> 💡 *These exist in files touched by this PR but the function declarations aren't in the diff. Consider the ${BOY_SCOUT_LINK}!*\n\n</details>`;
}

/**
 * Build uncovered violations note for summary
 * Splits into new/worsened (shown prominently) vs pre-existing (collapsed)
 */
function buildUncoveredNote(
  uncoveredViolations: ComplexityViolation[],
  deltaMap: Map<string, ComplexityDelta>
): string {
  if (uncoveredViolations.length === 0) return '';

  const { newOrWorsened, preExisting } = categorizeUncoveredViolations(uncoveredViolations, deltaMap);

  // Fallback: if no delta data, show all in collapsed section (legacy behavior)
  if (newOrWorsened.length === 0 && preExisting.length === 0) {
    return buildFallbackUncoveredSection(uncoveredViolations, deltaMap);
  }

  return buildNewWorsenedSection(newOrWorsened, deltaMap)
    + buildPreExistingSection(preExisting, deltaMap);
}

/**
 * Build note for skipped pre-existing violations (no inline comment, no LLM cost)
 */
function buildSkippedNote(skippedViolations: ComplexityViolation[]): string {
  if (skippedViolations.length === 0) return '';

  const skippedList = skippedViolations
    .map(v => `  - \`${v.symbolName}\` in \`${v.filepath}\`: complexity ${v.complexity}`)
    .join('\n');

  return `\n\n<details>\n<summary>ℹ️ ${skippedViolations.length} pre-existing violation${skippedViolations.length === 1 ? '' : 's'} (unchanged)</summary>\n\n${skippedList}\n\n> *These violations existed before this PR and haven't changed. No inline comments added to reduce noise.*\n\n</details>`;
}

/**
 * Format token usage cost display
 */
function formatCostDisplay(usage: { totalTokens: number; cost: number }): string {
  return usage.totalTokens > 0
    ? `\n- Tokens: ${usage.totalTokens.toLocaleString()} ($${usage.cost.toFixed(4)})`
    : '';
}

/**
 * Group deltas by metric type and sum their values
 */
function groupDeltasByMetric(deltas: ComplexityDelta[]): Record<string, number> {
  return collect(deltas)
    .groupBy('metricType')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((group: any) => group.sum('delta'))
    .all() as unknown as Record<string, number>;
}

/**
 * Build metric breakdown string with emojis
 */
function buildMetricBreakdown(deltaByMetric: Record<string, number>): string {
  const metricOrder = ['cyclomatic', 'cognitive', 'halstead_effort', 'halstead_bugs'];
  return collect(metricOrder)
    .map(metricType => {
      const metricDelta = deltaByMetric[metricType] || 0;
      const emoji = getMetricEmoji(metricType);
      const sign = metricDelta >= 0 ? '+' : '';
      return `${emoji} ${sign}${formatDeltaValue(metricType, metricDelta)}`;
    })
    .all()
    .join(' | ');
}

/**
 * Format delta display with metric breakdown and summary
 */
function formatDeltaDisplay(deltas: ComplexityDelta[] | null): string {
  if (!deltas || deltas.length === 0) return '';

  const deltaSummary = calculateDeltaSummary(deltas);
  const deltaByMetric = groupDeltasByMetric(deltas);

  if (deltaSummary.totalDelta === 0 && deltaSummary.improved === 0 && deltaSummary.newFunctions === 0) {
    return '\n\n**Complexity:** No change from this PR.';
  }

  const metricBreakdown = buildMetricBreakdown(deltaByMetric);
  const trend = deltaSummary.totalDelta > 0 ? '⬆️' : deltaSummary.totalDelta < 0 ? '⬇️' : '➡️';

  let display = `\n\n**Complexity Change:** ${metricBreakdown} ${trend}`;
  if (deltaSummary.improved > 0) display += ` (${deltaSummary.improved} improved)`;
  if (deltaSummary.degraded > 0) display += ` (${deltaSummary.degraded} degraded)`;
  return display;
}

/**
 * Build review summary body for line comments mode
 */
function buildReviewSummary(
  report: ComplexityReport,
  deltas: ComplexityDelta[] | null,
  uncoveredNote: string
): string {
  const { summary } = report;
  const costDisplay = formatCostDisplay(getTokenUsage());
  const deltaDisplay = formatDeltaDisplay(deltas);
  const headerLine = buildHeaderLine(summary.totalViolations, deltas);

  return `<!-- lien-ai-review -->
## 👁️ Veille

${headerLine}${deltaDisplay}

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
 * Build line comments from violations and AI comments
 */
function buildLineComments(
  violationsWithLines: Array<{ violation: ComplexityViolation; commentLine: number }>,
  aiComments: Map<ComplexityViolation, string>,
  deltaMap: Map<string, ComplexityDelta>,
  logger: Logger
): LineComment[] {
  return collect(violationsWithLines)
    .filter(({ violation }) => aiComments.has(violation))
    .map(({ violation, commentLine }) => {
      const comment = aiComments.get(violation)!;
      const delta = deltaMap.get(createDeltaKey(violation));
      const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : '';
      const severityEmoji = delta
        ? formatSeverityEmoji(delta.severity)
        : (violation.severity === 'error' ? '🔴' : '🟡');

      // If comment is not on symbol's starting line, note where it actually starts
      const lineNote = commentLine !== violation.startLine
        ? ` *(\`${violation.symbolName}\` starts at line ${violation.startLine})*`
        : '';

      // Format human-friendly complexity display
      const metricLabel = getMetricLabel(violation.metricType || 'cyclomatic');
      const valueDisplay = formatComplexityValue(violation.metricType || 'cyclomatic', violation.complexity);
      const thresholdDisplay = formatThresholdValue(violation.metricType || 'cyclomatic', violation.threshold);

      logger.info(`Adding comment for ${violation.filepath}:${commentLine} (${violation.symbolName})${deltaStr}`);

      return {
        path: violation.filepath,
        line: commentLine,
        body: `${severityEmoji} **${metricLabel.charAt(0).toUpperCase() + metricLabel.slice(1)}: ${valueDisplay}**${deltaStr} (threshold: ${thresholdDisplay})${lineNote}\n\n${comment}`,
      };
    })
    .all() as LineComment[];
}

/**
 * Partition violations into those with comment lines and those without
 */
function partitionViolationsByDiff(
  violations: ComplexityViolation[],
  diffLines: Map<string, Set<number>>
): {
  withLines: Array<{ violation: ComplexityViolation; commentLine: number }>;
  uncovered: ComplexityViolation[];
} {
  const withLines: Array<{ violation: ComplexityViolation; commentLine: number }> = [];
  const uncovered: ComplexityViolation[] = [];

  for (const v of violations) {
    const commentLine = findCommentLine(v, diffLines);
    if (commentLine !== null) {
      withLines.push({ violation: v, commentLine });
    } else {
      uncovered.push(v);
    }
  }

  return { withLines, uncovered };
}

/**
 * Filter violations to only new or degraded ones (skip unchanged pre-existing)
 */
function filterNewOrDegraded(
  violationsWithLines: Array<{ violation: ComplexityViolation; commentLine: number }>,
  deltaMap: Map<string, ComplexityDelta>
): Array<{ violation: ComplexityViolation; commentLine: number }> {
  return violationsWithLines.filter(({ violation }) => {
    const key = createDeltaKey(violation);
    const delta = deltaMap.get(key);
    // Comment if: no baseline data, or new violation, or got worse
    return !delta || delta.severity === 'new' || delta.delta > 0;
  });
}

/**
 * Get list of skipped (unchanged) violations
 */
function getSkippedViolations(
  violationsWithLines: Array<{ violation: ComplexityViolation; commentLine: number }>,
  deltaMap: Map<string, ComplexityDelta>
): ComplexityViolation[] {
  return violationsWithLines
    .filter(({ violation }) => {
      const key = createDeltaKey(violation);
      const delta = deltaMap.get(key);
      return delta && delta.severity !== 'new' && delta.delta === 0;
    })
    .map(v => v.violation);
}

/**
 * Violation processing result
 */
interface ViolationProcessingResult {
  withLines: Array<{ violation: ComplexityViolation; commentLine: number }>;
  uncovered: ComplexityViolation[];
  newOrDegraded: Array<{ violation: ComplexityViolation; commentLine: number }>;
  skipped: ComplexityViolation[];
}

/**
 * Process violations for review (partition, filter, categorize)
 */
function processViolationsForReview(
  violations: ComplexityViolation[],
  diffLines: Map<string, Set<number>>,
  deltaMap: Map<string, ComplexityDelta>
): ViolationProcessingResult {
  const { withLines, uncovered } = partitionViolationsByDiff(violations, diffLines);
  const newOrDegraded = filterNewOrDegraded(withLines, deltaMap);
  const skipped = getSkippedViolations(withLines, deltaMap);

  return { withLines, uncovered, newOrDegraded, skipped };
}

/**
 * Handle case when there are no new/degraded violations to comment on
 */
async function handleNoNewViolations(
  octokit: Octokit,
  prContext: PRContext,
  violationsWithLines: Array<{ violation: ComplexityViolation; commentLine: number }>,
  uncoveredViolations: ComplexityViolation[],
  deltaMap: Map<string, ComplexityDelta>,
  report: ComplexityReport,
  deltas: ComplexityDelta[] | null,
  logger: Logger
): Promise<void> {
  if (violationsWithLines.length === 0) {
    return;
  }

  const skippedInDiff = getSkippedViolations(violationsWithLines, deltaMap);
  const uncoveredNote = buildUncoveredNote(uncoveredViolations, deltaMap);
  const skippedNote = buildSkippedNote(skippedInDiff);
  const summaryBody = buildReviewSummary(report, deltas, uncoveredNote + skippedNote);
  await postPRComment(octokit, prContext, summaryBody, logger);
}

/**
 * Generate AI comments and post review
 */
async function generateAndPostReview(
  octokit: Octokit,
  prContext: PRContext,
  processed: ViolationProcessingResult,
  deltaMap: Map<string, ComplexityDelta>,
  codeSnippets: Map<string, string>,
  config: ReviewConfig,
  report: ComplexityReport,
  deltas: ComplexityDelta[] | null,
  logger: Logger
): Promise<void> {
  const commentableViolations = processed.newOrDegraded.map(v => v.violation);
  logger.info(`Generating AI comments for ${commentableViolations.length} new/degraded violations...`);

  const aiComments = await generateLineComments(
    commentableViolations,
    codeSnippets,
    config.openrouterApiKey,
    config.model,
    report,
    logger
  );

  const lineComments = buildLineComments(processed.newOrDegraded, aiComments, deltaMap, logger);
  logger.info(`Built ${lineComments.length} line comments for new/degraded violations`);

  const uncoveredNote = buildUncoveredNote(processed.uncovered, deltaMap);
  const skippedNote = buildSkippedNote(processed.skipped);
  const summaryBody = buildReviewSummary(report, deltas, uncoveredNote + skippedNote);

  await postPRReview(octokit, prContext, lineComments, summaryBody, logger);
  logger.info(`Posted review with ${lineComments.length} line comments`);
}

/**
 * Post review with line-specific comments for all violations
 */
async function postLineReview(
  octokit: Octokit,
  prContext: PRContext,
  report: ComplexityReport,
  violations: ComplexityViolation[],
  codeSnippets: Map<string, string>,
  config: ReviewConfig,
  logger: Logger,
  deltas: ComplexityDelta[] | null = null
): Promise<void> {
  const diffLines = await getPRDiffLines(octokit, prContext);
  logger.info(`Diff covers ${diffLines.size} files`);

  const deltaMap = buildDeltaMap(deltas);
  const processed = processViolationsForReview(violations, diffLines, deltaMap);

  logger.info(
    `${processed.withLines.length}/${violations.length} violations can have inline comments ` +
    `(${processed.uncovered.length} outside diff)`
  );

  const skippedCount = processed.withLines.length - processed.newOrDegraded.length;
  if (skippedCount > 0) {
    logger.info(`Skipping ${skippedCount} unchanged pre-existing violations (no LLM calls needed)`);
  }

  if (processed.newOrDegraded.length === 0) {
    logger.info('No new or degraded violations to comment on');
    await handleNoNewViolations(
      octokit,
      prContext,
      processed.withLines,
      processed.uncovered,
      deltaMap,
      report,
      deltas,
      logger
    );
    return;
  }

  await generateAndPostReview(
    octokit,
    prContext,
    processed,
    deltaMap,
    codeSnippets,
    config,
    report,
    deltas,
    logger
  );
}

/**
 * Post review as a single summary comment
 */
async function postSummaryReview(
  octokit: Octokit,
  prContext: PRContext,
  report: ComplexityReport,
  codeSnippets: Map<string, string>,
  config: ReviewConfig,
  logger: Logger,
  isFallback = false,
  deltas: ComplexityDelta[] | null = null,
  uncoveredNote: string = ''
): Promise<void> {
  const prompt = buildReviewPrompt(report, prContext, codeSnippets, deltas);
  logger.debug(`Prompt length: ${prompt.length} characters`);

  const aiReview = await generateReview(
    prompt,
    config.openrouterApiKey,
    config.model,
    logger
  );

  const usage = getTokenUsage();
  const comment = formatReviewComment(aiReview, report, isFallback, usage, deltas, uncoveredNote);
  await postPRComment(octokit, prContext, comment, logger);
  logger.info('Successfully posted AI review summary comment');
}

/**
 * Post review if violations are found, or success message if none
 * Handles both summary and line-by-line review modes
 */
export async function postReviewIfNeeded(
  result: AnalysisResult,
  setup: ReviewSetup
): Promise<void> {
  const { config, prContext, octokit, logger } = setup;

  if (result.currentReport.summary.totalViolations === 0) {
    logger.info('No complexity violations found');
    // Post success message (will update existing comment if present)
    const successMessage = buildNoViolationsMessage(prContext, result.deltas);
    await postPRComment(octokit, prContext, successMessage, logger);
    return;
  }

  const { violations, codeSnippets } = await prepareViolationsForReview(
    result.currentReport,
    octokit,
    prContext,
    logger
  );

  resetTokenUsage();
  if (config.reviewStyle === 'summary') {
    // Get diff lines to identify uncovered violations
    const diffLines = await getPRDiffLines(octokit, prContext);
    const deltaMap = buildDeltaMap(result.deltas);
    const { uncovered } = partitionViolationsByDiff(violations, diffLines);
    const uncoveredNote = buildUncoveredNote(uncovered, deltaMap);

    await postSummaryReview(
      octokit,
      prContext,
      result.currentReport,
      codeSnippets,
      config,
      logger,
      false,
      result.deltas,
      uncoveredNote
    );
  } else {
    await postLineReview(
      octokit,
      prContext,
      result.currentReport,
      violations,
      codeSnippets,
      config,
      logger,
      result.deltas
    );
  }
}

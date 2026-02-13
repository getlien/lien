/**
 * Review engine — orchestrates complexity analysis, delta tracking, and review posting.
 * Extracted from packages/action/src/index.ts for reuse across Action and App.
 */

import * as fs from 'fs';
import { execFileSync } from 'child_process';
import collect from 'collect.js';
import {
  indexCodebase,
  ComplexityAnalyzer,
  RISK_ORDER,
  type ComplexityReport,
  type ComplexityViolation,
  type CodeChunk,
} from '@liendev/core';

import type { Octokit } from '@octokit/rest';
import type { PRContext, ReviewConfig, LineComment } from './types.js';
import type { Logger } from './logger.js';
import {
  getPRChangedFiles,
  getFileContent,
  postPRComment,
  postPRReview,
  getPRPatchData,
  updatePRDescription,
} from './github-api.js';
import {
  generateLineComments,
  generateLogicComments,
  resetTokenUsage,
  getTokenUsage,
} from './openrouter.js';
import { detectLogicFindings } from './logic-review.js';
import { isFindingSuppressed } from './suppression.js';
import {
  buildNoViolationsMessage,
  getViolationKey,
  buildDescriptionBadge,
  buildHeaderLine,
  getMetricLabel,
  formatComplexityValue,
  formatThresholdValue,
} from './prompt.js';
import { formatDeltaValue } from './format.js';
import { assertValidSha } from './git-utils.js';
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
  chunks: CodeChunk[];
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
  const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.php']);

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

  return files.filter(file => {
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
async function getFilesToAnalyze(
  octokit: Octokit,
  prContext: PRContext,
  logger: Logger,
): Promise<string[]> {
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
  logger: Logger,
): Promise<{ report: ComplexityReport; chunks: CodeChunk[] } | null> {
  if (files.length === 0) {
    logger.info('No files to analyze');
    return null;
  }

  try {
    // Use skipEmbeddings for fast chunk-only indexing (no VectorDB needed)
    // Pass filesToIndex to skip full repo scan — only chunk the changed files
    logger.info(`Indexing ${files.length} files (chunk-only)...`);
    const indexResult = await indexCodebase({ rootDir, skipEmbeddings: true, filesToIndex: files });

    logger.info(
      `Indexing complete: ${indexResult.chunksCreated} chunks from ${indexResult.filesIndexed} files (success: ${indexResult.success})`,
    );
    if (!indexResult.success || !indexResult.chunks || indexResult.chunks.length === 0) {
      logger.warning(`Indexing produced no chunks for ${rootDir}`);
      return null;
    }

    // Run complexity analysis from in-memory chunks (no VectorDB needed)
    logger.info('Analyzing complexity...');
    const report = ComplexityAnalyzer.analyzeFromChunks(indexResult.chunks, files);
    logger.info(`Found ${report.summary.totalViolations} violations`);

    return { report, chunks: indexResult.chunks };
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
  report: ComplexityReport,
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
  logger: Logger,
): Promise<{ violations: ComplexityViolation[]; codeSnippets: Map<string, string> }> {
  // Collect violations
  const allViolations = Object.values(report.files).flatMap(fileData => fileData.violations);

  // Prioritize by impact (dependents + severity)
  const violations = prioritizeViolations(allViolations, report).slice(0, 10);

  // Collect code snippets
  const codeSnippets = new Map<string, string>();
  for (const violation of violations) {
    const snippet = await getFileContent(
      octokit,
      prContext,
      violation.filepath,
      violation.startLine,
      violation.endLine,
      logger,
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
  logger: Logger,
): Promise<ComplexityReport | null> {
  // Capture original HEAD before any checkout so we can always restore it
  const originalHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();

  try {
    logger.info(`Checking out base branch at ${baseSha.substring(0, 7)}...`);

    // Checkout base branch
    assertValidSha(baseSha, 'baseSha');
    execFileSync('git', ['checkout', '--force', baseSha], { stdio: 'pipe' });
    logger.info('Base branch checked out');

    // Analyze base
    logger.info('Analyzing base branch complexity...');
    const baseResult = await runComplexityAnalysis(filesToAnalyze, threshold, rootDir, logger);
    const baseReport = baseResult?.report ?? null;

    // Restore HEAD
    execFileSync('git', ['checkout', '--force', originalHead], { stdio: 'pipe' });
    logger.info('Restored to HEAD');

    if (baseReport) {
      logger.info(`Base branch: ${baseReport.summary.totalViolations} violations`);
    }

    return baseReport;
  } catch (error) {
    logger.warning(`Failed to analyze base branch: ${error}`);
    // Attempt to restore original HEAD even if analysis failed
    try {
      execFileSync('git', ['checkout', '--force', originalHead], { stdio: 'pipe' });
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
  logger: Logger,
): Promise<ComplexityReport | null> {
  if (config.enableDeltaTracking) {
    logger.info('Delta tracking enabled - analyzing base branch...');
    return await analyzeBaseBranch(
      prContext.baseSha,
      filesToAnalyze,
      config.threshold,
      rootDir,
      logger,
    );
  }

  if (config.baselineComplexityPath) {
    // Backwards compatibility: support old baseline_complexity input
    logger.warning(
      'baseline_complexity input is deprecated. Use enable_delta_tracking: true instead.',
    );
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

  const baselineReport = await getBaselineReport(
    config,
    prContext,
    filesToAnalyze,
    rootDir,
    logger,
  );
  const analysisResult = await runComplexityAnalysis(
    filesToAnalyze,
    config.threshold,
    rootDir,
    logger,
  );

  if (!analysisResult) {
    logger.warning('Failed to get complexity report');
    return null;
  }

  const { report: currentReport, chunks } = analysisResult;

  logger.info(`Analysis complete: ${currentReport.summary.totalViolations} violations found`);

  const deltas = baselineReport
    ? calculateDeltas(baselineReport, currentReport, filesToAnalyze)
    : null;

  return {
    currentReport,
    baselineReport,
    deltas,
    filesToAnalyze,
    chunks,
  };
}

/**
 * Handle analysis outputs (badge, logging)
 * Updates PR description badge
 */
export async function handleAnalysisOutputs(
  result: AnalysisResult,
  setup: ReviewSetup,
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
  diffLines: Map<string, Set<number>>,
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
 * Find the last diff line within a violation's function range.
 * Used as the end of the multi-line comment range for GitHub suggestions.
 */
function findCommentEndLine(
  violation: ComplexityViolation,
  diffLines: Map<string, Set<number>>,
): number | null {
  const fileLines = diffLines.get(violation.filepath);
  if (!fileLines) return null;

  for (let line = violation.endLine; line >= violation.startLine; line--) {
    if (fileLines.has(line)) return line;
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
 * Check if a line number falls within a range
 */
function inRange(line: number, start: number, end: number): boolean {
  return line >= start && line <= end;
}

/**
 * Check if a patch line is a meaningful added or context line (not a file header).
 */
function isLineRelevant(patchLine: string): boolean {
  return patchLine.startsWith('+') ? !patchLine.startsWith('+++') : patchLine.startsWith(' ');
}

/**
 * Extract the portion of a unified diff patch that overlaps with a given line range.
 * Returns the relevant diff hunk lines, or null if no overlap.
 */
export function extractRelevantHunk(
  patch: string,
  startLine: number,
  endLine: number,
): string | null {
  const lines: string[] = [];
  let currentLine = 0;

  for (const patchLine of patch.split('\n')) {
    const hunkMatch = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    // Deleted lines don't advance the line counter
    if (patchLine.startsWith('-')) {
      if (inRange(currentLine, startLine, endLine)) lines.push(patchLine);
      continue;
    }

    if (isLineRelevant(patchLine)) {
      if (inRange(currentLine, startLine, endLine)) lines.push(patchLine);
      currentLine++;
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Build diff hunks map keyed by filepath::symbolName from patches and violations
 */
function buildDiffHunks(
  patches: Map<string, string>,
  violations: ComplexityViolation[],
): Map<string, string> {
  const diffHunks = new Map<string, string>();

  for (const v of violations) {
    const key = `${v.filepath}::${v.symbolName}`;
    if (diffHunks.has(key)) continue; // Already extracted for this function

    const patch = patches.get(v.filepath);
    if (!patch) continue;

    const hunk = extractRelevantHunk(patch, v.startLine, v.endLine);
    if (hunk) {
      diffHunks.set(key, hunk);
    }
  }

  return diffHunks;
}

/**
 * Build delta lookup map from deltas array
 */
function buildDeltaMap(deltas: ComplexityDelta[] | null): Map<string, ComplexityDelta> {
  if (!deltas) return new Map();

  return new Map(
    collect(deltas)
      .map(d => [createDeltaKey(d), d] as [string, ComplexityDelta])
      .all(),
  );
}

/**
 * Get emoji for metric type
 */
function getMetricEmoji(metricType: string): string {
  switch (metricType) {
    case 'cyclomatic':
      return '🔀';
    case 'cognitive':
      return '🧠';
    case 'halstead_effort':
      return '⏱️';
    case 'halstead_bugs':
      return '🐛';
    default:
      return '📊';
  }
}

/**
 * Format a single uncovered violation line
 */
function formatUncoveredLine(
  v: ComplexityViolation,
  deltaMap: Map<string, ComplexityDelta>,
): string {
  const delta = deltaMap.get(createDeltaKey(v));
  const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : '';
  const emoji = getMetricEmoji(v.metricType);
  const metricLabel = getMetricLabel(v.metricType || 'cyclomatic');
  const valueDisplay = formatComplexityValue(v.metricType || 'cyclomatic', v.complexity);
  return `* \`${v.symbolName}\` in \`${v.filepath}\`: ${emoji} ${metricLabel} ${valueDisplay}${deltaStr}`;
}

const BOY_SCOUT_LINK =
  '[boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html)';

/**
 * Categorize uncovered violations into new/worsened vs pre-existing
 */
function categorizeUncoveredViolations(
  violations: ComplexityViolation[],
  deltaMap: Map<string, ComplexityDelta>,
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
function buildNewWorsenedSection(
  violations: ComplexityViolation[],
  deltaMap: Map<string, ComplexityDelta>,
): string {
  if (violations.length === 0) return '';
  const list = violations.map(v => formatUncoveredLine(v, deltaMap)).join('\n');
  return `\n\n⚠️ **${violations.length} new/worsened violation${violations.length === 1 ? '' : 's'} outside diff:**\n\n${list}`;
}

/**
 * Format pre-existing violations section (collapsed)
 */
function buildPreExistingSection(
  violations: ComplexityViolation[],
  deltaMap: Map<string, ComplexityDelta>,
): string {
  if (violations.length === 0) return '';
  const list = violations.map(v => formatUncoveredLine(v, deltaMap)).join('\n');
  return `\n\n<details>\n<summary>ℹ️ ${violations.length} pre-existing violation${violations.length === 1 ? '' : 's'} outside diff</summary>\n\n${list}\n\n> *These violations existed before this PR. No action required, but consider the ${BOY_SCOUT_LINK}!*\n\n</details>`;
}

/**
 * Format fallback section when no delta data is available (legacy)
 */
function buildFallbackUncoveredSection(
  violations: ComplexityViolation[],
  deltaMap: Map<string, ComplexityDelta>,
): string {
  const list = violations.map(v => formatUncoveredLine(v, deltaMap)).join('\n');
  return `\n\n<details>\n<summary>⚠️ ${violations.length} violation${violations.length === 1 ? '' : 's'} outside diff (no inline comment)</summary>\n\n${list}\n\n> 💡 *These exist in files touched by this PR but the function declarations aren't in the diff. Consider the ${BOY_SCOUT_LINK}!*\n\n</details>`;
}

/**
 * Build uncovered violations note for summary
 * Splits into new/worsened (shown prominently) vs pre-existing (collapsed)
 */
function buildUncoveredNote(
  uncoveredViolations: ComplexityViolation[],
  deltaMap: Map<string, ComplexityDelta>,
): string {
  if (uncoveredViolations.length === 0) return '';

  const { newOrWorsened, preExisting } = categorizeUncoveredViolations(
    uncoveredViolations,
    deltaMap,
  );

  // Fallback: if no delta data, show all in collapsed section (legacy behavior)
  if (newOrWorsened.length === 0 && preExisting.length === 0) {
    return buildFallbackUncoveredSection(uncoveredViolations, deltaMap);
  }

  return (
    buildNewWorsenedSection(newOrWorsened, deltaMap) +
    buildPreExistingSection(preExisting, deltaMap)
  );
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
  return (
    collect(deltas)
      .groupBy('metricType')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((group: any) => group.sum('delta'))
      .all() as unknown as Record<string, number>
  );
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

  if (
    deltaSummary.totalDelta === 0 &&
    deltaSummary.improved === 0 &&
    deltaSummary.newFunctions === 0
  ) {
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
  uncoveredNote: string,
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
 * Get emoji for metric type
 */
function getMetricEmojiForComment(metricType: string): string {
  switch (metricType) {
    case 'cyclomatic':
      return '🔀';
    case 'cognitive':
      return '🧠';
    case 'halstead_effort':
      return '⏱️';
    case 'halstead_bugs':
      return '🐛';
    default:
      return '📊';
  }
}

/**
 * Format a single metric header line for a grouped comment
 */
function formatMetricHeaderLine(
  violation: ComplexityViolation,
  deltaMap: Map<string, ComplexityDelta>,
): string {
  const metricType = violation.metricType || 'cyclomatic';
  const delta = deltaMap.get(createDeltaKey(violation));
  const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : '';
  const severityEmoji = delta
    ? formatSeverityEmoji(delta.severity)
    : violation.severity === 'error'
      ? '🔴'
      : '🟡';
  const emoji = getMetricEmojiForComment(metricType);
  const metricLabel = getMetricLabel(metricType);
  const valueDisplay = formatComplexityValue(metricType, violation.complexity);
  const thresholdDisplay = formatThresholdValue(metricType, violation.threshold);

  return `${severityEmoji} ${emoji} **${metricLabel.charAt(0).toUpperCase() + metricLabel.slice(1)}: ${valueDisplay}**${deltaStr} (threshold: ${thresholdDisplay})`;
}

/**
 * A violation matched to its diff line range for inline commenting.
 */
type ViolationWithLines = {
  violation: ComplexityViolation;
  commentLine: number;
  commentEndLine: number | null;
};

/**
 * Build the body of a grouped comment for a single function.
 */
function buildGroupedCommentBody(
  group: ViolationWithLines[],
  aiComments: Map<ComplexityViolation, string>,
  deltaMap: Map<string, ComplexityDelta>,
  report: ComplexityReport,
): string {
  const firstViolation = group[0].violation;
  const { commentLine } = group[0];

  const metricHeaders = group
    .map(({ violation }) => formatMetricHeaderLine(violation, deltaMap))
    .join('\n');

  const lineNote =
    commentLine !== firstViolation.startLine
      ? ` *(\`${firstViolation.symbolName}\` starts at line ${firstViolation.startLine})*`
      : '';

  const comment = aiComments.get(firstViolation)!;

  const fileData = report.files[firstViolation.filepath];
  const testNote =
    fileData && (!fileData.testAssociations || fileData.testAssociations.length === 0)
      ? '\n\n> No test files found for this function.'
      : '';

  return `${metricHeaders}${lineNote}\n\n${comment}${testNote}`;
}

/**
 * Build line comments from violations and AI comments.
 * Groups violations by filepath::symbolName to produce one comment per function.
 */
function buildLineComments(
  violationsWithLines: ViolationWithLines[],
  aiComments: Map<ComplexityViolation, string>,
  deltaMap: Map<string, ComplexityDelta>,
  report: ComplexityReport,
  logger: Logger,
): LineComment[] {
  // Group violations by filepath::symbolName
  const grouped = new Map<string, ViolationWithLines[]>();
  for (const entry of violationsWithLines) {
    if (!aiComments.has(entry.violation)) continue;
    const key = `${entry.violation.filepath}::${entry.violation.symbolName}`;
    const existing = grouped.get(key) || [];
    existing.push(entry);
    grouped.set(key, existing);
  }

  const comments: LineComment[] = [];
  for (const [, group] of grouped) {
    const firstViolation = group[0].violation;
    const { commentLine, commentEndLine } = group[0];

    logger.info(
      `Adding grouped comment for ${firstViolation.filepath}:${commentLine} (${firstViolation.symbolName}, ${group.length} metric${group.length === 1 ? '' : 's'})`,
    );

    // GitHub API: line = end of range, start_line = start of range
    comments.push({
      path: firstViolation.filepath,
      line: commentEndLine ?? commentLine,
      start_line: commentLine,
      body: buildGroupedCommentBody(group, aiComments, deltaMap, report),
    });
  }

  return comments;
}

/**
 * Partition violations into those with comment lines and those without
 */
function partitionViolationsByDiff(
  violations: ComplexityViolation[],
  diffLines: Map<string, Set<number>>,
): {
  withLines: ViolationWithLines[];
  uncovered: ComplexityViolation[];
} {
  const withLines: ViolationWithLines[] = [];
  const uncovered: ComplexityViolation[] = [];

  for (const v of violations) {
    const commentLine = findCommentLine(v, diffLines);
    if (commentLine !== null) {
      const commentEndLine = findCommentEndLine(v, diffLines);
      withLines.push({ violation: v, commentLine, commentEndLine });
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
  violationsWithLines: ViolationWithLines[],
  deltaMap: Map<string, ComplexityDelta>,
): ViolationWithLines[] {
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
  violationsWithLines: ViolationWithLines[],
  deltaMap: Map<string, ComplexityDelta>,
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
  withLines: ViolationWithLines[];
  uncovered: ComplexityViolation[];
  newOrDegraded: ViolationWithLines[];
  skipped: ComplexityViolation[];
}

/**
 * Process violations for review (partition, filter, categorize)
 */
function processViolationsForReview(
  violations: ComplexityViolation[],
  diffLines: Map<string, Set<number>>,
  deltaMap: Map<string, ComplexityDelta>,
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
  violationsWithLines: ViolationWithLines[],
  uncoveredViolations: ComplexityViolation[],
  deltaMap: Map<string, ComplexityDelta>,
  report: ComplexityReport,
  deltas: ComplexityDelta[] | null,
  logger: Logger,
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
  logger: Logger,
  diffHunks?: Map<string, string>,
): Promise<void> {
  const commentableViolations = processed.newOrDegraded.map(v => v.violation);
  logger.info(
    `Generating AI comments for ${commentableViolations.length} new/degraded violations...`,
  );

  const aiComments = await generateLineComments(
    commentableViolations,
    codeSnippets,
    config.openrouterApiKey,
    config.model,
    report,
    logger,
    diffHunks,
  );

  const lineComments = buildLineComments(
    processed.newOrDegraded,
    aiComments,
    deltaMap,
    report,
    logger,
  );
  logger.info(`Built ${lineComments.length} line comments for new/degraded violations`);

  const uncoveredNote = buildUncoveredNote(processed.uncovered, deltaMap);
  const skippedNote = buildSkippedNote(processed.skipped);
  const summaryBody = buildReviewSummary(report, deltas, uncoveredNote + skippedNote);

  // Determine review event: REQUEST_CHANGES if blocking is enabled and
  // any new/degraded violation has error severity
  const hasNewErrors =
    config.blockOnNewErrors &&
    processed.newOrDegraded.some(({ violation }) => {
      const delta = deltaMap.get(createDeltaKey(violation));
      // Block on new violations or worsened-to-error violations
      return (
        violation.severity === 'error' && (!delta || delta.severity === 'new' || delta.delta > 0)
      );
    });
  const event = hasNewErrors ? 'REQUEST_CHANGES' : 'COMMENT';

  if (hasNewErrors) {
    logger.info('New error-level violations detected — posting REQUEST_CHANGES review');
  }

  await postPRReview(octokit, prContext, lineComments, summaryBody, logger, event);
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
  deltas: ComplexityDelta[] | null = null,
): Promise<void> {
  const { diffLines, patches } = await getPRPatchData(octokit, prContext);
  logger.info(`Diff covers ${diffLines.size} files`);

  const deltaMap = buildDeltaMap(deltas);
  const processed = processViolationsForReview(violations, diffLines, deltaMap);

  logger.info(
    `${processed.withLines.length}/${violations.length} violations can have inline comments ` +
      `(${processed.uncovered.length} outside diff)`,
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
      logger,
    );
    return;
  }

  // Build diff hunks for the commentable violations so AI can see what changed
  const commentableViolations = processed.newOrDegraded.map(v => v.violation);
  const diffHunks = buildDiffHunks(patches, commentableViolations);
  logger.info(`Extracted diff hunks for ${diffHunks.size} functions`);

  await generateAndPostReview(
    octokit,
    prContext,
    processed,
    deltaMap,
    codeSnippets,
    config,
    report,
    deltas,
    logger,
    diffHunks,
  );
}

/**
 * Build a map of chunk key -> content for suppression checks and code snippets.
 */
function buildChunkSnippetsMap(chunks: CodeChunk[]): Map<string, string> {
  const snippets = new Map<string, string>();
  for (const chunk of chunks) {
    if (chunk.metadata.symbolName) {
      snippets.set(`${chunk.metadata.file}::${chunk.metadata.symbolName}`, chunk.content);
    }
  }
  return snippets;
}

/**
 * Run logic review pass: detect findings, filter suppressions, validate via LLM, post comments.
 */
async function runLogicReviewPass(result: AnalysisResult, setup: ReviewSetup): Promise<void> {
  const { config, prContext, octokit, logger } = setup;

  logger.info('Running logic review (beta)...');
  try {
    const snippetsMap = buildChunkSnippetsMap(result.chunks);

    let logicFindings = detectLogicFindings(
      result.chunks,
      result.currentReport,
      result.baselineReport,
      config.logicReviewCategories,
    );

    logicFindings = logicFindings.filter(finding => {
      const key = `${finding.filepath}::${finding.symbolName}`;
      const snippet = snippetsMap.get(key);
      if (snippet && isFindingSuppressed(finding, snippet)) {
        logger.info(`Suppressed finding: ${key} (${finding.category})`);
        return false;
      }
      return true;
    });

    if (logicFindings.length === 0) {
      logger.info('No logic findings to report');
      return;
    }

    logger.info(`${logicFindings.length} logic findings after filtering`);

    // Collect code snippets for the remaining findings
    const logicCodeSnippets = new Map<string, string>();
    for (const finding of logicFindings) {
      const key = `${finding.filepath}::${finding.symbolName}`;
      const snippet = snippetsMap.get(key);
      if (snippet) logicCodeSnippets.set(key, snippet);
    }

    const validatedComments = await generateLogicComments(
      logicFindings,
      logicCodeSnippets,
      config.openrouterApiKey,
      config.model,
      result.currentReport,
      logger,
    );

    if (validatedComments.length > 0) {
      logger.info(`Posting ${validatedComments.length} logic review comments`);
      await postPRReview(
        octokit,
        prContext,
        validatedComments,
        '**Logic Review** (beta) — see inline comments.',
        logger,
      );
    }
  } catch (error) {
    logger.warning(`Logic review failed (non-blocking): ${error}`);
  }
}

/**
 * Post review if violations are found, or success message if none
 */
export async function postReviewIfNeeded(
  result: AnalysisResult,
  setup: ReviewSetup,
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
    logger,
  );

  resetTokenUsage();
  await postLineReview(
    octokit,
    prContext,
    result.currentReport,
    violations,
    codeSnippets,
    config,
    logger,
    result.deltas,
  );

  // Logic review pass (beta)
  if (config.enableLogicReview && result.chunks.length > 0) {
    await runLogicReviewPass(result, setup);
  }
}

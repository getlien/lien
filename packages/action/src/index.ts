/**
 * Lien AI Code Review GitHub Action
 *
 * Entry point for the action. Orchestrates:
 * 1. Getting PR changed files
 * 2. Running complexity analysis (with delta from base branch)
 * 3. Generating AI review
 * 4. Posting comment to PR (line-specific or summary)
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import {
  getPRContext,
  getPRChangedFiles,
  getFileContent,
  postPRComment,
  postPRReview,
  getPRDiffLines,
  createOctokit,
  updatePRDescription,
  type LineComment,
} from './github.js';
import { runComplexityAnalysis, filterAnalyzableFiles } from './complexity.js';
import { generateReview, generateLineComments, resetTokenUsage, getTokenUsage } from './openrouter.js';
import {
  buildReviewPrompt,
  buildNoViolationsMessage,
  formatReviewComment,
  getViolationKey,
  buildDescriptionBadge,
} from './prompt.js';
import {
  calculateDeltas,
  calculateDeltaSummary,
  formatDelta,
  formatSeverityEmoji,
  logDeltaSummary,
} from './delta.js';
import type { ActionConfig, ComplexityViolation, ComplexityReport, ComplexityDelta } from './types.js';

type ReviewStyle = 'line' | 'summary';

/**
 * Get action configuration from inputs
 */
function getConfig(): ActionConfig & { reviewStyle: ReviewStyle; baselineComplexityPath: string } {
  const reviewStyle = core.getInput('review_style') || 'line';
  
  return {
    openrouterApiKey: core.getInput('openrouter_api_key', { required: true }),
    model: core.getInput('model') || 'anthropic/claude-sonnet-4',
    threshold: core.getInput('threshold') || '10',
    githubToken: core.getInput('github_token') || process.env.GITHUB_TOKEN || '',
    reviewStyle: reviewStyle === 'summary' ? 'summary' : 'line',
    baselineComplexityPath: core.getInput('baseline_complexity') || '',
  };
}

/**
 * Load baseline complexity report from file
 */
function loadBaselineComplexity(path: string): ComplexityReport | null {
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
    const report = JSON.parse(content) as ComplexityReport;
    
    if (!report.files || !report.summary) {
      core.warning('Baseline complexity file has invalid format');
      return null;
    }

    core.info(`Loaded baseline complexity: ${report.summary.totalViolations} violations`);
    return report;
  } catch (error) {
    core.warning(`Failed to load baseline complexity: ${error}`);
    return null;
  }
}

type PRContext = NonNullable<ReturnType<typeof getPRContext>>;
type Octokit = ReturnType<typeof createOctokit>;
type Config = ReturnType<typeof getConfig>;

/**
 * Setup and validate PR analysis prerequisites
 */
function setupPRAnalysis(): { config: Config; prContext: PRContext; octokit: Octokit } | null {
  const config = getConfig();
  core.info(`Using model: ${config.model}`);
  core.info(`Complexity threshold: ${config.threshold}`);
  core.info(`Review style: ${config.reviewStyle}`);

  if (!config.githubToken) {
    throw new Error('GitHub token is required');
  }

  const prContext = getPRContext();
  if (!prContext) {
    core.warning('Not running in PR context, skipping');
    return null;
  }

  core.info(`Reviewing PR #${prContext.pullNumber}: ${prContext.title}`);
  return { config, prContext, octokit: createOctokit(config.githubToken) };
}

/**
 * Get and filter files eligible for complexity analysis
 */
async function getFilesToAnalyze(octokit: Octokit, prContext: PRContext): Promise<string[]> {
  const allChangedFiles = await getPRChangedFiles(octokit, prContext);
  core.info(`Found ${allChangedFiles.length} changed files in PR`);

  const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
  core.info(`${filesToAnalyze.length} files eligible for complexity analysis`);

  return filesToAnalyze;
}

/**
 * Sort violations by severity and collect code snippets
 */
async function prepareViolationsForReview(
  report: NonNullable<Awaited<ReturnType<typeof runComplexityAnalysis>>>,
  octokit: Octokit,
  prContext: PRContext
): Promise<{ violations: ComplexityViolation[]; codeSnippets: Map<string, string> }> {
  // Collect and sort violations
  const violations = Object.values(report.files)
    .flatMap((fileData) => fileData.violations)
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return b.complexity - a.complexity;
    })
    .slice(0, 10);

  // Collect code snippets
  const codeSnippets = new Map<string, string>();
  for (const violation of violations) {
    const snippet = await getFileContent(
      octokit,
      prContext,
      violation.filepath,
      violation.startLine,
      violation.endLine
    );
    if (snippet) {
      codeSnippets.set(getViolationKey(violation), snippet);
    }
  }
  core.info(`Collected ${codeSnippets.size} code snippets for review`);

  return { violations, codeSnippets };
}

/**
 * Main action logic - orchestrates the review flow
 */
async function run(): Promise<void> {
  try {
    const setup = setupPRAnalysis();
    if (!setup) return;
    const { config, prContext, octokit } = setup;

    const filesToAnalyze = await getFilesToAnalyze(octokit, prContext);
    if (filesToAnalyze.length === 0) {
      core.info('No analyzable files found, skipping review');
      return;
    }

    // Load baseline complexity for delta calculation
    const baselineReport = loadBaselineComplexity(config.baselineComplexityPath);

    const report = await runComplexityAnalysis(filesToAnalyze, config.threshold);
    if (!report) {
      core.warning('Failed to get complexity report');
      return;
    }
    core.info(`Analysis complete: ${report.summary.totalViolations} violations found`);

    // Calculate deltas if we have a baseline
    const deltas = baselineReport
      ? calculateDeltas(baselineReport, report, filesToAnalyze)
      : null;

    const deltaSummary = deltas ? calculateDeltaSummary(deltas) : null;

    if (deltaSummary) {
      logDeltaSummary(deltaSummary);
      core.setOutput('total_delta', deltaSummary.totalDelta);
      core.setOutput('improved', deltaSummary.improved);
      core.setOutput('degraded', deltaSummary.degraded);
    }

    // Always update PR description with stats badge
    const badge = buildDescriptionBadge(report, deltaSummary);
    await updatePRDescription(octokit, prContext, badge);

    if (report.summary.totalViolations === 0) {
      core.info('No complexity violations found');
      // Skip the regular comment - the description badge is sufficient
      return;
    }

    const { violations, codeSnippets } = await prepareViolationsForReview(report, octokit, prContext);

    resetTokenUsage();
    if (config.reviewStyle === 'summary') {
      await postSummaryReview(octokit, prContext, report, codeSnippets, config, false, deltas);
    } else {
      await postLineReview(octokit, prContext, report, violations, codeSnippets, config, deltas);
    }

    core.setOutput('violations', report.summary.totalViolations);
    core.setOutput('errors', report.summary.bySeverity.error);
    core.setOutput('warnings', report.summary.bySeverity.warning);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'An unexpected error occurred');
  }
}

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
 * Build delta lookup map from deltas array
 */
function buildDeltaMap(deltas: ComplexityDelta[] | null): Map<string, ComplexityDelta> {
  const deltaMap = new Map<string, ComplexityDelta>();
  if (deltas) {
    for (const d of deltas) {
      deltaMap.set(`${d.filepath}::${d.symbolName}`, d);
    }
  }
  return deltaMap;
}

/**
 * Build line comments from violations and AI comments
 */
function buildLineComments(
  violationsWithLines: Array<{ violation: ComplexityViolation; commentLine: number }>,
  aiComments: Map<ComplexityViolation, string>,
  deltaMap: Map<string, ComplexityDelta>
): LineComment[] {
  const lineComments: LineComment[] = [];

  for (const { violation, commentLine } of violationsWithLines) {
    const comment = aiComments.get(violation);
    if (!comment) continue;

    const delta = deltaMap.get(`${violation.filepath}::${violation.symbolName}`);
    const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : '';
    const severityEmoji = delta 
      ? formatSeverityEmoji(delta.severity)
      : (violation.severity === 'error' ? '🔴' : '🟡');
    
    const lineNote = commentLine !== violation.startLine 
      ? ` *(function starts at line ${violation.startLine})*` 
      : '';
    
    core.info(`Adding comment for ${violation.filepath}:${commentLine} (${violation.symbolName})${deltaStr}`);
    lineComments.push({
      path: violation.filepath,
      line: commentLine,
      body: `${severityEmoji} **Complexity: ${violation.complexity}**${deltaStr} (threshold: ${violation.threshold})${lineNote}\n\n${comment}`,
    });
  }

  return lineComments;
}

/**
 * Build uncovered violations note for summary
 */
function buildUncoveredNote(
  uncoveredViolations: ComplexityViolation[],
  deltaMap: Map<string, ComplexityDelta>
): string {
  if (uncoveredViolations.length === 0) return '';

  const uncoveredList = uncoveredViolations
    .map(v => {
      const delta = deltaMap.get(`${v.filepath}::${v.symbolName}`);
      const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : '';
      return `  - \`${v.symbolName}\` in \`${v.filepath}\`: complexity ${v.complexity}${deltaStr}`;
    })
    .join('\n');

  return `\n\n<details>\n<summary>⚠️ ${uncoveredViolations.length} violation${uncoveredViolations.length === 1 ? '' : 's'} outside diff (no inline comment)</summary>\n\n${uncoveredList}\n\n> 💡 *These exist in files touched by this PR but the function declarations aren't in the diff. Consider the [boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html)!*\n\n</details>`;
}

/**
 * Build review summary body for line comments mode
 */
function buildReviewSummary(
  report: NonNullable<Awaited<ReturnType<typeof runComplexityAnalysis>>>,
  deltas: ComplexityDelta[] | null,
  uncoveredNote: string
): string {
  const { summary } = report;
  const usage = getTokenUsage();
  const costDisplay = usage.totalTokens > 0
    ? `\n- Tokens: ${usage.totalTokens.toLocaleString()} ($${usage.cost.toFixed(4)})`
    : '';

  let deltaDisplay = '';
  if (deltas && deltas.length > 0) {
    const deltaSummary = calculateDeltaSummary(deltas);
    const sign = deltaSummary.totalDelta >= 0 ? '+' : '';
    const trend = deltaSummary.totalDelta > 0 ? '⬆️' : deltaSummary.totalDelta < 0 ? '⬇️' : '➡️';
    deltaDisplay = `\n\n**Complexity Change:** ${sign}${deltaSummary.totalDelta} ${trend}`;
    if (deltaSummary.improved > 0) deltaDisplay += ` (${deltaSummary.improved} improved)`;
    if (deltaSummary.degraded > 0) deltaDisplay += ` (${deltaSummary.degraded} degraded)`;
  }

  return `<!-- lien-ai-review -->
## 🔍 Lien Complexity Review

**Found ${summary.totalViolations} violation${summary.totalViolations === 1 ? '' : 's'}** (${summary.bySeverity.error} error${summary.bySeverity.error === 1 ? '' : 's'}, ${summary.bySeverity.warning} warning${summary.bySeverity.warning === 1 ? '' : 's'})${deltaDisplay}

See inline comments on the diff for specific suggestions.${uncoveredNote}

<details>
<summary>📊 Analysis Details</summary>

- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}${costDisplay}

</details>

*[Lien](https://lien.dev) AI Code Review*`;
}

/**
 * Post review with line-specific comments for all violations
 */
async function postLineReview(
  octokit: ReturnType<typeof createOctokit>,
  prContext: ReturnType<typeof getPRContext> & object,
  report: Awaited<ReturnType<typeof runComplexityAnalysis>> & object,
  violations: ComplexityViolation[],
  codeSnippets: Map<string, string>,
  config: ReturnType<typeof getConfig>,
  deltas: ComplexityDelta[] | null = null
): Promise<void> {
  const diffLines = await getPRDiffLines(octokit, prContext);
  core.info(`Diff covers ${diffLines.size} files`);

  // Partition violations into those we can comment on and those we can't
  const violationsWithLines: Array<{ violation: ComplexityViolation; commentLine: number }> = [];
  const uncoveredViolations: ComplexityViolation[] = [];

  for (const v of violations) {
    const commentLine = findCommentLine(v, diffLines);
    if (commentLine !== null) {
      violationsWithLines.push({ violation: v, commentLine });
    } else {
      uncoveredViolations.push(v);
    }
  }

  core.info(
    `${violationsWithLines.length}/${violations.length} violations can have inline comments ` +
    `(${uncoveredViolations.length} outside diff)`
  );

  if (violationsWithLines.length === 0) {
    core.info('No violations in diff range, posting summary comment with fallback note');
    await postSummaryReview(octokit, prContext, report, codeSnippets, config, true, deltas);
    return;
  }

  const deltaMap = buildDeltaMap(deltas);

  // Generate AI comments
  const commentableViolations = violationsWithLines.map(v => v.violation);
  core.info('Generating AI comments for violations...');
  const aiComments = await generateLineComments(
    commentableViolations,
    codeSnippets,
    config.openrouterApiKey,
    config.model
  );

  // Build and post review
  const lineComments = buildLineComments(violationsWithLines, aiComments, deltaMap);
  core.info(`Built ${lineComments.length} line comments`);

  const uncoveredNote = buildUncoveredNote(uncoveredViolations, deltaMap);
  const summaryBody = buildReviewSummary(report, deltas, uncoveredNote);

  await postPRReview(octokit, prContext, lineComments, summaryBody);
  core.info(`Posted review with ${lineComments.length} line comments`);
}

/**
 * Post review as a single summary comment
 * @param isFallback - true if this is a fallback because violations aren't on diff lines
 * @param deltas - complexity deltas for delta display
 */
async function postSummaryReview(
  octokit: ReturnType<typeof createOctokit>,
  prContext: ReturnType<typeof getPRContext> & object,
  report: Awaited<ReturnType<typeof runComplexityAnalysis>> & object,
  codeSnippets: Map<string, string>,
  config: ReturnType<typeof getConfig>,
  isFallback = false,
  deltas: ComplexityDelta[] | null = null
): Promise<void> {
  const prompt = buildReviewPrompt(report, prContext, codeSnippets, deltas);
  core.debug(`Prompt length: ${prompt.length} characters`);

  const aiReview = await generateReview(
    prompt,
    config.openrouterApiKey,
    config.model
  );

  const usage = getTokenUsage();
  const deltaSummary = deltas ? calculateDeltaSummary(deltas) : null;
  const comment = formatReviewComment(aiReview, report, isFallback, usage, deltaSummary);
  await postPRComment(octokit, prContext, comment);
  core.info('Successfully posted AI review summary comment');
}

// Run the action
run();

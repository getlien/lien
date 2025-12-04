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
  type LineComment,
} from './github.js';
import { runComplexityAnalysis, filterAnalyzableFiles } from './complexity.js';
import { generateReview, generateLineComments, resetTokenUsage, getTokenUsage } from './openrouter.js';
import {
  buildReviewPrompt,
  buildNoViolationsMessage,
  formatReviewComment,
  getViolationKey,
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

    if (deltas) {
      const deltaSummary = calculateDeltaSummary(deltas);
      logDeltaSummary(deltaSummary);
      core.setOutput('total_delta', deltaSummary.totalDelta);
      core.setOutput('improved', deltaSummary.improved);
      core.setOutput('degraded', deltaSummary.degraded);
    }

    if (report.summary.totalViolations === 0) {
      core.info('No complexity violations found');
      await postPRComment(octokit, prContext, buildNoViolationsMessage(prContext, deltas));
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
  // Get lines that are in the diff (only these can have line comments)
  const diffLines = await getPRDiffLines(octokit, prContext);
  core.info(`Diff covers ${diffLines.size} files`);

  // Filter violations to only those on lines in the diff
  const commentableViolations = violations.filter((v) => {
    const fileLines = diffLines.get(v.filepath);
    if (!fileLines) return false;
    // Check if start line is in diff
    return fileLines.has(v.startLine);
  });

  core.info(
    `${commentableViolations.length}/${violations.length} violations are on diff lines`
  );

  if (commentableViolations.length === 0) {
    // No violations on diff lines, fall back to summary with boy scout note
    core.info('No violations on diff lines, posting summary comment with fallback note');
    await postSummaryReview(octokit, prContext, report, codeSnippets, config, true, deltas);
    return;
  }

  // Build delta lookup map
  const deltaMap = new Map<string, ComplexityDelta>();
  if (deltas) {
    for (const d of deltas) {
      deltaMap.set(`${d.filepath}::${d.symbolName}`, d);
    }
  }

  // Generate AI comments for each violation
  core.info('Generating AI comments for violations...');
  const aiComments = await generateLineComments(
    commentableViolations,
    codeSnippets,
    config.openrouterApiKey,
    config.model
  );

  // Build line comments with delta info
  const lineComments: LineComment[] = [];
  for (const [violation, comment] of aiComments) {
    const delta = deltaMap.get(`${violation.filepath}::${violation.symbolName}`);
    const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : '';
    const severityEmoji = delta 
      ? formatSeverityEmoji(delta.severity)
      : (violation.severity === 'error' ? '🔴' : '🟡');
    
    core.info(`Adding comment for ${violation.filepath}:${violation.startLine} (${violation.symbolName})${deltaStr}`);
    lineComments.push({
      path: violation.filepath,
      line: violation.startLine,
      body: `${severityEmoji} **Complexity: ${violation.complexity}**${deltaStr} (threshold: ${violation.threshold})\n\n${comment}`,
    });
  }
  core.info(`Built ${lineComments.length} line comments`);

  // Build summary comment with token usage and delta summary
  const { summary } = report;
  const usage = getTokenUsage();
  const costDisplay = usage.totalTokens > 0
    ? `\n- Tokens: ${usage.totalTokens.toLocaleString()} ($${usage.cost.toFixed(4)})`
    : '';

  // Add delta summary if available
  let deltaDisplay = '';
  if (deltas && deltas.length > 0) {
    const deltaSummary = calculateDeltaSummary(deltas);
    const sign = deltaSummary.totalDelta >= 0 ? '+' : '';
    const trend = deltaSummary.totalDelta > 0 ? '⬆️' : deltaSummary.totalDelta < 0 ? '⬇️' : '➡️';
    deltaDisplay = `\n\n**Complexity Change:** ${sign}${deltaSummary.totalDelta} ${trend}`;
    if (deltaSummary.improved > 0) deltaDisplay += ` (${deltaSummary.improved} improved)`;
    if (deltaSummary.degraded > 0) deltaDisplay += ` (${deltaSummary.degraded} degraded)`;
  }

  const summaryBody = `<!-- lien-ai-review -->
## 🔍 Lien Complexity Review

**Found ${summary.totalViolations} violation${summary.totalViolations === 1 ? '' : 's'}** (${summary.bySeverity.error} error${summary.bySeverity.error === 1 ? '' : 's'}, ${summary.bySeverity.warning} warning${summary.bySeverity.warning === 1 ? '' : 's'})${deltaDisplay}

See inline comments on the diff for specific suggestions.

<details>
<summary>📊 Analysis Details</summary>

- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}${costDisplay}

</details>

*[Lien](https://lien.dev) AI Code Review*`;

  // Post the review
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

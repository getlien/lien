/**
 * Lien AI Code Review GitHub Action
 *
 * Entry point for the action. Orchestrates:
 * 1. Getting PR changed files
 * 2. Running complexity analysis
 * 3. Generating AI review
 * 4. Posting comment to PR (line-specific or summary)
 */

import * as core from '@actions/core';
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
import type { ActionConfig, ComplexityViolation } from './types.js';

type ReviewStyle = 'line' | 'summary';

/**
 * Get action configuration from inputs
 */
function getConfig(): ActionConfig & { reviewStyle: ReviewStyle } {
  const reviewStyle = core.getInput('review_style') || 'line';
  
  return {
    openrouterApiKey: core.getInput('openrouter_api_key', { required: true }),
    model: core.getInput('model') || 'anthropic/claude-sonnet-4',
    threshold: core.getInput('threshold') || '10',
    githubToken: core.getInput('github_token') || process.env.GITHUB_TOKEN || '',
    reviewStyle: reviewStyle === 'summary' ? 'summary' : 'line',
  };
}

/**
 * Main action logic
 */
async function run(): Promise<void> {
  try {
    // 1. Get configuration
    const config = getConfig();
    core.info(`Using model: ${config.model}`);
    core.info(`Complexity threshold: ${config.threshold}`);
    core.info(`Review style: ${config.reviewStyle}`);

    if (!config.githubToken) {
      throw new Error('GitHub token is required');
    }

    // 2. Get PR context
    const prContext = getPRContext();
    if (!prContext) {
      core.warning('Not running in PR context, skipping');
      return;
    }
    core.info(`Reviewing PR #${prContext.pullNumber}: ${prContext.title}`);

    // 3. Get changed files
    const octokit = createOctokit(config.githubToken);
    const allChangedFiles = await getPRChangedFiles(octokit, prContext);
    core.info(`Found ${allChangedFiles.length} changed files in PR`);

    // 4. Filter to analyzable files
    const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
    core.info(`${filesToAnalyze.length} files eligible for complexity analysis`);

    if (filesToAnalyze.length === 0) {
      core.info('No analyzable files found, skipping review');
      return;
    }

    // 5. Run complexity analysis
    const report = await runComplexityAnalysis(filesToAnalyze, config.threshold);

    if (!report) {
      core.warning('Failed to get complexity report');
      return;
    }

    core.info(
      `Analysis complete: ${report.summary.totalViolations} violations found`
    );

    // 6. Handle no violations case
    if (report.summary.totalViolations === 0) {
      core.info('No complexity violations found');
      const message = buildNoViolationsMessage(prContext);
      await postPRComment(octokit, prContext, message);
      return;
    }

    // 7. Collect all violations and sort by severity
    const allViolations: ComplexityViolation[] = [];
    for (const [, fileData] of Object.entries(report.files)) {
      allViolations.push(...fileData.violations);
    }

    const sortedViolations = allViolations
      .sort((a, b) => {
        if (a.severity !== b.severity) {
          return a.severity === 'error' ? -1 : 1;
        }
        return b.complexity - a.complexity;
      })
      .slice(0, 10); // Limit to top 10

    // 8. Collect code snippets
    const codeSnippets = new Map<string, string>();
    for (const violation of sortedViolations) {
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

    // 9. Reset token tracking and generate review
    resetTokenUsage();
    
    if (config.reviewStyle === 'summary') {
      await postSummaryReview(
        octokit,
        prContext,
        report,
        codeSnippets,
        config
      );
    } else {
      // line mode (default): inline comments for all violations
      await postLineReview(
        octokit,
        prContext,
        report,
        sortedViolations,
        codeSnippets,
        config
      );
    }

    // 10. Set outputs
    core.setOutput('violations', report.summary.totalViolations);
    core.setOutput('errors', report.summary.bySeverity.error);
    core.setOutput('warnings', report.summary.bySeverity.warning);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
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
  config: ReturnType<typeof getConfig>
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
    // No violations on diff lines, fall back to summary
    core.info('No violations on diff lines, posting summary comment');
    await postSummaryReview(octokit, prContext, report, codeSnippets, config);
    return;
  }

  // Generate AI comments for each violation
  core.info('Generating AI comments for violations...');
  const aiComments = await generateLineComments(
    commentableViolations,
    codeSnippets,
    config.openrouterApiKey,
    config.model
  );

  // Build line comments
  const lineComments: LineComment[] = [];
  for (const [violation, comment] of aiComments) {
    const severityEmoji = violation.severity === 'error' ? '🔴' : '🟡';
    lineComments.push({
      path: violation.filepath,
      line: violation.startLine,
      body: `${severityEmoji} **Complexity: ${violation.complexity}** (threshold: ${violation.threshold})\n\n${comment}`,
    });
  }

  // Build summary comment with token usage
  const { summary } = report;
  const usage = getTokenUsage();
  const costDisplay = usage.totalTokens > 0
    ? `\n- Tokens: ${usage.totalTokens.toLocaleString()} ($${usage.cost.toFixed(4)})`
    : '';

  const summaryBody = `<!-- lien-ai-review -->
## 🔍 Lien Complexity Review

**Found ${summary.totalViolations} violation${summary.totalViolations === 1 ? '' : 's'}** (${summary.bySeverity.error} error${summary.bySeverity.error === 1 ? '' : 's'}, ${summary.bySeverity.warning} warning${summary.bySeverity.warning === 1 ? '' : 's'})

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
 */
async function postSummaryReview(
  octokit: ReturnType<typeof createOctokit>,
  prContext: ReturnType<typeof getPRContext> & object,
  report: Awaited<ReturnType<typeof runComplexityAnalysis>> & object,
  codeSnippets: Map<string, string>,
  config: ReturnType<typeof getConfig>
): Promise<void> {
  const prompt = buildReviewPrompt(report, prContext, codeSnippets);
  core.debug(`Prompt length: ${prompt.length} characters`);

  const aiReview = await generateReview(
    prompt,
    config.openrouterApiKey,
    config.model
  );

  const comment = formatReviewComment(aiReview, report);
  await postPRComment(octokit, prContext, comment);
  core.info('Successfully posted AI review summary comment');
}

// Run the action
run();

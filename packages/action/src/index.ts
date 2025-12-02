/**
 * Lien AI Code Review GitHub Action
 *
 * Entry point for the action. Orchestrates:
 * 1. Getting PR changed files
 * 2. Running complexity analysis
 * 3. Generating AI review
 * 4. Posting comment to PR
 */

import * as core from '@actions/core';
import {
  getPRContext,
  getPRChangedFiles,
  getFileContent,
  postPRComment,
  createOctokit,
} from './github.js';
import { runComplexityAnalysis, filterAnalyzableFiles } from './complexity.js';
import { generateReview } from './openrouter.js';
import {
  buildReviewPrompt,
  buildNoViolationsMessage,
  formatReviewComment,
  getViolationKey,
} from './prompt.js';
import type { ActionConfig, ComplexityViolation } from './types.js';

/**
 * Get action configuration from inputs
 */
function getConfig(): ActionConfig {
  return {
    openrouterApiKey: core.getInput('openrouter_api_key', { required: true }),
    model: core.getInput('model') || 'anthropic/claude-sonnet-4',
    threshold: core.getInput('threshold') || '10',
    githubToken: core.getInput('github_token') || process.env.GITHUB_TOKEN || '',
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

    // 7. Collect code snippets for violations
    const codeSnippets = new Map<string, string>();
    const allViolations: ComplexityViolation[] = [];

    for (const [, fileData] of Object.entries(report.files)) {
      allViolations.push(...fileData.violations);
    }

    // Limit snippets to top 10 most severe violations to avoid token limits
    const topViolations = allViolations
      .sort((a, b) => {
        // Sort by severity (error > warning), then by complexity
        if (a.severity !== b.severity) {
          return a.severity === 'error' ? -1 : 1;
        }
        return b.complexity - a.complexity;
      })
      .slice(0, 10);

    for (const violation of topViolations) {
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

    // 8. Build prompt and generate AI review
    const prompt = buildReviewPrompt(report, prContext, codeSnippets);
    core.debug(`Prompt length: ${prompt.length} characters`);

    const aiReview = await generateReview(
      prompt,
      config.openrouterApiKey,
      config.model
    );

    // 9. Format and post review
    const comment = formatReviewComment(aiReview, report);
    await postPRComment(octokit, prContext, comment);

    core.info('Successfully posted AI review comment');

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

// Run the action
run();


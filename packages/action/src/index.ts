/**
 * Lien AI Code Review GitHub Action
 *
 * Thin adapter over @liendev/review. Reads GitHub Actions inputs,
 * creates the Octokit instance from @actions/github, and delegates
 * to the shared review engine.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  type Logger,
  type ReviewConfig,
  type ReviewSetup,
  createOctokit,
  orchestrateAnalysis,
  handleAnalysisOutputs,
  postReviewIfNeeded,
} from '@liendev/review';

/**
 * Wrap @actions/core as a Logger
 */
const actionsLogger: Logger = {
  info: (msg: string) => core.info(msg),
  warning: (msg: string) => core.warning(msg),
  error: (msg: string) => core.error(msg),
  debug: (msg: string) => core.debug(msg),
};

/**
 * Read action inputs into ReviewConfig
 */
function getConfig(): ReviewConfig {
  return {
    openrouterApiKey: core.getInput('openrouter_api_key', { required: true }),
    model: core.getInput('model') || 'anthropic/claude-sonnet-4',
    threshold: core.getInput('threshold') || '15',
    enableDeltaTracking: core.getInput('enable_delta_tracking') === 'true',
    baselineComplexityPath: core.getInput('baseline_complexity') || '',
    blockOnNewErrors: core.getInput('block_on_new_errors') === 'true',
    enableLogicReview: core.getInput('enable_logic_review') === 'true',
    logicReviewCategories: (
      core.getInput('logic_review_categories') || 'breaking_change,unchecked_return,missing_tests'
    )
      .split(',')
      .map(s => s.trim()),
    enableArchitecturalReview:
      (core.getInput('enable_architectural_review') as 'auto' | 'always' | 'off') || 'off',
    archReviewCategories: (core.getInput('arch_review_categories') || 'coherence,impact')
      .split(',')
      .map(s => s.trim()),
  };
}

/**
 * Get PR context from the GitHub event
 */
function getPRContext() {
  const { context } = github;

  if (!context.payload.pull_request) {
    core.warning('This action only works on pull_request events');
    return null;
  }

  const pr = context.payload.pull_request;

  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pullNumber: pr.number,
    title: pr.title as string,
    baseSha: pr.base.sha as string,
    headSha: pr.head.sha as string,
  };
}

/**
 * Set GitHub Action outputs from analysis results
 */
function setOutputs(
  deltaSummary: { totalDelta: number; improved: number; degraded: number } | null,
  report: { summary: { totalViolations: number; bySeverity: { error: number; warning: number } } },
): void {
  if (deltaSummary) {
    core.setOutput('total_delta', deltaSummary.totalDelta);
    core.setOutput('improved', deltaSummary.improved);
    core.setOutput('degraded', deltaSummary.degraded);
  }

  core.setOutput('violations', report.summary.totalViolations);
  core.setOutput('errors', report.summary.bySeverity.error);
  core.setOutput('warnings', report.summary.bySeverity.warning);
}

/**
 * Main action logic
 */
async function run(): Promise<void> {
  try {
    core.info('Starting Lien AI Code Review...');
    core.info(`Node version: ${process.version}`);
    core.info(`Working directory: ${process.cwd()}`);

    const config = getConfig();
    core.info(`Using model: ${config.model}`);
    core.info(`Complexity threshold: ${config.threshold}`);

    const githubToken = core.getInput('github_token') || process.env.GITHUB_TOKEN || '';
    if (!githubToken) {
      throw new Error('GitHub token is required');
    }

    const prContext = getPRContext();
    if (!prContext) {
      core.info('Not running in PR context, exiting gracefully');
      return;
    }

    core.info(`Reviewing PR #${prContext.pullNumber}: ${prContext.title}`);

    const octokit = createOctokit(githubToken);

    const setup: ReviewSetup = {
      config,
      prContext,
      octokit,
      logger: actionsLogger,
      rootDir: process.cwd(),
    };

    const analysisResult = await orchestrateAnalysis(setup);
    if (!analysisResult) {
      return;
    }

    const deltaSummary = await handleAnalysisOutputs(analysisResult, setup);
    setOutputs(deltaSummary, analysisResult.currentReport);
    await postReviewIfNeeded(analysisResult, setup);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    const stack = error instanceof Error ? error.stack : '';
    core.error(`Action failed: ${message}`);
    if (stack) {
      core.error(`Stack trace:\n${stack}`);
    }
    core.setFailed(message);
  }
}

// Run the action
run().catch(error => {
  core.setFailed(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

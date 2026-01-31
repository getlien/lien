/**
 * Webhook handler — receives PR events and orchestrates clone → analyze → post review.
 */

import type { Octokit } from '@octokit/rest';
import {
  type PRContext,
  type ReviewConfig,
  type Logger,
  consoleLogger,
  orchestrateAnalysis,
  handleAnalysisOutputs,
  postReviewIfNeeded,
  runComplexityAnalysis,
  filterAnalyzableFiles,
  getPRChangedFiles,
  calculateDeltas,
  type ReviewSetup,
  type AnalysisResult,
} from '@liendev/review';

import { cloneRepo, cloneBase, type CloneResult } from './clone.js';
import type { AppConfig } from './config.js';

interface PRWebhookPayload {
  action: string;
  number: number;
  pull_request: {
    number: number;
    title: string;
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
  };
  repository: {
    full_name: string;
    owner: { id: number; login: string };
    name: string;
  };
  installation?: { id: number };
}

/**
 * Handle a pull_request webhook event.
 * Clones the repo, runs analysis, posts review, and cleans up.
 */
export async function handlePullRequest(
  payload: PRWebhookPayload,
  octokit: Octokit,
  token: string,
  config: AppConfig,
  logger: Logger = consoleLogger,
): Promise<void> {
  const { pull_request: pr, repository: repo } = payload;

  // Only handle opened and synchronize events
  if (payload.action !== 'opened' && payload.action !== 'synchronize') {
    logger.info(`Ignoring PR action: ${payload.action}`);
    return;
  }

  logger.info(`Processing PR #${pr.number} (${payload.action}) on ${repo.full_name}`);

  const prContext: PRContext = {
    owner: repo.owner.login,
    repo: repo.name,
    pullNumber: pr.number,
    title: pr.title,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
  };

  const reviewConfig: ReviewConfig = {
    openrouterApiKey: config.openRouterApiKey,
    model: config.openRouterModel,
    threshold: '15',
    reviewStyle: 'line',
    enableDeltaTracking: true,
    baselineComplexityPath: '',
  };

  // Clone head branch
  let headClone: CloneResult | null = null;
  let baseClone: CloneResult | null = null;

  try {
    headClone = await cloneRepo(repo.full_name, pr.head.ref, token, logger);

    // Get changed files from GitHub API
    const allChangedFiles = await getPRChangedFiles(octokit, prContext);
    logger.info(`Found ${allChangedFiles.length} changed files in PR`);

    const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
    logger.info(`${filesToAnalyze.length} files eligible for complexity analysis`);

    if (filesToAnalyze.length === 0) {
      logger.info('No analyzable files found, skipping review');
      return;
    }

    // Analyze head branch
    const currentReport = await runComplexityAnalysis(
      filesToAnalyze,
      reviewConfig.threshold,
      headClone.dir,
      logger,
    );

    if (!currentReport) {
      logger.warning('Failed to get complexity report for head');
      return;
    }

    // Clone and analyze base branch for delta tracking
    let baselineReport = null;
    try {
      baseClone = await cloneBase(repo.full_name, pr.base.ref, token, logger);
      baselineReport = await runComplexityAnalysis(
        filesToAnalyze,
        reviewConfig.threshold,
        baseClone.dir,
        logger,
      );
    } catch (error) {
      logger.warning(`Failed to analyze base branch: ${error instanceof Error ? error.message : String(error)}`);
    }

    const deltas = baselineReport
      ? calculateDeltas(baselineReport, currentReport, filesToAnalyze)
      : null;

    const analysisResult: AnalysisResult = {
      currentReport,
      baselineReport,
      deltas,
      filesToAnalyze,
    };

    const setup: ReviewSetup = {
      config: reviewConfig,
      prContext,
      octokit,
      logger,
      rootDir: headClone.dir,
    };

    // Post badge and review
    await handleAnalysisOutputs(analysisResult, setup);
    await postReviewIfNeeded(analysisResult, setup);

    logger.info(`Review complete for PR #${pr.number}`);
  } finally {
    // Always clean up cloned repos
    if (headClone) await headClone.cleanup();
    if (baseClone) await baseClone.cleanup();
  }
}

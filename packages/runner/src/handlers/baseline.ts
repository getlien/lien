/**
 * Baseline handler — processes reviews.baseline NATS jobs.
 *
 * Simpler than PR review: clone default branch → full complexity scan → POST result.
 * No GitHub interaction, no LLM.
 */

import { createHash } from 'node:crypto';

import type { Logger, ComplexityReport } from '@liendev/review';
import { performChunkOnlyIndex, analyzeComplexityFromChunks } from '@liendev/parser';

import type { BaselineJobPayload, ReviewRunResult, ComplexitySnapshotResult } from '../types.js';
import type { RunnerConfig } from '../config.js';
import { cloneByBranch, resolveHeadSha, type CloneResult } from '../clone.js';
import { postReviewRunResult } from '../api-client.js';

export async function handleBaseline(
  payload: BaselineJobPayload,
  config: RunnerConfig,
  logger: Logger,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const { repository, auth } = payload;

  logger.info(`Processing baseline for ${repository.full_name}@${repository.default_branch}`);

  let clone: CloneResult | null = null;

  try {
    // Clone default branch
    clone = await cloneByBranch(
      repository.full_name,
      repository.default_branch,
      auth.installation_token,
      logger,
    );

    // Full repo scan
    logger.info('Running chunk-only index on full repo...');
    const indexResult = await performChunkOnlyIndex(clone.dir);

    if (!indexResult.success || !indexResult.chunks || indexResult.chunks.length === 0) {
      logger.warning('Indexing produced no chunks');
      await postBaselineResult(config, payload, startedAt, 'failed', null, 0, 0, 0, [], logger);
      return;
    }

    logger.info(
      `Indexing complete: ${indexResult.chunksCreated} chunks from ${indexResult.filesIndexed} files`,
    );

    // Complexity analysis
    const thresholdNum = parseInt(payload.config.threshold, 10);
    const report = analyzeComplexityFromChunks(
      indexResult.chunks,
      [...new Set(indexResult.chunks.map(c => c.metadata.file))],
      !isNaN(thresholdNum) ? { testPaths: thresholdNum, mentalLoad: thresholdNum } : undefined,
    );

    logger.info(`Found ${report.summary.totalViolations} violations`);

    const snapshots = buildComplexitySnapshots(report);

    // Resolve actual commit SHA (not branch name)
    const headSha = await resolveHeadSha(clone.dir);

    await postBaselineResult(
      config,
      payload,
      startedAt,
      'completed',
      headSha,
      indexResult.filesIndexed,
      report.summary.avgComplexity,
      report.summary.maxComplexity,
      snapshots,
      logger,
    );
  } catch (error) {
    logger.error(`Baseline scan failed: ${error instanceof Error ? error.message : String(error)}`);
    try {
      await postBaselineResult(config, payload, startedAt, 'failed', null, 0, 0, 0, [], logger);
    } catch (postError) {
      logger.error(
        `Failed to post failure result: ${postError instanceof Error ? postError.message : String(postError)}`,
      );
    }
    throw error;
  } finally {
    if (clone) await clone.cleanup().catch(() => {});
  }
}

function buildComplexitySnapshots(report: ComplexityReport): ComplexitySnapshotResult[] {
  const snapshots: ComplexitySnapshotResult[] = [];
  for (const [filepath, fileData] of Object.entries(report.files)) {
    for (const v of fileData.violations) {
      snapshots.push({
        filepath,
        symbol_name: v.symbolName,
        symbol_type: v.symbolType,
        start_line: v.startLine,
        metric_type: v.metricType,
        complexity: v.complexity,
        threshold: v.threshold,
        severity: v.severity,
      });
    }
  }
  return snapshots;
}

async function postBaselineResult(
  config: RunnerConfig,
  payload: BaselineJobPayload,
  startedAt: string,
  status: 'completed' | 'failed',
  headSha: string | null,
  filesAnalyzed: number,
  avgComplexity: number,
  maxComplexity: number,
  snapshots: ComplexitySnapshotResult[],
  logger: Logger,
): Promise<void> {
  const resolvedSha = headSha ?? payload.repository.default_branch;

  const configHash = createHash('sha256')
    .update(JSON.stringify(payload.config))
    .digest('hex')
    .slice(0, 16);

  const idempotencyKey = createHash('sha256')
    .update(`${payload.repository.id}:baseline:${resolvedSha}:${configHash}`)
    .digest('hex');

  const result: ReviewRunResult = {
    idempotency_key: idempotencyKey,
    repo_id: payload.repository.id,
    pr_number: null,
    head_sha: resolvedSha,
    base_sha: null,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    status,
    files_analyzed: filesAnalyzed,
    avg_complexity: avgComplexity,
    max_complexity: maxComplexity,
    token_usage: 0,
    cost: 0,
    summary_comment_id: null,
    complexity_snapshots: snapshots,
    review_comments: [],
    logic_findings: [],
  };

  await postReviewRunResult(config.laravelApiUrl, payload.auth.installation_token, result, logger);
}

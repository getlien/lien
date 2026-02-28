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
import {
  cloneByBranch,
  cloneBySha,
  resolveHeadSha,
  resolveCommitTimestamp,
  type CloneResult,
} from '../clone.js';
import { postReviewRunResult } from '../api-client.js';

export async function handleBaseline(
  payload: BaselineJobPayload,
  config: RunnerConfig,
  logger: Logger,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const { repository, auth } = payload;

  // Normalize sha: treat empty/whitespace as absent
  const sha = payload.sha?.trim() || undefined;
  const cloneRef = sha ?? repository.default_branch;
  logger.info(
    `Processing baseline for ${repository.full_name}@${sha ? cloneRef.slice(0, 7) : cloneRef}`,
  );

  let clone: CloneResult | null = null;

  try {
    // Clone by SHA when available (historical baselines), otherwise by branch
    clone = sha
      ? await cloneBySha(repository.full_name, sha, auth.installation_token, logger)
      : await cloneByBranch(
          repository.full_name,
          repository.default_branch,
          auth.installation_token,
          logger,
        );

    // Full repo scan
    logger.info('Running chunk-only index on full repo...');
    const indexResult = await performChunkOnlyIndex(clone.dir);

    if (!indexResult.success) {
      logger.error('Indexing failed');
      await postBaselineResult(
        config,
        payload,
        startedAt,
        'failed',
        sha ?? null,
        sha ? (payload.committed_at ?? null) : null,
        0,
        0,
        0,
        [],
        logger,
      );
      return;
    }

    if (!indexResult.chunks || indexResult.chunks.length === 0) {
      logger.info('No supported files found — marking as completed with zero complexity');
      await postBaselineResult(
        config,
        payload,
        startedAt,
        'completed',
        sha ?? null,
        sha ? (payload.committed_at ?? null) : null,
        0,
        0,
        0,
        [],
        logger,
      );
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

    // Use payload SHA/timestamp when available (historical baselines), otherwise resolve from git
    const headSha = sha ?? (await resolveHeadSha(clone.dir));
    const committedAt =
      (sha ? payload.committed_at : undefined) ?? (await resolveCommitTimestamp(clone.dir));

    await postBaselineResult(
      config,
      payload,
      startedAt,
      'completed',
      headSha,
      committedAt,
      indexResult.filesIndexed,
      report.summary.avgComplexity,
      report.summary.maxComplexity,
      snapshots,
      logger,
    );
  } catch (error) {
    logger.error(`Baseline scan failed: ${error instanceof Error ? error.message : String(error)}`);
    try {
      await postBaselineResult(
        config,
        payload,
        startedAt,
        'failed',
        sha ?? null,
        sha ? (payload.committed_at ?? null) : null,
        0,
        0,
        0,
        [],
        logger,
      );
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
  committedAt: string | null,
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
    committed_at: committedAt,
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

  await postReviewRunResult(config.laravelApiUrl, payload.auth.service_token, result, logger);
}

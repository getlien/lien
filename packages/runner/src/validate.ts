/**
 * Input validation for NATS payloads.
 */

import { assertValidSha } from '@liendev/review';
import type { PRJobPayload, BaselineJobPayload, JobPayload } from './types.js';

// GitHub: owner is alphanumeric + hyphens (no start/end hyphen),
// repo is alphanumeric + hyphens + underscores + periods (no leading period)
const REPO_NAME_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function assertValidRepoName(fullName: string): void {
  if (!REPO_NAME_PATTERN.test(fullName)) {
    throw new Error(`Invalid repository name: ${JSON.stringify(fullName.slice(0, 100))}`);
  }
}

export function validatePRPayload(data: unknown): PRJobPayload {
  const payload = data as Record<string, unknown>;
  if (payload.job_type !== 'pr') {
    throw new Error(`Expected job_type "pr", got ${JSON.stringify(payload.job_type)}`);
  }

  const repo = payload.repository as PRJobPayload['repository'] | undefined;
  if (!repo?.full_name || typeof repo.id !== 'number') {
    throw new Error('Missing or invalid repository in PR payload');
  }
  assertValidRepoName(repo.full_name);

  const pr = payload.pull_request as PRJobPayload['pull_request'] | undefined;
  if (!pr || typeof pr.number !== 'number' || !pr.head_sha || !pr.base_sha) {
    throw new Error('Missing or invalid pull_request in PR payload');
  }
  assertValidSha(pr.head_sha, 'head_sha');
  assertValidSha(pr.base_sha, 'base_sha');

  const config = payload.config as PRJobPayload['config'] | undefined;
  if (!config?.review_types) {
    throw new Error('Missing config.review_types in PR payload');
  }
  if (typeof config.threshold !== 'string') {
    throw new Error('Missing or invalid config.threshold in PR payload');
  }

  const auth = payload.auth as PRJobPayload['auth'] | undefined;
  if (!auth?.installation_token) {
    throw new Error('Missing auth.installation_token in PR payload');
  }
  if (!auth.service_token) {
    throw new Error('Missing auth.service_token in PR payload');
  }

  if (payload.review_run_id != null) {
    const rid = payload.review_run_id;
    if (typeof rid !== 'number' || !Number.isFinite(rid) || !Number.isInteger(rid) || rid <= 0) {
      throw new Error('review_run_id must be a finite positive integer when provided');
    }
  }

  if (payload.check_run_id != null) {
    if (payload.review_run_id == null) {
      throw new Error('review_run_id is required when check_run_id is provided');
    }
    const cid = payload.check_run_id;
    if (typeof cid !== 'number' || !Number.isFinite(cid) || !Number.isInteger(cid) || cid <= 0) {
      throw new Error('check_run_id must be a finite positive integer when provided');
    }
  }

  return data as PRJobPayload;
}

export function validateBaselinePayload(data: unknown): BaselineJobPayload {
  const payload = data as Record<string, unknown>;
  if (payload.job_type !== 'baseline') {
    throw new Error(`Expected job_type "baseline", got ${JSON.stringify(payload.job_type)}`);
  }

  const repo = payload.repository as BaselineJobPayload['repository'] | undefined;
  if (!repo?.full_name || typeof repo.id !== 'number' || !repo.default_branch) {
    throw new Error('Missing or invalid repository in baseline payload');
  }
  assertValidRepoName(repo.full_name);

  const config = payload.config as BaselineJobPayload['config'] | undefined;
  if (!config || typeof config.threshold !== 'string') {
    throw new Error('Missing or invalid config.threshold in baseline payload');
  }

  const auth = payload.auth as BaselineJobPayload['auth'] | undefined;
  if (!auth?.installation_token) {
    throw new Error('Missing auth.installation_token in baseline payload');
  }
  if (!auth.service_token) {
    throw new Error('Missing auth.service_token in baseline payload');
  }

  return data as BaselineJobPayload;
}

export function validateJobPayload(data: unknown): JobPayload {
  const payload = data as Record<string, unknown>;
  if (payload.job_type === 'pr') return validatePRPayload(data);
  if (payload.job_type === 'baseline') return validateBaselinePayload(data);
  throw new Error(`Unknown job_type: ${JSON.stringify(payload.job_type)}`);
}

export { assertValidSha };

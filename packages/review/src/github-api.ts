/**
 * GitHub API helpers using @octokit/rest
 * Portable across GitHub Actions and GitHub App contexts.
 */

import { Octokit } from '@octokit/rest';
import type { PRContext, LineComment } from './types.js';
import type { Logger } from './logger.js';

export type { Octokit };

/**
 * Create an Octokit instance from a token
 */
export function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

// ---------------------------------------------------------------------------
// Check Run API
// ---------------------------------------------------------------------------

export interface CheckRunOutput {
  title: string;
  summary: string;
  text?: string;
  annotations?: Array<{
    path: string;
    start_line: number;
    end_line: number;
    annotation_level: 'notice' | 'warning' | 'failure';
    message: string;
    title?: string;
  }>;
}

/**
 * Create a GitHub Check Run. Returns the check_run_id.
 */
export async function createCheckRun(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    name: string;
    headSha: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'action_required';
    output?: CheckRunOutput;
  },
  logger: Logger,
): Promise<number> {
  const { data } = await octokit.checks.create({
    owner: params.owner,
    repo: params.repo,
    name: params.name,
    head_sha: params.headSha,
    status: params.status,
    ...(params.conclusion ? { conclusion: params.conclusion } : {}),
    ...(params.output ? { output: params.output } : {}),
  });

  logger.info(`Created check run "${params.name}" (id: ${data.id})`);
  return data.id;
}

/**
 * Update an existing GitHub Check Run.
 */
export async function updateCheckRun(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    checkRunId: number;
    status?: 'queued' | 'in_progress' | 'completed';
    conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'action_required';
    output?: CheckRunOutput;
  },
  logger: Logger,
): Promise<void> {
  await octokit.checks.update({
    owner: params.owner,
    repo: params.repo,
    check_run_id: params.checkRunId,
    ...(params.status ? { status: params.status } : {}),
    ...(params.conclusion ? { conclusion: params.conclusion } : {}),
    ...(params.output ? { output: params.output } : {}),
  });

  logger.debug(`Updated check run ${params.checkRunId}`);
}

/**
 * Get list of files changed in the PR
 */
export async function getPRChangedFiles(octokit: Octokit, prContext: PRContext): Promise<string[]> {
  const files: string[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await octokit.pulls.listFiles({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      per_page: perPage,
      page,
    });

    for (const file of response.data) {
      // Only include added or modified files (not deleted)
      if (file.status !== 'removed') {
        files.push(file.filename);
      }
    }

    if (response.data.length < perPage) {
      break;
    }
    page++;
  }

  return files;
}

/**
 * Post a comment on the PR (creates or updates existing Lien comment)
 */
export async function postPRComment(
  octokit: Octokit,
  prContext: PRContext,
  body: string,
  logger: Logger,
): Promise<void> {
  // Check for existing Lien comment to update instead of creating new
  const existingComment = await findExistingComment(octokit, prContext);

  if (existingComment) {
    logger.info(`Updating existing comment ${existingComment.id}`);
    await octokit.issues.updateComment({
      owner: prContext.owner,
      repo: prContext.repo,
      comment_id: existingComment.id,
      body,
    });
  } else {
    logger.info('Creating new comment');
    await octokit.issues.createComment({
      owner: prContext.owner,
      repo: prContext.repo,
      issue_number: prContext.pullNumber,
      body,
    });
  }
}

/**
 * Find existing Lien review comment to update
 */
async function findExistingComment(
  octokit: Octokit,
  prContext: PRContext,
): Promise<{ id: number } | null> {
  const COMMENT_MARKER = '<!-- lien-ai-review -->';

  const comments = await octokit.issues.listComments({
    owner: prContext.owner,
    repo: prContext.repo,
    issue_number: prContext.pullNumber,
  });

  for (const comment of comments.data) {
    if (comment.body?.includes(COMMENT_MARKER)) {
      return { id: comment.id };
    }
  }

  return null;
}

/**
 * Get code snippet from a file at a specific commit
 */
export async function getFileContent(
  octokit: Octokit,
  prContext: PRContext,
  filepath: string,
  startLine: number,
  endLine: number,
  logger: Logger,
): Promise<string | null> {
  try {
    const response = await octokit.repos.getContent({
      owner: prContext.owner,
      repo: prContext.repo,
      path: filepath,
      ref: prContext.headSha,
    });

    if ('content' in response.data) {
      const content = Buffer.from(response.data.content as string, 'base64').toString('utf-8');
      const lines = content.split('\n');
      // Line numbers are 1-based, array is 0-based
      const snippet = lines.slice(startLine - 1, endLine).join('\n');
      return snippet;
    }
  } catch (error) {
    logger.warning(`Failed to get content for ${filepath}: ${error}`);
  }

  return null;
}

/**
 * Post a review with line-specific comments
 */
export async function postPRReview(
  octokit: Octokit,
  prContext: PRContext,
  comments: LineComment[],
  summaryBody: string,
  logger: Logger,
  event: 'COMMENT' | 'REQUEST_CHANGES' = 'COMMENT',
): Promise<void> {
  logger.info(`Creating review with ${comments.length} line comments (event: ${event})`);

  const reviewParams = {
    owner: prContext.owner,
    repo: prContext.repo,
    pull_number: prContext.pullNumber,
    commit_id: prContext.headSha,
    event,
    body: summaryBody,
    ...(comments.length > 0
      ? {
          comments: comments.map(c => ({
            path: c.path,
            line: c.line,
            ...(c.start_line ? { start_line: c.start_line, start_side: 'RIGHT' } : {}),
            side: 'RIGHT' as const,
            body: c.body,
          })),
        }
      : {}),
  };

  try {
    await octokit.pulls.createReview(reviewParams);
    logger.info('Review posted successfully');
  } catch (error) {
    if (comments.length > 0) {
      // Line comments failed (e.g., lines not in diff) — retry as body-only review
      logger.warning(`Failed to post line comments: ${error}`);
      logger.info('Retrying as body-only review');
      await octokit.pulls.createReview({
        owner: prContext.owner,
        repo: prContext.repo,
        pull_number: prContext.pullNumber,
        commit_id: prContext.headSha,
        event,
        body: summaryBody,
      });
    } else {
      throw error;
    }
  }
}

/**
 * Marker prefix for Lien Review inline review comments.
 * Format: <!-- lien-review:filepath::symbolName -->
 */
export const COMMENT_MARKER_PREFIX = '<!-- lien-review:';

/**
 * Marker prefix for Lien Review logic review comments.
 * Format: <!-- lien-review-logic:filepath::line -->
 */
export const LOGIC_MARKER_PREFIX = '<!-- lien-review-logic:';

/** @deprecated Legacy prefix — kept for 6 months to recognize old PR comments */
export const LEGACY_COMMENT_MARKER_PREFIX = '<!-- veille:';

/** @deprecated Legacy prefix — kept for 6 months to recognize old PR comments */
export const LEGACY_LOGIC_MARKER_PREFIX = '<!-- veille-logic:';

/**
 * Parse a comment marker from a comment body, returning the dedup key or null.
 * Checks for the new `lien-review:` prefix first, then falls back to legacy `veille:`.
 */
export function parseCommentMarker(body: string): string | null {
  // Try new prefix first
  let start = body.indexOf(COMMENT_MARKER_PREFIX);
  let prefix = COMMENT_MARKER_PREFIX;
  if (start === -1) {
    // Fall back to legacy prefix
    start = body.indexOf(LEGACY_COMMENT_MARKER_PREFIX);
    prefix = LEGACY_COMMENT_MARKER_PREFIX;
  }
  if (start === -1) return null;
  const keyStart = start + prefix.length;
  const end = body.indexOf(' -->', keyStart);
  if (end === -1) return null;
  return body.slice(keyStart, end);
}

/**
 * Parse a logic marker from a comment body, returning the dedup key or null.
 * Checks for the new `lien-review-logic:` prefix first, then falls back to legacy `veille-logic:`.
 */
export function parseLogicMarker(body: string): string | null {
  // Try new prefix first
  let start = body.indexOf(LOGIC_MARKER_PREFIX);
  let prefix = LOGIC_MARKER_PREFIX;
  if (start === -1) {
    // Fall back to legacy prefix
    start = body.indexOf(LEGACY_LOGIC_MARKER_PREFIX);
    prefix = LEGACY_LOGIC_MARKER_PREFIX;
  }
  if (start === -1) return null;
  const keyStart = start + prefix.length;
  const end = body.indexOf(' -->', keyStart);
  if (end === -1) return null;
  return body.slice(keyStart, end);
}

/**
 * Fetch existing Lien Review inline comment keys from the PR.
 * Returns a Map of dedup keys → comment URLs for complexity comments
 * and a Set of logic keys (e.g. "filepath::line::category") for logic review comments.
 */
export async function getExistingCommentKeys(
  octokit: Octokit,
  prContext: PRContext,
  logger: Logger,
): Promise<{ complexity: Map<string, string>; logic: Set<string> }> {
  const complexity = new Map<string, string>();
  const logic = new Set<string>();

  const iterator = octokit.paginate.iterator(octokit.pulls.listReviewComments, {
    owner: prContext.owner,
    repo: prContext.repo,
    pull_number: prContext.pullNumber,
    per_page: 100,
  });

  for await (const response of iterator) {
    for (const comment of response.data) {
      if (!comment.body) continue;

      const complexityKey = parseCommentMarker(comment.body);
      if (complexityKey) {
        complexity.set(complexityKey, comment.html_url);
        continue;
      }

      const logicKey = parseLogicMarker(comment.body);
      if (logicKey) {
        logic.add(logicKey);
      }
    }
  }

  logger.info(
    `Found ${complexity.size} existing complexity comments and ${logic.size} logic comments`,
  );
  return { complexity, logic };
}

/**
 * Marker comments for the PR description stats badge
 */
const DESCRIPTION_START_MARKER = '<!-- lien-stats -->';
const DESCRIPTION_END_MARKER = '<!-- /lien-stats -->';

/**
 * Update the PR description with a stats badge
 * Appends or replaces the stats section at the bottom of the description
 */
export async function updatePRDescription(
  octokit: Octokit,
  prContext: PRContext,
  badgeMarkdown: string,
  logger: Logger,
): Promise<void> {
  try {
    // Get current PR
    const { data: pr } = await octokit.pulls.get({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
    });

    const currentBody = pr.body || '';
    const wrappedBadge = `${DESCRIPTION_START_MARKER}\n${badgeMarkdown}\n${DESCRIPTION_END_MARKER}`;

    let newBody: string;

    // Check if we already have a stats section
    const startIdx = currentBody.indexOf(DESCRIPTION_START_MARKER);
    const endIdx = currentBody.indexOf(DESCRIPTION_END_MARKER);

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      // Replace existing section
      newBody =
        currentBody.slice(0, startIdx) +
        wrappedBadge +
        currentBody.slice(endIdx + DESCRIPTION_END_MARKER.length);
      logger.info('Updating existing stats badge in PR description');
    } else {
      // Append to end
      newBody = currentBody.trim() + '\n\n---\n\n' + wrappedBadge;
      logger.info('Adding stats badge to PR description');
    }

    // Update the PR
    await octokit.pulls.update({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      body: newBody,
    });

    logger.info('PR description updated with complexity stats');
  } catch (error) {
    // Don't fail the action if we can't update the description
    logger.warning(`Failed to update PR description: ${error}`);
  }
}

/**
 * Parse unified diff patch to extract line numbers that can receive comments
 * Exported for testing
 */
export function parsePatchLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let currentLine = 0;

  for (const patchLine of patch.split('\n')) {
    // Hunk header: @@ -start,count +start,count @@
    const hunkMatch = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    // Added or context line (can have comments)
    if (patchLine.startsWith('+') || patchLine.startsWith(' ')) {
      if (!patchLine.startsWith('+++')) {
        lines.add(currentLine);
        currentLine++;
      }
    }
    // Deleted lines (-) don't increment currentLine
  }

  return lines;
}

/**
 * Get lines that are in the PR diff (only these can have line comments)
 * Handles pagination for PRs with 100+ files
 */
export async function getPRDiffLines(
  octokit: Octokit,
  prContext: PRContext,
): Promise<Map<string, Set<number>>> {
  const diffLines = new Map<string, Set<number>>();

  // Use pagination to handle PRs with 100+ files
  const iterator = octokit.paginate.iterator(octokit.pulls.listFiles, {
    owner: prContext.owner,
    repo: prContext.repo,
    pull_number: prContext.pullNumber,
    per_page: 100,
  });

  for await (const response of iterator) {
    for (const file of response.data) {
      if (!file.patch) continue;

      const lines = parsePatchLines(file.patch);
      if (lines.size > 0) {
        diffLines.set(file.filename, lines);
      }
    }
  }

  return diffLines;
}

/**
 * Result of getPRPatchData — combines diff lines with raw patch text
 */
export interface PRPatchData {
  diffLines: Map<string, Set<number>>;
  patches: Map<string, string>;
}

/**
 * Get both diff lines and raw patch text in a single API traversal.
 * More efficient than calling getPRDiffLines separately when patch data is also needed.
 */
export async function getPRPatchData(octokit: Octokit, prContext: PRContext): Promise<PRPatchData> {
  const diffLines = new Map<string, Set<number>>();
  const patches = new Map<string, string>();

  const iterator = octokit.paginate.iterator(octokit.pulls.listFiles, {
    owner: prContext.owner,
    repo: prContext.repo,
    pull_number: prContext.pullNumber,
    per_page: 100,
  });

  for await (const response of iterator) {
    for (const file of response.data) {
      if (!file.patch) continue;

      patches.set(file.filename, file.patch);
      const lines = parsePatchLines(file.patch);
      if (lines.size > 0) {
        diffLines.set(file.filename, lines);
      }
    }
  }

  return { diffLines, patches };
}

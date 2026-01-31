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

/**
 * Get list of files changed in the PR
 */
export async function getPRChangedFiles(
  octokit: Octokit,
  prContext: PRContext
): Promise<string[]> {
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
  logger: Logger
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
  prContext: PRContext
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
  logger: Logger
): Promise<string | null> {
  try {
    const response = await octokit.repos.getContent({
      owner: prContext.owner,
      repo: prContext.repo,
      path: filepath,
      ref: prContext.headSha,
    });

    if ('content' in response.data) {
      const content = Buffer.from(response.data.content as string, 'base64').toString(
        'utf-8'
      );
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
  logger: Logger
): Promise<void> {
  if (comments.length === 0) {
    // No line comments, just post summary as regular comment
    await postPRComment(octokit, prContext, summaryBody, logger);
    return;
  }

  logger.info(`Creating review with ${comments.length} line comments`);

  try {
    // Create a review with line comments
    await octokit.pulls.createReview({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      commit_id: prContext.headSha,
      event: 'COMMENT', // Don't approve or request changes, just comment
      body: summaryBody,
      comments: comments.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body,
      })),
    });

    logger.info('Review posted successfully');
  } catch (error) {
    // If line comments fail (e.g., lines not in diff), fall back to regular comment
    logger.warning(`Failed to post line comments: ${error}`);
    logger.info('Falling back to regular PR comment');
    await postPRComment(octokit, prContext, summaryBody, logger);
  }
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
  logger: Logger
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
  prContext: PRContext
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

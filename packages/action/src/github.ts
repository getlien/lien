/**
 * GitHub API helpers for the action
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import type { PRContext } from './types.js';

type Octokit = ReturnType<typeof github.getOctokit>;

/**
 * Get PR context from the GitHub event
 */
export function getPRContext(): PRContext | null {
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
    title: pr.title,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
  };
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
    const response = await octokit.rest.pulls.listFiles({
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
 * Post a comment on the PR
 */
export async function postPRComment(
  octokit: Octokit,
  prContext: PRContext,
  body: string
): Promise<void> {
  // Check for existing Lien comment to update instead of creating new
  const existingComment = await findExistingComment(octokit, prContext);

  if (existingComment) {
    core.info(`Updating existing comment ${existingComment.id}`);
    await octokit.rest.issues.updateComment({
      owner: prContext.owner,
      repo: prContext.repo,
      comment_id: existingComment.id,
      body,
    });
  } else {
    core.info('Creating new comment');
    await octokit.rest.issues.createComment({
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

  const comments = await octokit.rest.issues.listComments({
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
  endLine: number
): Promise<string | null> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner: prContext.owner,
      repo: prContext.repo,
      path: filepath,
      ref: prContext.headSha,
    });

    if ('content' in response.data) {
      const content = Buffer.from(response.data.content, 'base64').toString(
        'utf-8'
      );
      const lines = content.split('\n');
      // Line numbers are 1-based, array is 0-based
      const snippet = lines.slice(startLine - 1, endLine).join('\n');
      return snippet;
    }
  } catch (error) {
    core.warning(`Failed to get content for ${filepath}: ${error}`);
  }

  return null;
}

/**
 * Create an Octokit instance from token
 */
export function createOctokit(token: string): Octokit {
  return github.getOctokit(token);
}

/**
 * Line comment for PR review
 */
export interface LineComment {
  path: string;
  line: number;
  body: string;
}

/**
 * Post a review with line-specific comments
 */
export async function postPRReview(
  octokit: Octokit,
  prContext: PRContext,
  comments: LineComment[],
  summaryBody: string
): Promise<void> {
  if (comments.length === 0) {
    // No line comments, just post summary as regular comment
    await postPRComment(octokit, prContext, summaryBody);
    return;
  }

  core.info(`Creating review with ${comments.length} line comments`);

  try {
    // Create a review with line comments
    await octokit.rest.pulls.createReview({
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

    core.info('Review posted successfully');
  } catch (error) {
    // If line comments fail (e.g., lines not in diff), fall back to regular comment
    core.warning(`Failed to post line comments: ${error}`);
    core.info('Falling back to regular PR comment');
    await postPRComment(octokit, prContext, summaryBody);
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
  badgeMarkdown: string
): Promise<void> {
  try {
    // Get current PR
    const { data: pr } = await octokit.rest.pulls.get({
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
      core.info('Updating existing stats badge in PR description');
    } else {
      // Append to end
      newBody = currentBody.trim() + '\n\n---\n\n' + wrappedBadge;
      core.info('Adding stats badge to PR description');
    }

    // Update the PR
    await octokit.rest.pulls.update({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      body: newBody,
    });

    core.info('PR description updated with complexity stats');
  } catch (error) {
    // Don't fail the action if we can't update the description
    core.warning(`Failed to update PR description: ${error}`);
  }
}

/**
 * Marker to identify Lien review comments
 */
const LIEN_COMMENT_MARKER = '**Complexity:';

/**
 * Review thread info from GraphQL
 */
interface ReviewThread {
  id: string;
  isResolved: boolean;
  path: string;
  line: number | null;
  comments: {
    body: string;
  }[];
}

/**
 * Get all review threads for a PR using GraphQL
 */
async function getReviewThreads(
  octokit: Octokit,
  prContext: PRContext
): Promise<ReviewThread[]> {
  const query = `
    query($owner: String!, $repo: String!, $prNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $prNumber) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              path
              line
              comments(first: 1) {
                nodes {
                  body
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const result = await octokit.graphql<{
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: Array<{
              id: string;
              isResolved: boolean;
              path: string;
              line: number | null;
              comments: { nodes: Array<{ body: string }> };
            }>;
          };
        };
      };
    }>(query, {
      owner: prContext.owner,
      repo: prContext.repo,
      prNumber: prContext.pullNumber,
    });

    return result.repository.pullRequest.reviewThreads.nodes.map((node) => ({
      id: node.id,
      isResolved: node.isResolved,
      path: node.path,
      line: node.line,
      comments: node.comments.nodes.map((c) => ({ body: c.body })),
    }));
  } catch (error) {
    core.warning(`Failed to fetch review threads: ${error}`);
    return [];
  }
}

/**
 * Resolve a review thread using GraphQL
 */
async function resolveThread(octokit: Octokit, threadId: string): Promise<boolean> {
  const mutation = `
    mutation($threadId: ID!) {
      resolveReviewThread(input: { threadId: $threadId }) {
        thread {
          id
          isResolved
        }
      }
    }
  `;

  try {
    await octokit.graphql(mutation, { threadId });
    return true;
  } catch (error) {
    core.warning(`Failed to resolve thread ${threadId}: ${error}`);
    return false;
  }
}

/**
 * Extract violation key from a Lien comment body
 * Returns filepath::symbolName or null if not a Lien comment
 */
function extractViolationKeyFromComment(body: string, filepath: string): string | null {
  if (!body.includes(LIEN_COMMENT_MARKER)) return null;

  // Try to extract function name from the comment
  // Format: "🔴 **Complexity: 34** (+34 ⬆️) (threshold: 30)"
  // The function name is in the context, but we can use filepath + line as fallback
  // Better: look for function name pattern in the suggestion text
  
  // For now, use filepath as the key - we'll match by file
  return filepath;
}

/**
 * Auto-resolve review threads for violations that have been fixed.
 * Returns the count of resolved threads.
 */
export async function resolveFixedViolationThreads(
  octokit: Octokit,
  prContext: PRContext,
  currentViolationFiles: Set<string>
): Promise<number> {
  const threads = await getReviewThreads(octokit, prContext);
  let resolvedCount = 0;

  for (const thread of threads) {
    // Skip already resolved threads
    if (thread.isResolved) continue;

    // Check if this is a Lien complexity comment
    const firstComment = thread.comments[0]?.body || '';
    if (!firstComment.includes(LIEN_COMMENT_MARKER)) continue;

    // Check if the file still has violations
    // If the file no longer has violations, resolve the thread
    if (!currentViolationFiles.has(thread.path)) {
      core.info(`Resolving outdated thread for ${thread.path}:${thread.line} (violation fixed)`);
      const resolved = await resolveThread(octokit, thread.id);
      if (resolved) resolvedCount++;
    }
  }

  if (resolvedCount > 0) {
    core.info(`✓ Auto-resolved ${resolvedCount} outdated review thread(s)`);
  }

  return resolvedCount;
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
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.listFiles, {
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


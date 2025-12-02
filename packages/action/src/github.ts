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


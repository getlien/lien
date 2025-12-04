/**
 * GitHub API helpers for the action
 */
import * as github from '@actions/github';
import type { PRContext } from './types.js';
type Octokit = ReturnType<typeof github.getOctokit>;
/**
 * Get PR context from the GitHub event
 */
export declare function getPRContext(): PRContext | null;
/**
 * Get list of files changed in the PR
 */
export declare function getPRChangedFiles(octokit: Octokit, prContext: PRContext): Promise<string[]>;
/**
 * Post a comment on the PR
 */
export declare function postPRComment(octokit: Octokit, prContext: PRContext, body: string): Promise<void>;
/**
 * Get code snippet from a file at a specific commit
 */
export declare function getFileContent(octokit: Octokit, prContext: PRContext, filepath: string, startLine: number, endLine: number): Promise<string | null>;
/**
 * Create an Octokit instance from token
 */
export declare function createOctokit(token: string): Octokit;
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
export declare function postPRReview(octokit: Octokit, prContext: PRContext, comments: LineComment[], summaryBody: string): Promise<void>;
/**
 * Update the PR description with a stats badge
 * Appends or replaces the stats section at the bottom of the description
 */
export declare function updatePRDescription(octokit: Octokit, prContext: PRContext, badgeMarkdown: string): Promise<void>;
/**
 * Auto-resolve review threads for violations that have been fixed.
 * Returns the count of resolved threads.
 *
 * Note: This requires the GitHub token to have permission to resolve threads.
 * The default GITHUB_TOKEN may not have this permission in all cases.
 * If resolution fails, threads will remain open but the action continues.
 */
export declare function resolveFixedViolationThreads(octokit: Octokit, prContext: PRContext, currentViolationFiles: Set<string>): Promise<number>;
/**
 * Parse unified diff patch to extract line numbers that can receive comments
 * Exported for testing
 */
export declare function parsePatchLines(patch: string): Set<number>;
/**
 * Get lines that are in the PR diff (only these can have line comments)
 * Handles pagination for PRs with 100+ files
 */
export declare function getPRDiffLines(octokit: Octokit, prContext: PRContext): Promise<Map<string, Set<number>>>;
export {};

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
export {};

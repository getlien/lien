/**
 * Shared types for the review package
 */

export type { ComplexityReport, ComplexityViolation } from '@liendev/core';

/**
 * PR context for review — the minimum info needed to post a review
 */
export interface PRContext {
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  baseSha: string;
  headSha: string;
}

export type ReviewStyle = 'line' | 'summary';

/**
 * Configuration for a review run
 */
export interface ReviewConfig {
  openrouterApiKey: string;
  model: string;
  threshold: string;
  reviewStyle: ReviewStyle;
  enableDeltaTracking: boolean;
  baselineComplexityPath: string;
  /** Post REQUEST_CHANGES instead of COMMENT when new error-level violations are found */
  blockOnNewErrors: boolean;
}

/**
 * Line comment for PR review
 */
export interface LineComment {
  path: string;
  line: number;
  body: string;
}

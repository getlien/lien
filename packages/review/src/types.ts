/**
 * Shared types for the review package
 */

export type { ComplexityReport, ComplexityViolation } from '@liendev/parser';

/**
 * PR context for review — the minimum info needed to post a review
 */
export interface PRContext {
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  /** PR description body (markdown). Optional — may be absent in CLI mode or empty PRs. */
  body?: string;
  baseSha: string;
  headSha: string;
}

/**
 * Configuration for a review run
 */
export interface ReviewConfig {
  openrouterApiKey: string;
  model: string;
  threshold: string;
  enableDeltaTracking: boolean;
  baselineComplexityPath: string;
  /** Post REQUEST_CHANGES instead of COMMENT when new error-level violations are found */
  blockOnNewErrors: boolean;
  /** Architectural review mode: "auto" | "always" | "off" */
  enableArchitecturalReview: 'auto' | 'always' | 'off';
  /** Architectural review categories to enable */
  archReviewCategories: string[];
}

/**
 * Line comment for PR review
 */
export interface LineComment {
  path: string;
  line: number;
  start_line?: number;
  body: string;
}

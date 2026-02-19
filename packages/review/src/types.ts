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
  /** Enable AST-powered logic review (beta) */
  enableLogicReview: boolean;
  /** Finding categories to enable */
  logicReviewCategories: string[];
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

/**
 * A logic review finding backed by AST evidence
 */
export interface LogicFinding {
  filepath: string;
  symbolName: string;
  line: number;
  category: 'breaking_change' | 'unchecked_return' | 'missing_tests';
  severity: 'error' | 'warning';
  message: string;
  evidence: string;
}

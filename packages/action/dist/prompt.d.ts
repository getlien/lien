/**
 * Prompt builder for AI code review
 */
import type { ComplexityReport, ComplexityViolation, PRContext } from './types.js';
/**
 * Build the review prompt from complexity report
 */
export declare function buildReviewPrompt(report: ComplexityReport, prContext: PRContext, codeSnippets: Map<string, string>): string;
/**
 * Build a minimal prompt when there are no violations
 */
export declare function buildNoViolationsMessage(prContext: PRContext): string;
/**
 * Format the AI review as a GitHub comment
 */
export declare function formatReviewComment(aiReview: string, report: ComplexityReport): string;
/**
 * Get the key for a violation (for code snippet mapping)
 */
export declare function getViolationKey(violation: ComplexityViolation): string;
/**
 * Build a prompt for generating a single line comment for a violation
 */
export declare function buildLineCommentPrompt(violation: ComplexityViolation, codeSnippet: string | null): string;
/**
 * Build a summary comment when using line-specific reviews
 */
export declare function buildLineSummaryComment(report: ComplexityReport, prContext: PRContext): string;

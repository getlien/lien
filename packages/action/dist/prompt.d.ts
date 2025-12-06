/**
 * Prompt builder for AI code review
 */
import type { ComplexityReport, ComplexityViolation, PRContext, ComplexityDelta, DeltaSummary } from './types.js';
/**
 * Build the review prompt from complexity report
 */
export declare function buildReviewPrompt(report: ComplexityReport, prContext: PRContext, codeSnippets: Map<string, string>, deltas?: ComplexityDelta[] | null): string;
/**
 * Build a minimal prompt when there are no violations
 */
export declare function buildNoViolationsMessage(prContext: PRContext, deltas?: ComplexityDelta[] | null): string;
/**
 * Token usage info for display
 */
export interface TokenUsageInfo {
    totalTokens: number;
    cost: number;
}
/**
 * Format the AI review as a GitHub comment
 */
export declare function formatReviewComment(aiReview: string, report: ComplexityReport, isFallback?: boolean, tokenUsage?: TokenUsageInfo, deltaSummary?: DeltaSummary | null): string;
/**
 * Get the key for a violation (for code snippet mapping)
 */
export declare function getViolationKey(violation: ComplexityViolation): string;
/**
 * Build the PR description stats badge
 * Human-friendly summary with technical details collapsed
 */
export declare function buildDescriptionBadge(report: ComplexityReport | null, deltaSummary: DeltaSummary | null): string;
/**
 * Build a prompt for generating a single line comment for a violation
 */
export declare function buildLineCommentPrompt(violation: ComplexityViolation, codeSnippet: string | null): string;
/**
 * Build a summary comment when using line-specific reviews
 */
export declare function buildLineSummaryComment(report: ComplexityReport, prContext: PRContext): string;
/**
 * Build a batched prompt for generating multiple line comments at once
 * This is more efficient than individual prompts as:
 * - System prompt only sent once
 * - AI has full context of all violations
 * - Fewer API calls = faster + cheaper
 */
export declare function buildBatchedCommentsPrompt(violations: ComplexityViolation[], codeSnippets: Map<string, string>): string;

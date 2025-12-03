/**
 * OpenRouter API client for LLM access
 */
import type { ComplexityViolation } from './types.js';
/**
 * Token usage tracking
 */
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
}
/**
 * Reset token usage (call at start of review)
 */
export declare function resetTokenUsage(): void;
/**
 * Get current token usage
 */
export declare function getTokenUsage(): TokenUsage;
/**
 * Parse JSON comments response from AI, handling markdown code blocks
 * Returns null if parsing fails after retry attempts
 * Exported for testing
 */
export declare function parseCommentsResponse(content: string): Record<string, string> | null;
/**
 * Generate an AI review using OpenRouter
 */
export declare function generateReview(prompt: string, apiKey: string, model: string): Promise<string>;
/**
 * Map parsed comments to violations, with fallback for missing comments
 * Exported for testing
 */
export declare function mapCommentsToViolations(commentsMap: Record<string, string> | null, violations: ComplexityViolation[]): Map<ComplexityViolation, string>;
/**
 * Generate line comments for multiple violations in a single API call
 *
 * This is more efficient than individual calls:
 * - System prompt only sent once (saves ~100 tokens per violation)
 * - AI has full context of all violations (can identify patterns)
 * - Single API call = faster execution
 */
export declare function generateLineComments(violations: ComplexityViolation[], codeSnippets: Map<string, string>, apiKey: string, model: string): Promise<Map<ComplexityViolation, string>>;

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
    estimatedCost: number;
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
 * Generate an AI review using OpenRouter
 */
export declare function generateReview(prompt: string, apiKey: string, model: string): Promise<string>;
/**
 * Generate a brief comment for a single violation
 */
export declare function generateLineComment(violation: ComplexityViolation, codeSnippet: string | null, apiKey: string, model: string): Promise<string>;
/**
 * Generate line comments for multiple violations in parallel
 */
export declare function generateLineComments(violations: ComplexityViolation[], codeSnippets: Map<string, string>, apiKey: string, model: string): Promise<Map<ComplexityViolation, string>>;

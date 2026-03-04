/**
 * Pure JSON / string-processing helpers shared across the review package.
 * Extracted from llm-client.ts to decouple string utilities from the HTTP client.
 */

/**
 * Extract JSON content from an LLM response that may be wrapped in markdown code blocks.
 * Returns the trimmed content inside the first code block, or the original content if none found.
 */
export function extractJSONFromCodeBlock(content: string): string {
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (codeBlockMatch ? codeBlockMatch[1] : content).trim();
}

/**
 * Estimate prompt token count using ~4 chars/token heuristic.
 */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

/**
 * Truncate a string to fit within a token budget, preserving whole lines where possible.
 * Returns the truncated string with an optional suffix appended when truncation occurs.
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
  suffix = '... (truncated)',
): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;

  const truncated = text.slice(0, maxChars - suffix.length);
  const lastNewline = truncated.lastIndexOf('\n');
  return (lastNewline > maxChars * 0.8 ? truncated.slice(0, lastNewline) : truncated) + suffix;
}

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
export function estimatePromptTokens(prompt: string, systemPrompt?: string): number {
  const total = prompt.length + (systemPrompt?.length || 0);
  return Math.ceil(total / 4);
}

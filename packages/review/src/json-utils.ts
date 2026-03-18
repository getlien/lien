/**
 * Pure JSON / string-processing helpers shared across the review package.
 * Extracted from llm-client.ts to decouple string utilities from the HTTP client.
 */

/**
 * Extract JSON content from an LLM response that may be wrapped in markdown code blocks.
 *
 * Prefers a ```json-tagged block over an untagged one, since LLMs sometimes
 * emit explanatory code blocks before the actual JSON payload.
 * Falls back to the first untagged code block, then the raw content.
 */
export function extractJSONFromCodeBlock(content: string): string {
  // Prefer explicitly tagged ```json blocks
  const jsonTaggedMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (jsonTaggedMatch) return jsonTaggedMatch[1].trim();

  // Fall back to any code block
  const codeBlockMatch = content.match(/```\s*([\s\S]*?)```/);
  return (codeBlockMatch ? codeBlockMatch[1] : content).trim();
}

/**
 * Estimate prompt token count using ~4 chars/token heuristic.
 */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

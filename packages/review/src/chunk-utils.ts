/**
 * Shared utilities for working with CodeChunks.
 */

import type { CodeChunk } from '@liendev/parser';

/**
 * Build a map of chunk key -> content for suppression checks and code snippets.
 * Key format: "filepath::symbolName"
 */
export function buildChunkSnippetsMap(chunks: CodeChunk[]): Map<string, string> {
  const snippets = new Map<string, string>();
  for (const chunk of chunks) {
    if (chunk.metadata.symbolName) {
      snippets.set(`${chunk.metadata.file}::${chunk.metadata.symbolName}`, chunk.content);
    }
  }
  return snippets;
}

/**
 * Format a chunk's complexity for display in review output.
 */
export function formatChunkComplexity(chunk: CodeChunk): string {
  const complexity = chunk.metadata.complexity ?? 0;

  // Format as time — same logic as formatTime in format.ts
  const minutes = Math.round(complexity);
  let timeStr: string;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    timeStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  } else {
    timeStr = `${minutes}m`;
  }

  const name = chunk.metadata.symbolName ?? 'unknown';
  return `${name}: ${timeStr} (${complexity})`;
}

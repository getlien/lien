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
 * Format a chunk's complexity as a time estimate for display.
 */
export function formatChunkTime(chunk: CodeChunk): string {
  const minutes = Math.round(chunk.metadata.complexity ?? 0);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/**
 * Get a summary line for a chunk.
 */
export function getChunkSummary(chunk: CodeChunk): string {
  const name = chunk.metadata.symbolName ?? 'unknown';
  const time = formatChunkTime(chunk);
  return `${name}: ${time}`;
}

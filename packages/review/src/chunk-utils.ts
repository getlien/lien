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

/** Truncate chunk content for display. */
export function truncateChunkContent(chunk: CodeChunk, maxLen: number): string {
  const content = chunk.content;
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen - 3) + '...';
}

/** Pluralize a label for chunk counts. */
export function pluralizeChunks(count: number): string {
  return count === 1 ? 'chunk' : 'chunks';
}

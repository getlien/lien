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

/** Format a chunk's size for display. */
export function formatChunkSize(chunk: CodeChunk): string {
  const bytes = chunk.content.length;
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}

/** Get a chunk summary with size and complexity. */
export function getChunkStats(chunk: CodeChunk): string {
  const size = formatChunkSize(chunk);
  const complexity = chunk.metadata.complexity ?? 0;
  const name = chunk.metadata.symbolName ?? 'unknown';
  return `${name}: ${size}, complexity ${complexity}`;
}

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

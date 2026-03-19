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

/** Validate chunk count is within bounds. */
export function validateChunkCount(value: unknown): number {
  const num = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (isNaN(num) || num < 1 || !Number.isInteger(num)) {
    throw new Error(`Chunk count must be a positive integer, got: ${value}`);
  }
  return num;
}

import type { SearchResult, ChunkMetadata } from '@liendev/core';

/**
 * Tool names that support metadata shaping.
 * get_dependents and get_complexity use their own response formats.
 */
export type ToolName =
  | 'semantic_search'
  | 'find_similar'
  | 'get_files_context'
  | 'list_functions'
  | 'get_complexity';

/**
 * Per-tool allowlists for metadata fields.
 *
 * The full metadata stays in the index; only the JSON response
 * to the AI assistant is trimmed to reduce context window usage.
 */
const FIELD_ALLOWLISTS: Record<ToolName, ReadonlySet<string>> = {
  semantic_search: new Set([
    'file', 'startLine', 'endLine', 'language', 'type',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'parameters', 'exports', 'repoId',
  ]),
  find_similar: new Set([
    'file', 'startLine', 'endLine', 'language', 'type',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'parameters', 'exports',
  ]),
  get_files_context: new Set([
    'file', 'startLine', 'endLine', 'language', 'type',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'parameters', 'exports',
    'imports', 'importedSymbols', 'callSites',
  ]),
  list_functions: new Set([
    'file', 'startLine', 'endLine', 'language', 'type',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'parameters', 'exports', 'symbols',
  ]),
  get_complexity: new Set([
    'file', 'startLine', 'endLine', 'language',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'complexity', 'cognitiveComplexity',
    'halsteadVolume', 'halsteadDifficulty', 'halsteadEffort', 'halsteadBugs',
  ]),
};

/**
 * Deduplicate results by file + startLine + endLine.
 * Keeps the first occurrence (highest ranked) of each unique chunk.
 */
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter(r => {
    const key = `${r.metadata.file}:${r.metadata.startLine}-${r.metadata.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Shape a single result's metadata by keeping only allowed fields for the tool.
 */
export function shapeResultMetadata(result: SearchResult, tool: ToolName): SearchResult {
  const allowlist = FIELD_ALLOWLISTS[tool];
  const shaped: Partial<ChunkMetadata> = {};

  for (const key of Object.keys(result.metadata)) {
    if (allowlist.has(key)) {
      (shaped as any)[key] = (result.metadata as any)[key];
    }
  }

  return {
    content: result.content,
    metadata: shaped as ChunkMetadata,
    score: result.score,
    relevance: result.relevance,
  };
}

/**
 * Shape an array of results for a specific tool.
 */
export function shapeResults(results: SearchResult[], tool: ToolName): SearchResult[] {
  return results.map(r => shapeResultMetadata(r, tool));
}

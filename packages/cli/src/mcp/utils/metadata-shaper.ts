import type { SearchResult, ChunkMetadata, RelevanceCategory } from '@liendev/core';

/**
 * Tool names that support metadata shaping.
 * get_dependents uses its own response format.
 */
export type ToolName =
  | 'semantic_search'
  | 'find_similar'
  | 'get_files_context'
  | 'list_functions'
  | 'get_complexity';

/**
 * Slim metadata included in MCP tool responses.
 * All fields beyond file/startLine/endLine are optional because each
 * tool includes a different subset. This is intentionally separate from
 * ChunkMetadata — it represents the shaped output, not the full indexed data.
 */
export interface ToolResultMetadata {
  file: string;
  startLine: number;
  endLine: number;
  language?: string;
  type?: ChunkMetadata['type'];
  symbolName?: string;
  symbolType?: string;
  signature?: string;
  parentClass?: string;
  parameters?: string[];
  exports?: string[];
  imports?: string[];
  importedSymbols?: Record<string, string[]>;
  callSites?: Array<{ symbol: string; line: number }>;
  symbols?: { functions: string[]; classes: string[]; interfaces: string[] };
  complexity?: number;
  cognitiveComplexity?: number;
  halsteadVolume?: number;
  halsteadDifficulty?: number;
  halsteadEffort?: number;
  halsteadBugs?: number;
  repoId?: string;
}

/**
 * A shaped search result for MCP tool responses.
 * Contains only the fields relevant to the tool's purpose.
 */
export interface ToolResult {
  content: string;
  metadata: ToolResultMetadata;
  score: number;
  relevance: RelevanceCategory;
}

/**
 * Per-tool allowlists for metadata fields.
 *
 * The full metadata stays in the index; only the JSON response
 * to the AI assistant is trimmed to reduce context window usage.
 */
const FIELD_ALLOWLISTS: Record<ToolName, ReadonlySet<keyof ChunkMetadata>> = {
  semantic_search: new Set<keyof ChunkMetadata>([
    'file', 'startLine', 'endLine', 'language', 'type',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'parameters', 'exports', 'repoId',
  ]),
  find_similar: new Set<keyof ChunkMetadata>([
    'file', 'startLine', 'endLine', 'language', 'type',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'parameters', 'exports',
  ]),
  get_files_context: new Set<keyof ChunkMetadata>([
    'file', 'startLine', 'endLine', 'language', 'type',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'parameters', 'exports',
    'imports', 'importedSymbols', 'callSites',
  ]),
  list_functions: new Set<keyof ChunkMetadata>([
    'file', 'startLine', 'endLine', 'language', 'type',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'parameters', 'exports', 'symbols',
  ]),
  get_complexity: new Set<keyof ChunkMetadata>([
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
 * Pick allowed fields from metadata based on tool-specific allowlist.
 */
function pickMetadata(
  metadata: ChunkMetadata,
  allowlist: ReadonlySet<keyof ChunkMetadata>
): ToolResultMetadata {
  const result: Partial<ToolResultMetadata> = {};
  for (const key of allowlist) {
    if (metadata[key] !== undefined) {
      // Safe: allowlist keys are keyof ChunkMetadata, and ToolResultMetadata
      // mirrors those same fields with compatible (or wider) types.
      (result as Record<string, unknown>)[key] = metadata[key];
    }
  }
  // The allowlist always includes file, startLine, endLine so these are set.
  return result as ToolResultMetadata;
}

/**
 * Shape a single result's metadata by keeping only allowed fields for the tool.
 */
export function shapeResultMetadata(result: SearchResult, tool: ToolName): ToolResult {
  return {
    content: result.content,
    metadata: pickMetadata(result.metadata, FIELD_ALLOWLISTS[tool]),
    score: result.score,
    relevance: result.relevance,
  };
}

/**
 * Shape an array of results for a specific tool.
 */
export function shapeResults(results: SearchResult[], tool: ToolName): ToolResult[] {
  return results.map(r => shapeResultMetadata(r, tool));
}

import type { SearchResult, ChunkMetadata, RelevanceCategory } from '@liendev/core';

/**
 * Tool names that support metadata shaping.
 * get_dependents and get_complexity use their own response formats.
 */
export type ToolName =
  | 'semantic_search'
  | 'find_similar'
  | 'get_files_context'
  | 'list_functions';

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
  symbolType?: ChunkMetadata['symbolType'];
  signature?: string;
  parentClass?: string;
  parameters?: string[];
  exports?: string[];
  imports?: string[];
  importedSymbols?: Record<string, string[]>;
  callSites?: Array<{ symbol: string; line: number }>;
  symbols?: { functions: string[]; classes: string[]; interfaces: string[] };
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
 * Keys that exist on both ChunkMetadata (source) and ToolResultMetadata (output).
 * Allowlists are typed against this intersection so adding a key that doesn't
 * exist on both sides is a compile error.
 */
type AllowlistKey = keyof ChunkMetadata & keyof ToolResultMetadata;

/**
 * Per-tool allowlists for optional metadata fields.
 * Required fields (file, startLine, endLine) are always included by pickMetadata.
 *
 * The full metadata stays in the index; only the JSON response
 * to the AI assistant is trimmed to reduce context window usage.
 */
const FIELD_ALLOWLISTS: Record<ToolName, ReadonlySet<AllowlistKey>> = {
  semantic_search: new Set<AllowlistKey>([
    'language', 'type',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'parameters', 'exports', 'repoId',
  ]),
  find_similar: new Set<AllowlistKey>([
    'language', 'type',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'parameters', 'exports',
  ]),
  get_files_context: new Set<AllowlistKey>([
    'language', 'type',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'parameters', 'exports',
    'imports', 'importedSymbols', 'callSites', 'symbols',
  ]),
  list_functions: new Set<AllowlistKey>([
    'language', 'type',
    'symbolName', 'symbolType', 'signature', 'parentClass',
    'parameters', 'exports', 'symbols',
  ]),
};

/**
 * Deduplicate results by repoId + file + startLine + endLine.
 * Keeps the first occurrence (highest ranked) of each unique chunk.
 * Includes repoId so cross-repo searches don't collapse results from
 * different repos that share the same relative path and line range.
 */
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter(r => {
    const key = JSON.stringify([r.metadata.repoId ?? '', r.metadata.file, r.metadata.startLine, r.metadata.endLine]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Pick allowed fields from metadata based on tool-specific allowlist.
 * Required fields (file, startLine, endLine) are always set explicitly.
 */
/**
 * Clean a metadata value by stripping empty strings.
 * Returns null if the value should be omitted entirely.
 */
function cleanMetadataValue(key: string, value: unknown): unknown | null {
  if (value === undefined || value === '') return null;

  if (Array.isArray(value)) {
    const filtered = value.filter((v: unknown) => v !== '');
    return filtered.length > 0 ? filtered : null;
  }

  if (key === 'symbols' && typeof value === 'object' && value !== null) {
    const symbols = value as { functions: string[]; classes: string[]; interfaces: string[] };
    const filtered = {
      functions: symbols.functions.filter(s => s !== ''),
      classes: symbols.classes.filter(s => s !== ''),
      interfaces: symbols.interfaces.filter(s => s !== ''),
    };
    const hasAny = filtered.functions.length > 0 || filtered.classes.length > 0 || filtered.interfaces.length > 0;
    return hasAny ? filtered : null;
  }

  return value;
}

/**
 * Pick allowed fields from metadata based on tool-specific allowlist.
 * Required fields (file, startLine, endLine) are always set explicitly.
 */
function pickMetadata(
  metadata: ChunkMetadata,
  allowlist: ReadonlySet<AllowlistKey>
): ToolResultMetadata {
  const result: ToolResultMetadata = {
    file: metadata.file,
    startLine: metadata.startLine,
    endLine: metadata.endLine,
  };

  // Cast needed to assign dynamic keys from the allowlist.
  // Safe: all allowlist keys are validated as AllowlistKey (keyof both types).
  const out = result as unknown as Record<string, unknown>;
  for (const key of allowlist) {
    if (key === 'file' || key === 'startLine' || key === 'endLine') continue;
    const cleaned = cleanMetadataValue(key, metadata[key]);
    if (cleaned !== null) {
      out[key] = cleaned;
    }
  }

  return result;
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

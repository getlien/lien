import { normalizeToRelativePath } from '@liendev/core';
import type { SearchResult, RelevanceCategory } from '@liendev/core';

/**
 * Tool names that support metadata shaping.
 * get_dependents and get_complexity use their own response formats.
 */
export type ToolName = 'search_code' | 'find_similar' | 'get_files_context' | 'list_functions';

/** The shape `pickMetadata` reads from — SearchResult's metadata (ChunkMetadata
 * plus the search-path-only additions like dependentCount). Aliased so this
 * file has one source of truth instead of re-declaring ChunkMetadata fields. */
type SourceMetadata = SearchResult['metadata'];

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
  type?: SourceMetadata['type'];
  symbolName?: string;
  symbolType?: SourceMetadata['symbolType'];
  signature?: string;
  parentClass?: string;
  parameters?: string[];
  exports?: string[];
  imports?: string[];
  importedSymbols?: Record<string, string[]>;
  callSites?: Array<{ symbol: string; line: number }>;
  symbols?: { functions: string[]; classes: string[]; interfaces: string[] };
  enclosingSymbol?: string;
  /**
   * How many other indexed files import this chunk's file — see
   * core's vectordb/sqlite/dependent-counts.ts. Only ever populated for
   * search_code (the FTS `search` path); other tools' SearchResults don't
   * carry it, so their allowlists don't include this key.
   */
  dependentCount?: number;
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
 * Keys that exist on both SourceMetadata (source) and ToolResultMetadata (output).
 * Allowlists are typed against this intersection so adding a key that doesn't
 * exist on both sides is a compile error.
 */
type AllowlistKey = keyof SourceMetadata & keyof ToolResultMetadata;

/**
 * Per-tool allowlists for optional metadata fields.
 * Required fields (file, startLine, endLine) are always included by pickMetadata.
 *
 * The full metadata stays in the index; only the JSON response
 * to the AI assistant is trimmed to reduce context window usage.
 */
const FIELD_ALLOWLISTS: Record<ToolName, ReadonlySet<AllowlistKey>> = {
  search_code: new Set<AllowlistKey>([
    'language',
    'type',
    'symbolName',
    'symbolType',
    'signature',
    'parentClass',
    'parameters',
    'exports',
    'dependentCount',
  ]),
  find_similar: new Set<AllowlistKey>([
    'language',
    'type',
    'symbolName',
    'symbolType',
    'signature',
    'parentClass',
    'parameters',
    'exports',
  ]),
  get_files_context: new Set<AllowlistKey>([
    'language',
    'type',
    'symbolName',
    'symbolType',
    'signature',
    'parentClass',
    'parameters',
    'exports',
    'imports',
    'importedSymbols',
    'callSites',
    'symbols',
  ]),
  list_functions: new Set<AllowlistKey>([
    'language',
    'type',
    'symbolName',
    'symbolType',
    'signature',
    'parentClass',
    'parameters',
    'exports',
    'symbols',
  ]),
};

/**
 * Deduplicate results by file + startLine + endLine.
 * Keeps the first occurrence (highest ranked) of each unique chunk.
 */
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter(r => {
    const key = JSON.stringify([
      r.metadata.file ? normalizeToRelativePath(r.metadata.file) : '',
      r.metadata.startLine,
      r.metadata.endLine,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
    const symbols = value as Record<string, unknown>;
    const filterArr = (arr: unknown): string[] =>
      Array.isArray(arr) ? arr.filter((s: unknown) => s !== '') : [];
    const filtered = {
      functions: filterArr(symbols.functions),
      classes: filterArr(symbols.classes),
      interfaces: filterArr(symbols.interfaces),
    };
    const hasAny =
      filtered.functions.length > 0 ||
      filtered.classes.length > 0 ||
      filtered.interfaces.length > 0;
    return hasAny ? filtered : null;
  }

  return value;
}

/**
 * Pick allowed fields from metadata based on tool-specific allowlist.
 * Required fields (file, startLine, endLine) are always set explicitly.
 */
function pickMetadata(
  metadata: SourceMetadata,
  allowlist: ReadonlySet<AllowlistKey>,
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

  // Derive enclosingSymbol from parentClass + symbolName
  if (metadata.symbolName) {
    out['enclosingSymbol'] = metadata.parentClass
      ? `${metadata.parentClass}.${metadata.symbolName}`
      : metadata.symbolName;
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

import type { ChunkMetadata } from '@liendev/parser';
import type { SearchResult } from '../types.js';
import { hasValidStringEntries } from '../filters.js';

/**
 * A parsed structural row: scalars coerced, JSON columns deserialized to real
 * JS values. Structurally satisfies `FilterableRecord`, so the shared filters
 * in filters.ts operate on it directly.
 */
export interface SqliteChunkRecord {
  file: string;
  startLine: number;
  endLine: number;
  type: string;
  language: string;
  symbolName: string;
  symbolType: string;
  parentClass: string;
  signature: string;
  complexity: number;
  cognitiveComplexity: number;
  halsteadVolume: number;
  halsteadDifficulty: number;
  halsteadEffort: number;
  halsteadBugs: number;
  content: string;
  functionNames: string[];
  classNames: string[];
  interfaceNames: string[];
  parameters: string[];
  imports: string[];
  exports: string[];
  importedSymbols?: Record<string, string[]>;
  callSites?: Array<{ symbol: string; line: number; isResultCaptured?: boolean }>;
}

/** The row object bound to the INSERT prepared statement (keys = CHUNK_COLUMNS). */
export type ChunkInsertRow = Record<string, string | number>;

/**
 * Split an identifier into space-separated lowercase tokens on camelCase
 * boundaries, digit boundaries, `_` and `-`. Feeds the FTS `symbolTokens`
 * column so a porter/unicode61 keyword search matches inside identifiers
 * (e.g. 'parse' finds `parseImportStatement`). '' when there's no symbol.
 */
export function deriveSymbolTokens(symbolName: string): string {
  if (!symbolName) return '';
  const spaced = symbolName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2');
  return spaced
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(t => t.toLowerCase())
    .join(' ');
}

/**
 * Serialize a chunk (content + metadata) to a flat insert row. Stores real
 * empties (`[]` / `{}` / `''` / `0`) — no Arrow placeholders.
 *
 * `returnType` is not persisted (parser/src/types.ts) — the round-trip stays
 * intentionally lossy.
 */
export function chunkToRow(content: string, metadata: ChunkMetadata): ChunkInsertRow {
  const symbolName = metadata.symbolName || '';
  return {
    file: metadata.file,
    startLine: metadata.startLine ?? 0,
    endLine: metadata.endLine ?? 0,
    type: metadata.type ?? '',
    language: metadata.language ?? '',
    symbolName,
    symbolType: metadata.symbolType || '',
    parentClass: metadata.parentClass || '',
    signature: metadata.signature || '',
    symbolTokens: deriveSymbolTokens(symbolName),
    complexity: metadata.complexity || 0,
    cognitiveComplexity: metadata.cognitiveComplexity || 0,
    halsteadVolume: metadata.halsteadVolume || 0,
    halsteadDifficulty: metadata.halsteadDifficulty || 0,
    halsteadEffort: metadata.halsteadEffort || 0,
    halsteadBugs: metadata.halsteadBugs || 0,
    content: content ?? '',
    functionNames: JSON.stringify(metadata.symbols?.functions ?? []),
    classNames: JSON.stringify(metadata.symbols?.classes ?? []),
    interfaceNames: JSON.stringify(metadata.symbols?.interfaces ?? []),
    parameters: JSON.stringify(metadata.parameters ?? []),
    imports: JSON.stringify(metadata.imports ?? []),
    exports: JSON.stringify(metadata.exports ?? []),
    importedSymbols: JSON.stringify(metadata.importedSymbols ?? {}),
    callSites: JSON.stringify(metadata.callSites ?? []),
  };
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseImportedSymbols(value: unknown): Record<string, string[]> | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length > 0 &&
      Object.values(parsed).every(v => Array.isArray(v) && v.every(s => typeof s === 'string'))
    ) {
      return parsed as Record<string, string[]>;
    }
  } catch {
    // fall through
  }
  return undefined;
}

function parseCallSites(
  value: unknown,
): Array<{ symbol: string; line: number; isResultCaptured?: boolean }> | undefined {
  if (typeof value !== 'string') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  // line > 0 drops the missing-data sentinel (0).
  const result = parsed
    .filter(
      (c): c is { symbol: string; line: number; isResultCaptured?: boolean } =>
        c && typeof c.symbol === 'string' && typeof c.line === 'number' && c.line > 0,
    )
    .map(c =>
      typeof c.isResultCaptured === 'boolean'
        ? { symbol: c.symbol, line: c.line, isResultCaptured: c.isResultCaptured }
        : { symbol: c.symbol, line: c.line },
    );
  return result.length > 0 ? result : undefined;
}

/** Parse a raw better-sqlite3 row into a normalized structural record. */
export function parseRow(raw: Record<string, unknown>): SqliteChunkRecord {
  return {
    file: (raw.file as string) ?? '',
    startLine: (raw.startLine as number) ?? 0,
    endLine: (raw.endLine as number) ?? 0,
    type: (raw.type as string) ?? '',
    language: (raw.language as string) ?? '',
    symbolName: (raw.symbolName as string) ?? '',
    symbolType: (raw.symbolType as string) ?? '',
    parentClass: (raw.parentClass as string) ?? '',
    signature: (raw.signature as string) ?? '',
    complexity: (raw.complexity as number) ?? 0,
    cognitiveComplexity: (raw.cognitiveComplexity as number) ?? 0,
    halsteadVolume: (raw.halsteadVolume as number) ?? 0,
    halsteadDifficulty: (raw.halsteadDifficulty as number) ?? 0,
    halsteadEffort: (raw.halsteadEffort as number) ?? 0,
    halsteadBugs: (raw.halsteadBugs as number) ?? 0,
    content: (raw.content as string) ?? '',
    functionNames: parseJsonArray(raw.functionNames),
    classNames: parseJsonArray(raw.classNames),
    interfaceNames: parseJsonArray(raw.interfaceNames),
    parameters: parseJsonArray(raw.parameters),
    imports: parseJsonArray(raw.imports),
    exports: parseJsonArray(raw.exports),
    importedSymbols: parseImportedSymbols(raw.importedSymbols),
    callSites: parseCallSites(raw.callSites),
  };
}

/**
 * Build a SearchResult's metadata from a parsed record with these coercions,
 * field-for-field: empty arrays -> undefined, '' -> undefined for
 * symbolName/parentClass/signature, `0` complexity -> undefined, Halstead 0
 * preserved (explicit != null). symbolType is a bare cast — '' is passed
 * through, so a `|| undefined` here would drop it.
 */
function buildMetadata(r: SqliteChunkRecord): SearchResult['metadata'] {
  return {
    file: r.file,
    startLine: r.startLine,
    endLine: r.endLine,
    type: r.type as ChunkMetadata['type'],
    language: r.language,
    symbolName: r.symbolName || undefined,
    symbolType: r.symbolType as 'function' | 'method' | 'class' | 'interface' | undefined,
    parentClass: r.parentClass || undefined,
    complexity: r.complexity || undefined,
    cognitiveComplexity: r.cognitiveComplexity || undefined,
    parameters: hasValidStringEntries(r.parameters) ? r.parameters : undefined,
    signature: r.signature || undefined,
    imports: hasValidStringEntries(r.imports) ? r.imports : undefined,
    halsteadVolume: r.halsteadVolume != null ? r.halsteadVolume : undefined,
    halsteadDifficulty: r.halsteadDifficulty != null ? r.halsteadDifficulty : undefined,
    halsteadEffort: r.halsteadEffort != null ? r.halsteadEffort : undefined,
    halsteadBugs: r.halsteadBugs != null ? r.halsteadBugs : undefined,
    exports: hasValidStringEntries(r.exports) ? r.exports : undefined,
    importedSymbols: r.importedSymbols,
    callSites: r.callSites,
  };
}

/** Convert a parsed record to an unscored SearchResult (scan/scroll paths). */
export function recordToUnscoredResult(r: SqliteChunkRecord): SearchResult {
  return {
    content: r.content,
    metadata: buildMetadata(r),
    score: 0,
    relevance: 'not_relevant',
  };
}

/**
 * Convert a parsed record to a scored SearchResult (FTS search path).
 * Legacy symbols object is appended by querySymbols via buildLegacySymbols;
 * this helper is used by search and querySymbols alike for the base metadata.
 */
export function buildSearchResultMetadata(r: SqliteChunkRecord): SearchResult['metadata'] {
  return buildMetadata(r);
}

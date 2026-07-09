import { SYMBOL_TYPE_MATCHES } from './types.js';
import { safeRegex } from '../utils/safe-regex.js';

/**
 * Minimal record shape the shared filters read. The SQLite backend's parsed
 * row (plain JS arrays) structurally satisfies this; `toPlainArray` also
 * tolerates any array-like value exposing `toArray()`, normalizing defensively.
 */
export interface FilterableRecord {
  content?: string;
  file?: string;
  language?: string;
  /** Chunk kind ('function' | 'class' | 'block' | 'template' | 'doc'). */
  type?: string;
  symbolName?: string;
  symbolType?: string;
  functionNames?: unknown;
  classNames?: unknown;
  interfaceNames?: unknown;
}

export interface SymbolQueryOptions {
  language?: string;
  pattern?: string;
  symbolType?: 'function' | 'method' | 'class' | 'interface';
}

/**
 * Convert an array-like column value to a plain array if needed.
 * The SQLite backend passes plain arrays through untouched; any value exposing
 * `toArray()` is normalized via that method.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toPlainArray<T>(arr: any): T[] | undefined {
  if (!arr) return undefined;
  // Some array-like values expose a toArray() method
  if (typeof arr.toArray === 'function') {
    return arr.toArray();
  }
  if (Array.isArray(arr)) {
    return arr;
  }
  return undefined;
}

/**
 * Check if a string array has valid (non-empty) entries.
 * Treats a lone empty-string entry (['']) as "no entries".
 */
export function hasValidStringEntries(arr: string[] | undefined): boolean {
  return Boolean(arr && arr.length > 0 && arr[0] !== '');
}

/**
 * Get symbols for a specific type from a record.
 * Consolidates the symbol extraction logic used across query functions.
 */
function getSymbolsForType(
  r: FilterableRecord,
  symbolType?: 'function' | 'method' | 'class' | 'interface',
): string[] {
  if (symbolType === 'function' || symbolType === 'method')
    return toPlainArray<string>(r.functionNames) || [];
  if (symbolType === 'class') return toPlainArray<string>(r.classNames) || [];
  if (symbolType === 'interface') return toPlainArray<string>(r.interfaceNames) || [];
  return [
    ...(toPlainArray<string>(r.functionNames) || []),
    ...(toPlainArray<string>(r.classNames) || []),
    ...(toPlainArray<string>(r.interfaceNames) || []),
  ];
}

/**
 * Filter records by language (case-insensitive match).
 */
export function filterByLanguage<T extends FilterableRecord>(records: T[], language: string): T[] {
  return records.filter(r => r.language && r.language.toLowerCase() === language.toLowerCase());
}

/**
 * Filter records by regex pattern against content and file path.
 */
export function filterByPattern<T extends FilterableRecord>(records: T[], pattern: string): T[] {
  const regex = safeRegex(pattern);
  if (!regex) return records;
  // Both fields may be `undefined` under column projection — coerce so the
  // regex doesn't see the literal string "undefined" and match spuriously.
  return records.filter(r => regex.test(r.content ?? '') || regex.test(r.file ?? ''));
}

/**
 * Filter records by symbol type using SYMBOL_TYPE_MATCHES lookup.
 */
export function filterBySymbolType<T extends FilterableRecord>(
  records: T[],
  symbolType: 'function' | 'method' | 'class' | 'interface',
): T[] {
  const allowedTypes = SYMBOL_TYPE_MATCHES[symbolType];
  if (!allowedTypes) {
    return [];
  }
  return records.filter(r => r.symbolType != null && allowedTypes.has(r.symbolType));
}

/**
 * Helper to check if a record matches the requested symbol type.
 */
function matchesSymbolType(
  record: FilterableRecord,
  symbolType: 'function' | 'method' | 'class' | 'interface',
  symbols: string[],
): boolean {
  // If AST-based symbolType exists, use lookup table
  if (record.symbolType) {
    return SYMBOL_TYPE_MATCHES[symbolType]?.has(record.symbolType) ?? false;
  }

  // Fallback: check if pre-AST symbols array has valid entries
  return symbols.length > 0 && symbols.some(s => s.length > 0 && s !== '');
}

/**
 * Check if any symbol name matches the given regex pattern.
 * Returns true if the pattern is invalid (graceful degradation) or if a name matches.
 */
function matchesPattern(pattern: string, symbols: string[], astSymbolName: string): boolean {
  const regex = safeRegex(pattern);
  if (!regex) return true;
  return symbols.some(s => regex.test(s)) || regex.test(astSymbolName);
}

/**
 * Check if a record matches the symbol query filters.
 */
export function matchesSymbolFilter(
  r: FilterableRecord,
  { language, pattern, symbolType }: SymbolQueryOptions,
): boolean {
  // Markdown 'doc' chunks carry a heading-breadcrumb symbolName but are prose,
  // not code symbols -- never surface them via the symbol-lookup path
  // (list_functions / querySymbols). They remain fully searchable via
  // search_code / scanAll / scanWithFilter, which don't route through here.
  if (r.type === 'doc') {
    return false;
  }

  // Language filter
  if (language && (!r.language || r.language.toLowerCase() !== language.toLowerCase())) {
    return false;
  }

  const symbols = getSymbolsForType(r, symbolType);
  const astSymbolName = r.symbolName || '';

  // Must have at least one symbol (legacy or AST-based)
  if (symbols.length === 0 && !astSymbolName) {
    return false;
  }

  // Pattern filter (if provided)
  if (pattern && !matchesPattern(pattern, symbols, astSymbolName)) {
    return false;
  }

  // Symbol type filter (if provided)
  if (symbolType) {
    return matchesSymbolType(r, symbolType, symbols);
  }

  return true;
}

/**
 * Build legacy symbols object for backwards compatibility.
 */
export function buildLegacySymbols(r: FilterableRecord) {
  const functions = toPlainArray<string>(r.functionNames);
  const classes = toPlainArray<string>(r.classNames);
  const interfaces = toPlainArray<string>(r.interfaceNames);
  return {
    functions: hasValidStringEntries(functions) ? functions! : [],
    classes: hasValidStringEntries(classes) ? classes! : [],
    interfaces: hasValidStringEntries(interfaces) ? interfaces! : [],
  };
}

/**
 * Named column lists for LanceDB `.select()` projection on chunk scans.
 *
 * Each handler that scans the chunk table passes one of these constants so
 * LanceDB returns only the fields the handler (and its downstream consumers)
 * actually read. Skips the embedding `vector` column (~6KB/row) on every
 * caller, plus per-handler-specific fields they don't need.
 *
 * Definitions derived from the agent-team review of the column-projection
 * plan — see `.claude/plans/okay-let-us-try-witty-meadow.md`. Lists must be
 * the *superset* of fields every downstream consumer reads, including
 * indirect readers like `shapeResults` allowlists, `groupViolationsByRepo`,
 * and `ComplexityAnalyzer.analyzeFromChunks` (the `lien annotate` path).
 */

/**
 * Valid column names for LanceDB chunk-table queries. Derived from the
 * `DBRecord` shape in `packages/core/src/vectordb/query.ts`. Typed as a
 * string-literal union so typos like `'fil'` become compile errors.
 *
 * `_distance` is synthesized by LanceDB on `.search()` results and is
 * auto-injected by the search wrappers — callers don't include it.
 *
 * `repoId` is NOT a LanceDB column (cross-repo backends only); callers
 * that group by repo on LanceDB get `undefined` and fall back to
 * `'unknown'` — same behavior as today.
 */
export type ColumnName =
  | 'vector'
  | 'content'
  | 'file'
  | 'startLine'
  | 'endLine'
  | 'type'
  | 'language'
  | 'functionNames'
  | 'classNames'
  | 'interfaceNames'
  | 'symbolName'
  | 'symbolType'
  | 'parentClass'
  | 'complexity'
  | 'cognitiveComplexity'
  | 'parameters'
  | 'signature'
  | 'imports'
  | 'halsteadVolume'
  | 'halsteadDifficulty'
  | 'halsteadEffort'
  | 'halsteadBugs'
  | 'exports'
  | 'importedSymbolPaths'
  | 'importedSymbolNames'
  | 'callSiteSymbols'
  | 'callSiteLines'
  | 'callSiteCaptured'
  | '_distance'
  // `repoId` is not in the LanceDB Arrow schema; callers include it so
  // cross-repo grouping keeps working if a cross-repo-capable backend is
  // reintroduced. The LanceDB wrapper silently filters unknown columns
  // before invoking `.select()`, so including it is safe.
  | 'repoId';

/**
 * Always-required columns. Every scan-family caller includes these:
 * `file` for grouping, `startLine`/`endLine` for `scanWithFilter`'s
 * `seenRanges` dedup — without start/end the dedup key collapses every
 * chunk per file to one.
 */
const BASE: ColumnName[] = ['file', 'startLine', 'endLine'];

/**
 * Superset for `findDependents` — single list covers file-level path,
 * symbol-level path, and the `includeAllChunks=true` flow used by
 * `lien annotate`. Must satisfy every downstream consumer:
 *  - import-graph builder (`imports`, `importedSymbol*` pair, `exports`)
 *  - `calculateFileComplexities` (`complexity`)
 *  - `groupDependentsByRepo` (no Arrow column on LanceDB; falls back to 'unknown')
 *  - symbol-level usage extraction (`symbolName`, `symbolType`, `callSite*` triplet)
 *  - `extractSymbolUsagesFromChunks` snippet extraction (`content`)
 *  - `ComplexityAnalyzer.analyzeFromChunks` downstream of `lien annotate`
 *    (`complexity`, `cognitiveComplexity`, halstead*, `language`, `symbolType`)
 *  - `findTestAssociationsFromChunks` (`file`, `imports` — both already in)
 *
 * Using one shared list (instead of file-level vs symbol-level split)
 * eliminates the `scanCache` shape-mismatch risk where a cached
 * file-level scan would poison a symbol-level lookup.
 */
export const DEPENDENCY_GRAPH_COLUMNS: ColumnName[] = [
  ...BASE,
  'language',
  'symbolName',
  'symbolType',
  'imports',
  'importedSymbolPaths',
  'importedSymbolNames',
  'exports',
  'complexity',
  'cognitiveComplexity',
  'halsteadVolume',
  'halsteadDifficulty',
  'halsteadEffort',
  'halsteadBugs',
  'callSiteSymbols',
  'callSiteLines',
  'callSiteCaptured',
  'content',
  // Required by `groupDependentsByRepo` on cross-repo-capable backends.
  // Filtered out by the LanceDB wrapper since it's not in the Arrow schema.
  'repoId',
];

/**
 * `ComplexityAnalyzer.analyze` internal scans
 * (`packages/core/src/insights/complexity-analyzer.ts:54, 56`).
 * Feeds `enrichWithDependencies` (reads `imports`/`importedSymbol*`) AND
 * violation creation (reads `complexity` / halstead-* / `symbolName` /
 * `symbolType` / `language`).
 */
export const COMPLEXITY_ANALYZER_COLUMNS: ColumnName[] = [
  ...BASE,
  'language',
  'symbolName',
  'symbolType',
  'complexity',
  'cognitiveComplexity',
  'halsteadVolume',
  'halsteadDifficulty',
  'halsteadEffort',
  'halsteadBugs',
  'imports',
  'importedSymbolPaths',
  'importedSymbolNames',
  'exports',
];

/**
 * `list_functions` — must satisfy the `shapeResults('list_functions')`
 * allowlist (file, startLine, endLine, language, type, symbolName,
 * symbolType, parentClass, signature, parameters, exports, functionNames,
 * classNames, interfaceNames, content).
 */
export const LIST_FUNCTIONS_COLUMNS: ColumnName[] = [
  ...BASE,
  'content',
  'language',
  'type',
  'symbolName',
  'symbolType',
  'parentClass',
  'signature',
  'parameters',
  'exports',
  'functionNames',
  'classNames',
  'interfaceNames',
];

/**
 * `get_files_context` file-chunks path (heavy). Must satisfy the
 * `shapeResults('get_files_context')` allowlist + the handler's own
 * reads of `imports`/`importedSymbols`/`callSites` for dependency
 * views.
 */
export const FILE_CONTEXT_COLUMNS: ColumnName[] = [
  ...BASE,
  'content',
  'language',
  'type',
  'symbolName',
  'symbolType',
  'parentClass',
  'signature',
  'parameters',
  'complexity',
  'cognitiveComplexity',
  'halsteadVolume',
  'halsteadDifficulty',
  'halsteadEffort',
  'halsteadBugs',
  'imports',
  'importedSymbolPaths',
  'importedSymbolNames',
  'exports',
  'callSiteSymbols',
  'callSiteLines',
  'callSiteCaptured',
  'functionNames',
  'classNames',
  'interfaceNames',
];

/**
 * `get_files_context` test-associations scan (the second scan inside
 * the handler, post first-file lookup). Only feeds
 * `findTestAssociations` which reads `file` + `imports`. Substantially
 * narrower than `FILE_CONTEXT_COLUMNS` — they were incorrectly lumped
 * together in an earlier draft.
 */
export const TEST_ASSOCIATIONS_COLUMNS: ColumnName[] = [...BASE, 'imports'];

/**
 * `get_files_context` related-chunks (`search`-based). Reuses
 * `FILE_CONTEXT_COLUMNS` because the related results flow through the
 * same `shapeResults` allowlist. `_distance` is auto-injected by the
 * `search` wrapper.
 */
export const RELATED_CHUNKS_COLUMNS: ColumnName[] = FILE_CONTEXT_COLUMNS;

/**
 * `semantic_search` + `find_similar` — must satisfy the corresponding
 * `shapeResults` allowlists (both include `exports`, `parentClass`,
 * `parameters`). `_distance` is auto-injected by the `search()` wrapper.
 */
export const SYMBOL_SEARCH_COLUMNS: ColumnName[] = [
  ...BASE,
  'content',
  'language',
  'type',
  'symbolName',
  'symbolType',
  'parentClass',
  'signature',
  'parameters',
  'complexity',
  'exports',
];

/**
 * CLI existence probe (`packages/cli/src/cli/complexity.ts:57`).
 * `limit:1` check — return value is discarded.
 */
export const EXISTENCE_COLUMNS: ColumnName[] = ['file'];

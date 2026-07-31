/**
 * In-memory dependency graph built from CodeChunk[] metadata.
 *
 * Resolves caller/callee relationships using imports, exports, and callSites
 * without any vector DB. Used by the bug-finding plugin to find all callers
 * of changed functions across the full repo.
 *
 * Phase 5 of the duplication refactor (issue #994): per-edge resolution now
 * routes through @liendev/parser's guarded, multi-language path-matching
 * primitives (`importMatchesTarget` and friends) instead of this module's own
 * `resolveImportPath` (deleted — it only ever handled relative JS/TS imports
 * with a hardcoded 6-extension list). The BFS traversal itself
 * (`bfsTransitiveCallers`, via `walkBounded`) already came from parser and is
 * untouched: what changed is how a single edge gets resolved, not how hops are
 * counted. Review's graph stays symbol/call-site-level throughout (a
 * genuinely different abstraction from parser's file-level `findDependents`)
 * — see the module doc on `resolveCallSiteEdges` for why the two were not
 * unified into one call.
 */

import type { CodeChunk } from '@liendev/parser';
import {
  walkBounded,
  importMatchesTarget,
  normalizePath,
  detectLanguage,
  findCSharpTypeReferenceDependents,
} from '@liendev/parser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How an edge was resolved, ranked precise-to-weakest. Lets a consumer (the
 * agent reading `<blast_radius>`, or a caller of `get_dependents`) weight a
 * verified import edge above a name-matched guess instead of treating every
 * dependent as equally solid — see issue #994 Phase 5.
 *
 * - `same-file`: caller and callee are the same file; no import needed.
 * - `import-verified`: the caller's own import statement resolves to the
 *   callee's file via `importMatchesTarget` (all of parser's #884/#887/#929
 *   guards applied) AND a call site names the called symbol directly.
 * - `import-only`: same verified import as above, but no call site in the
 *   importing file names the symbol — e.g. a PHP `new Order()` construction,
 *   a type hint, or a static/property access that never surfaces as a
 *   `callSite`. Without this tier the dependent would silently vanish (see
 *   the module doc on `resolveImportOnlyEdges`); the caller identity attached
 *   is the file's best-effort representative chunk, not a verified call site.
 * - `symbol-name-match`: the caller imports a same-named symbol from some
 *   non-relative (package) path, but the specific source file was never
 *   confirmed — a real edge only if the name isn't coincidentally reused
 *   elsewhere in the corpus.
 * - `oop-method-import`: the caller imports the class (verified) and calls a
 *   method whose name matches one declared on it; the class import is solid,
 *   the specific method attribution is inferred.
 * - `namespace-inferred`: no import at all — resolved via a same-namespace/
 *   same-directory convention (PHP/Python/Rust) or, for C#, the #930/#971
 *   type-reference-matching fallback (`findCSharpTypeReferenceDependents`).
 *   The weakest tier: a real structural signal, never an import edge.
 */
export type EdgeProvenance =
  | 'same-file'
  | 'import-verified'
  | 'import-only'
  | 'symbol-name-match'
  | 'oop-method-import'
  | 'namespace-inferred';

/** True for the two tiers backed by a verified import statement (same-file counts as trivially verified). */
export function isPreciseProvenance(provenance: EdgeProvenance): boolean {
  return provenance === 'same-file' || provenance === 'import-verified';
}

export interface SymbolNode {
  filepath: string;
  symbolName: string;
  chunk: CodeChunk;
}

export interface CallerEdge {
  caller: SymbolNode;
  callSiteLine: number;
  /** How this edge was resolved — see `EdgeProvenance`'s doc comment. */
  provenance: EdgeProvenance;
}

export interface TransitiveCallerEdge extends CallerEdge {
  /** Distance from the seed symbol. Direct callers are 1, callers-of-callers are 2. */
  hops: number;
  /** The symbol on the call chain this caller resolved through. Equals the seed for hops=1. */
  viaSymbol: string;
}

export interface TransitiveResult {
  callers: TransitiveCallerEdge[];
  /** True if BFS stopped because it hit maxNodes before exploring the full graph. */
  truncated: boolean;
  /** Count of distinct symbols whose callers were expanded (for diagnostics). */
  visitedSymbols: number;
}

export interface TransitiveOptions {
  /** Max hop distance from the seed. Default 2. */
  depth?: number;
  /** Max edges to emit. Default 30. */
  maxNodes?: number;
}

export interface DependencyGraph {
  /** Find all chunks that call a given exported symbol. */
  getCallers(filepath: string, symbolName: string): CallerEdge[];
  /**
   * BFS-walk callers up to `depth` hops. Each caller is emitted exactly once,
   * at its shortest hop distance from the seed. Stops when `maxNodes` edges
   * have been emitted (sets `truncated=true`).
   */
  getCallersTransitive(
    filepath: string,
    symbolName: string,
    opts?: TransitiveOptions,
  ): TransitiveResult;
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/**
 * A cached wrapper around parser's `normalizePath`, scoped to one
 * `buildDependencyGraph` call. Review's chunk file paths are already
 * repo-relative (never prefixed with `workspaceRoot`), so the only thing this
 * buys over the raw path is `normalizePath`'s cross-language extension strip
 * (needed for `importMatchesTarget` to compare e.g. a `.js`-suffixed
 * TypeScript import against a `.ts` file, or a PHP/Python/Rust specifier with
 * no extension at all against a real file path that has one).
 */
function createNormalizer(workspaceRoot: string): (p: string) => string {
  const cache = new Map<string, string>();
  return (p: string): string => {
    const cached = cache.get(p);
    if (cached !== undefined) return cached;
    const normalized = normalizePath(p, workspaceRoot);
    cache.set(p, normalized);
    return normalized;
  };
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

/**
 * Build an in-memory dependency graph from CodeChunk[].
 *
 * `workspaceRoot` only feeds `normalizePath`'s extension-stripping (see
 * `createNormalizer`) — pass the same value blast-radius.ts already threads
 * through as `ComputeBlastRadiusOptions.workspaceRoot` (`context.repoRootDir`
 * in production); omitting it is safe when chunk paths are already relative.
 *
 * Four-pass algorithm:
 * 1. Build export index: which files export/declare which symbols.
 * 2. Resolve imports: for each chunk, verify which of its import specifiers
 *    resolve to a real exporting file (via parser's guarded matching).
 * 3. Build caller edges: for each call site, link it to the exported
 *    symbol's definition, trying precise-to-weakest strategies in order.
 * 4. Build the import-only fallback index (#994 Phase 5): files that
 *    verifiably import a symbol but never literally "call" it (e.g. a PHP
 *    `new Order()`), so a class/type-shaped seed doesn't silently resolve to
 *    zero dependents just because nothing invokes it by name.
 */
export function buildDependencyGraph(chunks: CodeChunk[], workspaceRoot = ''): DependencyGraph {
  const normalize = createNormalizer(workspaceRoot);
  const { exportIndex, chunksByFile } = buildExportIndex(chunks);
  const chunkImportMaps = resolveChunkImports(chunks, exportIndex, normalize);
  const callerEdges = buildCallerEdges(chunks, chunkImportMaps, exportIndex);
  const importOnlyEdges = buildImportOnlyEdges(chunkImportMaps, callerEdges, chunksByFile);
  const csharpFallbackCache = new Map<string, CallerEdge[] | undefined>();

  const getCallers = (filepath: string, symbolName: string): CallerEdge[] => {
    const key = `${filepath}::${symbolName}`;
    const direct = callerEdges.get(key);
    if (direct && direct.length > 0) return direct;

    const importOnly = importOnlyEdges.get(key);
    if (importOnly && importOnly.length > 0) return importOnly;

    return resolveCSharpFallback(filepath, chunks, chunksByFile, csharpFallbackCache) ?? [];
  };

  return {
    getCallers,
    getCallersTransitive: (filepath, symbolName, opts = {}) =>
      bfsTransitiveCallers(getCallers, filepath, symbolName, opts),
  };
}

// ---------------------------------------------------------------------------
// Transitive BFS — thin domain wrapper around @liendev/parser's walkBounded.
//
// The generic primitive owns the frontier-expansion loop: dedup, the depth
// cap, and maxNodes truncation. This wrapper supplies the caller-graph domain
// (an exported symbol at a filepath as the node identity) and decorates the
// raw walk results with the hop/viaSymbol fields callers of this module
// expect — that decoration happens here, not inside walkBounded.
//
// Hop semantics are unchanged by Phase 5: a hop is one call-graph edge
// (caller-of-caller), never an import-graph edge — see `EdgeProvenance` for
// how an edge gets resolved, which is orthogonal to how many hops it costs.
// ---------------------------------------------------------------------------

const DEFAULT_TRANSITIVE_DEPTH = 2;
const DEFAULT_TRANSITIVE_MAX_NODES = 30;

/** Node identity for the caller-graph BFS: an exported symbol at a filepath. */
interface CallerGraphNode {
  filepath: string;
  symbolName: string;
}

function callerGraphNodeKey(node: CallerGraphNode): string {
  return `${node.filepath}::${node.symbolName}`;
}

function callerEdgeKey(edge: CallerEdge): string {
  return `${edge.caller.filepath}::${edge.caller.symbolName}`;
}

function bfsTransitiveCallers(
  getCallers: (filepath: string, symbolName: string) => CallerEdge[],
  filepath: string,
  symbolName: string,
  opts: TransitiveOptions,
): TransitiveResult {
  const depth = opts.depth ?? DEFAULT_TRANSITIVE_DEPTH;
  const maxNodes = opts.maxNodes ?? DEFAULT_TRANSITIVE_MAX_NODES;

  const { results, truncated, visitedCount } = walkBounded<CallerGraphNode, CallerEdge>(
    { filepath, symbolName },
    node => getCallers(node.filepath, node.symbolName),
    edge => ({ filepath: edge.caller.filepath, symbolName: edge.caller.symbolName }),
    callerEdgeKey,
    callerGraphNodeKey,
    { depth, maxNodes },
  );

  const callers: TransitiveCallerEdge[] = results.map(({ edge, fromNode, hops }) => ({
    caller: edge.caller,
    callSiteLine: edge.callSiteLine,
    provenance: edge.provenance,
    hops,
    viaSymbol: fromNode.symbolName,
  }));

  return { callers, truncated, visitedSymbols: visitedCount };
}

type ExportEntry = { filepath: string; chunk: CodeChunk };
type ExportIndex = Map<string, ExportEntry[]>;
/** A chunk's own verified import map: symbol name -> files it verifiably imports that symbol from. */
type ChunkImportMap = Map<string, ExportEntry[]>;

/** Pass 1: Build the file->chunks grouping and the export index. */
function buildExportIndex(chunks: CodeChunk[]): {
  exportIndex: ExportIndex;
  chunksByFile: Map<string, CodeChunk[]>;
} {
  const exportIndex: ExportIndex = new Map();
  const chunksByFile = new Map<string, CodeChunk[]>();

  const addToIndex = (symbol: string, file: string, chunk: CodeChunk) => {
    const existing = exportIndex.get(symbol) ?? [];
    if (!existing.some(e => e.filepath === file)) {
      existing.push({ filepath: file, chunk });
    }
    exportIndex.set(symbol, existing);
  };

  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    const fileChunks = chunksByFile.get(file) ?? [];
    fileChunks.push(chunk);
    chunksByFile.set(file, fileChunks);

    // Index explicit exports (classes, functions, interfaces)
    if (chunk.metadata.exports) {
      for (const exportedSymbol of chunk.metadata.exports) {
        addToIndex(exportedSymbol, file, chunk);
      }
    }

    // Also index method/function symbolNames — needed for OOP languages (PHP, Rust, Python)
    // where call sites reference method names (e.g., findById) but exports only list
    // the class name (e.g., Order). This enables cross-file method call resolution.
    const sym = chunk.metadata.symbolName;
    const symType = chunk.metadata.symbolType;
    if (sym && (symType === 'function' || symType === 'method')) {
      addToIndex(sym, file, chunk);
    }
  }

  return { exportIndex, chunksByFile };
}

/**
 * Pass 2: For each chunk's `importedSymbols`, verify which named symbols
 * resolve to a real exporting file — via parser's `importMatchesTarget`,
 * which applies the #884 whole-module, #887 single-file-vs-package, and #929
 * Python-bare-module guards, and covers every AST-supported language's
 * extension/namespace conventions (not just JS/TS's 6 hardcoded extensions).
 *
 * Replaces the old `resolveImportPath` + per-chunk fileSet lookup entirely:
 * rather than resolving a specifier to *some* file in a corpus-wide file set
 * (expensive, and blind to non-JS/TS syntax), this checks each imported
 * symbol's specifier against the SMALL set of files that already declare a
 * symbol of that name (`exportIndex`) — cheap, and the check itself is
 * language-agnostic.
 *
 * Deliberately keyed by symbol name (not raw specifier): a chunk's own
 * `resolveCallSiteEdges` only ever needs "does this chunk verifiably import
 * symbol S", so there is nothing to gain from also keeping the specifier
 * once this pass is done.
 */
function resolveChunkImports(
  chunks: CodeChunk[],
  exportIndex: ExportIndex,
  normalize: (p: string) => string,
): Map<CodeChunk, ChunkImportMap> {
  const result = new Map<CodeChunk, ChunkImportMap>();

  for (const chunk of chunks) {
    const importedSymbols = chunk.metadata.importedSymbols;
    if (!importedSymbols) continue;

    const importMap = resolveOneChunkImports(chunk, importedSymbols, exportIndex, normalize);
    if (importMap.size > 0) result.set(chunk, importMap);
  }

  return result;
}

/** Verify one chunk's imported symbols against `exportIndex` — see `resolveChunkImports`. */
function resolveOneChunkImports(
  chunk: CodeChunk,
  importedSymbols: Record<string, string[]>,
  exportIndex: ExportIndex,
  normalize: (p: string) => string,
): ChunkImportMap {
  const importMap: ChunkImportMap = new Map();

  for (const [spec, symbols] of Object.entries(importedSymbols)) {
    for (const sym of symbols) {
      const verified = verifiedExportLocations(
        spec,
        chunk.metadata.file,
        sym,
        exportIndex,
        normalize,
      );
      if (verified.length === 0) continue;
      const existing = importMap.get(sym) ?? [];
      importMap.set(sym, [...existing, ...verified]);
    }
  }

  return importMap;
}

/** Which of `sym`'s known export locations does `spec` (as imported by `importerFile`) verifiably resolve to? */
function verifiedExportLocations(
  spec: string,
  importerFile: string,
  sym: string,
  exportIndex: ExportIndex,
  normalize: (p: string) => string,
): ExportEntry[] {
  const candidates = exportIndex.get(sym);
  if (!candidates || candidates.length === 0) return [];
  return candidates.filter(candidate =>
    importMatchesTarget(spec, importerFile, normalize(candidate.filepath), normalize),
  );
}

/**
 * Build a set of symbols each chunk imports from non-relative (package) paths.
 * Used for the symbol-name fallback in cross-package resolution.
 */
function buildPackageImportedSymbols(chunks: CodeChunk[]): Map<CodeChunk, Set<string>> {
  const result = new Map<CodeChunk, Set<string>>();
  for (const chunk of chunks) {
    if (!chunk.metadata.importedSymbols) continue;
    const symbols = new Set<string>();
    for (const [importPath, syms] of Object.entries(chunk.metadata.importedSymbols)) {
      if (importPath.startsWith('.')) continue;
      for (const sym of syms) symbols.add(sym);
    }
    if (symbols.size > 0) result.set(chunk, symbols);
  }
  return result;
}

/**
 * Build a map from exported class/module symbols to the files that export them.
 * Used to resolve method calls through class imports (e.g., `Order::findById()`
 * where `Order` is imported but `findById` is the call site symbol).
 */
function buildExportFileMap(exportIndex: ExportIndex): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const [symbol, entries] of exportIndex) {
    for (const entry of entries) {
      const existing = result.get(symbol) ?? new Set<string>();
      existing.add(entry.filepath);
      result.set(symbol, existing);
    }
  }
  return result;
}

/**
 * Check if a chunk imports any symbol from a given file (via non-relative imports).
 * Used for OOP method resolution: if a chunk imports class `Order` from `Order.php`,
 * and `Order.php` also defines `findById`, the chunk can call `findById`.
 */
function chunkImportsFromFile(
  chunk: CodeChunk,
  targetFile: string,
  pkgSymbols: Set<string> | undefined,
  exportFileMap: Map<string, Set<string>>,
): boolean {
  if (!pkgSymbols) return false;
  for (const sym of pkgSymbols) {
    const files = exportFileMap.get(sym);
    if (files?.has(targetFile)) return true;
  }
  return false;
}

/** A single resolved call site on a chunk (symbol + line it was called from). */
type CallSiteInfo = NonNullable<CodeChunk['metadata']['callSites']>[number];

/** Shared lookups + the edge accumulator threaded through the resolution strategies. */
interface EdgeResolutionContext {
  edges: Map<string, CallerEdge[]>;
  exportIndex: ExportIndex;
  exportFileMap: Map<string, Set<string>>;
}

/**
 * Languages with NO implicit-namespace/enclosing-access convention this
 * module can approximate — TS/JS always require an explicit import, and C#
 * has a REAL namespace/enclosing-access model (`findCSharpTypeReferenceDependents`,
 * #930/#971) that the crude same-directory heuristic below must not run
 * instead of. Fixes the C# gating bug flagged in issue #994 Phase 5: the old
 * denylist (`!['typescript','javascript'].includes(lang)`) let C# fall
 * through to same-directory matching despite the comment naming only
 * PHP/Python/Rust as the intended targets.
 */
const NO_DIRECTORY_NAMESPACE_LANGS = new Set(['typescript', 'javascript', 'csharp']);

/** Directory portion of a posix path, including the trailing slash ('' at the root). */
function dirOf(filepath: string): string {
  return filepath.substring(0, filepath.lastIndexOf('/') + 1);
}

/** Pass 3: Build caller edges from call sites + resolved imports. */
function buildCallerEdges(
  chunks: CodeChunk[],
  chunkImportMaps: Map<CodeChunk, ChunkImportMap>,
  exportIndex: ExportIndex,
): Map<string, CallerEdge[]> {
  const packageImports = buildPackageImportedSymbols(chunks);
  const ctx: EdgeResolutionContext = {
    edges: new Map<string, CallerEdge[]>(),
    exportIndex,
    exportFileMap: buildExportFileMap(exportIndex),
  };

  for (const chunk of chunks) {
    const callSites = chunk.metadata.callSites;
    if (!callSites || callSites.length === 0) continue;

    const importMap = chunkImportMaps.get(chunk);
    const pkgSymbols = packageImports.get(chunk);

    for (const callSite of callSites) {
      resolveCallSiteEdges(chunk, callSite, importMap, pkgSymbols, ctx);
    }
  }

  return ctx.edges;
}

/**
 * Resolve and record caller edges for one call site, trying each strategy in
 * priority order and stopping at the first that applies:
 *   1. same-file export                    2. verified import (any language)
 *   3a. cross-package symbol match          3b. OOP method (caller imports the class)
 *   3c. same-namespace (implicit imports)
 *
 * Deliberately NOT delegated to parser's `findDependents`: that function is
 * file-level (its unit of "dependent" is a file that imports a symbol, with
 * per-call-site `usages` as an optional enrichment), while this graph is
 * symbol/call-site-level throughout (its unit is a specific caller symbol at
 * a specific line, feeding a call-graph BFS that hops caller-to-caller — see
 * `bfsTransitiveCallers`). Measured (see issue #994 Phase 5 PR body): calling
 * `findDependents` once per BFS-frontier node re-scans the ENTIRE chunk set
 * every time (~25ms/call on a 9.9k-chunk corpus, no memoization possible
 * since each node is a different file+symbol) — a real cost that scales
 * with corpus size and would also land on the live `get_dependents` agent
 * tool's per-call latency. Routing only the per-edge GUARDS through parser
 * (`importMatchesTarget` below) keeps this pass's O(n)-once/O(1)-query
 * architecture intact while still sharing every language guard.
 */
function resolveCallSiteEdges(
  chunk: CodeChunk,
  callSite: CallSiteInfo,
  importMap: ChunkImportMap | undefined,
  pkgSymbols: Set<string> | undefined,
  ctx: EdgeResolutionContext,
): void {
  const calledSymbol = callSite.symbol;
  const callerFile = chunk.metadata.file;

  const exportLocations = ctx.exportIndex.get(calledSymbol);
  if (!exportLocations) return;

  // 1. The same file both calls and exports the symbol.
  if (exportLocations.some(e => e.filepath === callerFile)) {
    addEdge(ctx.edges, `${callerFile}::${calledSymbol}`, chunk, callSite.line, 'same-file');
    return;
  }

  // 2. A verified import (any language, all #884/#887/#929 guards applied) —
  //    unifies the old "relative import" and "cross-package" precise cases
  //    into one guarded check against the symbol's actual export locations.
  const verified = importMap?.get(calledSymbol);
  if (verified && verified.length > 0) {
    for (const loc of verified) {
      addEdge(
        ctx.edges,
        `${loc.filepath}::${calledSymbol}`,
        chunk,
        callSite.line,
        'import-verified',
      );
    }
    return;
  }

  // 3a. Cross-package symbol-name match, unverified against a specific file.
  //     Works across languages incl. barrel re-exports the verified check
  //     above can't see through (the specifier names the barrel, not the
  //     ultimate declaring file).
  if (pkgSymbols?.has(calledSymbol)) {
    addCrossPackageEdges(chunk, callSite, exportLocations, ctx);
    return;
  }

  // 3b. OOP method fallback (caller imports the class, calls one of its methods).
  if (addOopMethodEdges(chunk, callSite, exportLocations, pkgSymbols, ctx)) return;

  // 3c. Same-namespace fallback for languages with implicit imports.
  addSameNamespaceEdges(chunk, callSite, exportLocations, ctx);
}

/** 3a. The caller's package imports the symbol by name — edge to every defining file. */
function addCrossPackageEdges(
  chunk: CodeChunk,
  callSite: CallSiteInfo,
  exportLocations: ExportEntry[],
  ctx: EdgeResolutionContext,
): void {
  const callerFile = chunk.metadata.file;
  for (const loc of exportLocations) {
    if (loc.filepath === callerFile) continue;
    addEdge(
      ctx.edges,
      `${loc.filepath}::${callSite.symbol}`,
      chunk,
      callSite.line,
      'symbol-name-match',
    );
  }
}

/**
 * 3b. OOP method fallback: the caller imports a class (e.g. `use App\Models\Order`) and
 * calls one of its methods (e.g. `findById`). The import names the class, not the method,
 * so direct symbol matching fails — instead match any file the caller imports from that
 * also defines the called method. Returns true if any edge was added.
 */
function addOopMethodEdges(
  chunk: CodeChunk,
  callSite: CallSiteInfo,
  exportLocations: ExportEntry[],
  pkgSymbols: Set<string> | undefined,
  ctx: EdgeResolutionContext,
): boolean {
  const callerFile = chunk.metadata.file;
  let matched = false;
  for (const loc of exportLocations) {
    if (loc.filepath === callerFile) continue;
    if (chunkImportsFromFile(chunk, loc.filepath, pkgSymbols, ctx.exportFileMap)) {
      addEdge(
        ctx.edges,
        `${loc.filepath}::${callSite.symbol}`,
        chunk,
        callSite.line,
        'oop-method-import',
      );
      matched = true;
    }
  }
  return matched;
}

/**
 * 3c. Same-namespace fallback: in PHP/Python/Rust, classes in the same namespace
 * reference each other without explicit imports. If the method is defined in a file
 * in the same directory as the caller, create the edge. Skipped for TS/JS (always
 * require explicit imports) and C# (has a REAL namespace model — see
 * `NO_DIRECTORY_NAMESPACE_LANGS` and `resolveCSharpFallback` instead).
 */
function addSameNamespaceEdges(
  chunk: CodeChunk,
  callSite: CallSiteInfo,
  exportLocations: ExportEntry[],
  ctx: EdgeResolutionContext,
): void {
  const lang = chunk.metadata.language;
  const supportsImplicitNamespace = !!lang && !NO_DIRECTORY_NAMESPACE_LANGS.has(lang);
  if (!supportsImplicitNamespace) return;

  const callerFile = chunk.metadata.file;
  const callerDir = dirOf(callerFile);
  for (const loc of exportLocations) {
    if (loc.filepath === callerFile) continue;
    if (dirOf(loc.filepath) === callerDir) {
      addEdge(
        ctx.edges,
        `${loc.filepath}::${callSite.symbol}`,
        chunk,
        callSite.line,
        'namespace-inferred',
      );
    }
  }
}

function addEdge(
  edges: Map<string, CallerEdge[]>,
  key: string,
  callerChunk: CodeChunk,
  callSiteLine: number,
  provenance: EdgeProvenance,
): void {
  const existing = edges.get(key) ?? [];
  existing.push({
    caller: {
      filepath: callerChunk.metadata.file,
      symbolName: callerChunk.metadata.symbolName ?? 'unknown',
      chunk: callerChunk,
    },
    callSiteLine,
    provenance,
  });
  edges.set(key, existing);
}

// ---------------------------------------------------------------------------
// Import-only fallback (#994 Phase 5) — covers a symbol that is genuinely
// imported/referenced but never appears as a `callSite`: a class used only
// via `new Order()`, a type hint, or a static/property access. Without this,
// `getCallers` on a class-shaped seed silently returns zero even though real
// dependents exist (confirmed empirically: PHP class exports resolved 0/152
// via call-site-only matching, vs. 45%+ once import-only counts too).
// ---------------------------------------------------------------------------

/**
 * Pick one representative chunk from a file to stand in for "the caller" of
 * an import-only edge — prefers a top-level class, then a top-level
 * function, then any chunk with a symbolName. `importedSymbols` is
 * deliberately duplicated onto every chunk in a file (see `chunker.ts`'s own
 * doc comment on `createChunk`), so without picking exactly one
 * representative per file, an import-only edge would fire once per chunk in
 * the importing file — a 20-method class would fabricate 20 "dependents"
 * for what is really one file-level relationship.
 */
function pickRepresentativeChunk(fileChunks: CodeChunk[]): CodeChunk | undefined {
  return (
    fileChunks.find(c => c.metadata.symbolType === 'class' && !c.metadata.parentClass) ??
    fileChunks.find(c => c.metadata.symbolType === 'function' && !c.metadata.parentClass) ??
    fileChunks.find(c => !!c.metadata.symbolName)
  );
}

/** Sentinel caller identity when a file's chunks carry no usable symbolName at all. */
const NO_REPRESENTATIVE_SYMBOL = '(module-level)';

/**
 * Build one fallback `CallerEdge` for `file`, standing in for a caller whose
 * exact symbol/call-site can't be pinned down (import-only or C#
 * type-reference recovery) — see `pickRepresentativeChunk`'s doc comment.
 * Shared by `buildImportOnlyEdges` and `resolveCSharpFallback` so the two
 * fallback tiers build their edges identically.
 */
function buildRepresentativeEdge(
  file: string,
  chunksByFile: Map<string, CodeChunk[]>,
  provenance: EdgeProvenance,
): CallerEdge {
  const fileChunks = chunksByFile.get(file) ?? [];
  const representative = pickRepresentativeChunk(fileChunks);
  return {
    caller: {
      filepath: file,
      symbolName: representative?.metadata.symbolName ?? NO_REPRESENTATIVE_SYMBOL,
      chunk: representative ?? (fileChunks[0] as CodeChunk),
    },
    callSiteLine: representative?.metadata.startLine ?? 0,
    provenance,
  };
}

/**
 * Collect, per `file::symbol` key not already covered by a real call-site
 * edge, the set of files that verifiably import that symbol — deduped per
 * file (the SAME chunk's `importedSymbols` is duplicated across every chunk
 * in its file, see `pickRepresentativeChunk`'s doc comment, so without
 * dedup a 20-method class would produce 20 candidate "files").
 */
function collectImportOnlyFileKeys(
  chunkImportMaps: Map<CodeChunk, ChunkImportMap>,
  callerEdges: Map<string, CallerEdge[]>,
): Map<string, Set<string>> {
  const filesByKey = new Map<string, Set<string>>();

  for (const [chunk, importMap] of chunkImportMaps) {
    const callerFile = chunk.metadata.file;
    for (const [sym, locations] of importMap) {
      for (const loc of locations) {
        if (loc.filepath === callerFile) continue;
        const key = `${loc.filepath}::${sym}`;
        if (callerEdges.has(key)) continue; // a real call-site edge already covers this key
        const files = filesByKey.get(key) ?? new Set<string>();
        files.add(callerFile);
        filesByKey.set(key, files);
      }
    }
  }

  return filesByKey;
}

/**
 * Build the file::symbol -> import-only CallerEdge[] fallback index, keyed
 * identically to `callerEdges` so `getCallers` can look either up with the
 * same key. Only ever consulted when `callerEdges` came back empty for that
 * key (see `buildDependencyGraph`'s `getCallers`), so a key already covered
 * by a real call-site edge never needs a redundant entry here.
 */
function buildImportOnlyEdges(
  chunkImportMaps: Map<CodeChunk, ChunkImportMap>,
  callerEdges: Map<string, CallerEdge[]>,
  chunksByFile: Map<string, CodeChunk[]>,
): Map<string, CallerEdge[]> {
  const filesByKey = collectImportOnlyFileKeys(chunkImportMaps, callerEdges);

  const result = new Map<string, CallerEdge[]>();
  for (const [key, files] of filesByKey) {
    const edges = [...files].map(file =>
      buildRepresentativeEdge(file, chunksByFile, 'import-only'),
    );
    result.set(key, edges);
  }
  return result;
}

// ---------------------------------------------------------------------------
// C# namespace-scoped fallback (#994 Phase 5) — reuses parser's #930/#971
// type-reference-matching recovery (`findCSharpTypeReferenceDependents`)
// instead of the same-directory heuristic `addSameNamespaceEdges` no longer
// applies to C# (see `NO_DIRECTORY_NAMESPACE_LANGS`). File-level only (the
// parser primitive has no per-call-site detail), memoized per target file
// since a review pass can query the same C# file's declared type more than
// once (e.g. multiple seeds in the same file, or repeated BFS visits).
// ---------------------------------------------------------------------------

function resolveCSharpFallback(
  filepath: string,
  allChunks: CodeChunk[],
  chunksByFile: Map<string, CodeChunk[]>,
  cache: Map<string, CallerEdge[] | undefined>,
): CallerEdge[] | undefined {
  if (cache.has(filepath)) return cache.get(filepath);

  const fileChunks = chunksByFile.get(filepath);
  const language = fileChunks?.[0]?.metadata.language;
  if (language !== 'csharp' || detectLanguage(filepath) !== 'csharp') {
    cache.set(filepath, undefined);
    return undefined;
  }

  const dependentFiles = findCSharpTypeReferenceDependents(filepath, allChunks);
  if (dependentFiles.length === 0) {
    cache.set(filepath, undefined);
    return undefined;
  }

  const edges: CallerEdge[] = dependentFiles.map(file =>
    buildRepresentativeEdge(file, chunksByFile, 'namespace-inferred'),
  );

  cache.set(filepath, edges);
  return edges;
}

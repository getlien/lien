/**
 * In-memory dependency graph built from CodeChunk[] metadata.
 *
 * Resolves caller/callee relationships using imports, exports, and callSites
 * without any vector DB. Used by the bug-finding plugin to find all callers
 * of changed functions across the full repo.
 */

import path from 'node:path/posix';
import type { CodeChunk } from '@liendev/parser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SymbolNode {
  filepath: string;
  symbolName: string;
  chunk: CodeChunk;
}

export interface CallerEdge {
  caller: SymbolNode;
  callSiteLine: number;
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
// Import path resolution
// ---------------------------------------------------------------------------

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];
const INDEX_FILES = EXTENSIONS.map(ext => `index${ext}`);

/**
 * Resolve a relative import path to a filepath in the known file set.
 * Handles bare paths, extensions, and index files.
 */
export function resolveImportPath(
  importPath: string,
  importerFile: string,
  fileSet: Set<string>,
): string | null {
  // Skip non-relative imports (node_modules, aliases)
  if (!importPath.startsWith('.')) return null;

  const importerDir = path.dirname(importerFile);
  const resolved = path.join(importerDir, importPath);

  // Exact match
  if (fileSet.has(resolved)) return resolved;

  // Try adding extensions
  for (const ext of EXTENSIONS) {
    const withExt = resolved + ext;
    if (fileSet.has(withExt)) return withExt;
  }

  // Strip existing extension and re-try (e.g., './foo.js' -> './foo.ts')
  const parsed = path.parse(resolved);
  if (parsed.ext) {
    const withoutExt = path.join(parsed.dir, parsed.name);
    for (const ext of EXTENSIONS) {
      const remapped = withoutExt + ext;
      if (fileSet.has(remapped)) return remapped;
    }
  }

  // Try as directory with index file
  for (const indexFile of INDEX_FILES) {
    const asDir = path.join(resolved, indexFile);
    if (fileSet.has(asDir)) return asDir;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

/**
 * Build an in-memory dependency graph from CodeChunk[].
 *
 * Three-pass algorithm:
 * 1. Build export index: which files export which symbols
 * 2. Resolve imports: for each chunk, map imported symbols to their source files
 * 3. Build caller edges: for each call site, link it to the exported symbol's definition
 */
export function buildDependencyGraph(chunks: CodeChunk[]): DependencyGraph {
  const { fileSet, exportIndex } = buildExportIndex(chunks);
  const chunkImportMaps = resolveChunkImports(chunks, fileSet);
  const callerEdges = buildCallerEdges(chunks, chunkImportMaps, exportIndex);

  const getCallers = (filepath: string, symbolName: string): CallerEdge[] => {
    return callerEdges.get(`${filepath}::${symbolName}`) ?? [];
  };

  const getCallersTransitive = (
    filepath: string,
    symbolName: string,
    opts: TransitiveOptions = {},
  ): TransitiveResult => {
    const depth = opts.depth ?? 2;
    const maxNodes = opts.maxNodes ?? 30;

    if (depth < 1 || maxNodes < 1) {
      return { callers: [], truncated: false, visitedSymbols: 0 };
    }

    const seedKey = `${filepath}::${symbolName}`;
    const expandedSymbols = new Set<string>();
    const emittedCallers = new Set<string>();
    // Never emit the seed as its own caller — guards against cycles that
    // would otherwise produce meaningless "X calls X" edges.
    emittedCallers.add(seedKey);

    const result: TransitiveCallerEdge[] = [];
    const queue: Array<{ filepath: string; symbolName: string; hops: number }> = [
      { filepath, symbolName, hops: 0 },
    ];

    let truncated = false;
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const currentKey = `${current.filepath}::${current.symbolName}`;
      if (expandedSymbols.has(currentKey)) continue;
      expandedSymbols.add(currentKey);

      const directCallers = getCallers(current.filepath, current.symbolName);
      for (const edge of directCallers) {
        const callerKey = `${edge.caller.filepath}::${edge.caller.symbolName}`;
        if (emittedCallers.has(callerKey)) continue;

        if (result.length >= maxNodes) {
          truncated = true;
          break;
        }

        emittedCallers.add(callerKey);
        const hops = current.hops + 1;
        result.push({
          caller: edge.caller,
          callSiteLine: edge.callSiteLine,
          hops,
          viaSymbol: current.symbolName,
        });

        if (hops < depth) {
          queue.push({
            filepath: edge.caller.filepath,
            symbolName: edge.caller.symbolName,
            hops,
          });
        }
      }
      if (truncated) break;
    }

    return { callers: result, truncated, visitedSymbols: expandedSymbols.size };
  };

  return { getCallers, getCallersTransitive };
}

type ExportEntry = { filepath: string; chunk: CodeChunk };
type ExportIndex = Map<string, ExportEntry[]>;
type ResolvedImport = { definitionFilepath: string };
type ChunkImportMap = Map<string, ResolvedImport>;

/** Pass 1: Build file set and export index. */
function buildExportIndex(chunks: CodeChunk[]): { fileSet: Set<string>; exportIndex: ExportIndex } {
  const fileSet = new Set<string>();
  const exportIndex: ExportIndex = new Map();

  const addToIndex = (symbol: string, file: string, chunk: CodeChunk) => {
    const existing = exportIndex.get(symbol) ?? [];
    if (!existing.some(e => e.filepath === file)) {
      existing.push({ filepath: file, chunk });
    }
    exportIndex.set(symbol, existing);
  };

  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    fileSet.add(file);

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

  return { fileSet, exportIndex };
}

/** Pass 2: Resolve imported symbols to their source filepaths. */
function resolveChunkImports(
  chunks: CodeChunk[],
  fileSet: Set<string>,
): Map<CodeChunk, ChunkImportMap> {
  const result = new Map<CodeChunk, ChunkImportMap>();

  for (const chunk of chunks) {
    if (!chunk.metadata.importedSymbols) continue;

    const importMap: ChunkImportMap = new Map();
    for (const [importPath, symbols] of Object.entries(chunk.metadata.importedSymbols)) {
      const resolvedPath = resolveImportPath(importPath, chunk.metadata.file, fileSet);
      if (!resolvedPath) continue;
      for (const sym of symbols) {
        importMap.set(sym, { definitionFilepath: resolvedPath });
      }
    }

    if (importMap.size > 0) result.set(chunk, importMap);
  }

  return result;
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

/** Pass 3: Build caller edges from call sites + resolved imports. */
function buildCallerEdges(
  chunks: CodeChunk[],
  chunkImportMaps: Map<CodeChunk, ChunkImportMap>,
  exportIndex: ExportIndex,
): Map<string, CallerEdge[]> {
  const edges = new Map<string, CallerEdge[]>();
  const packageImports = buildPackageImportedSymbols(chunks);
  const exportFileMap = buildExportFileMap(exportIndex);

  for (const chunk of chunks) {
    if (!chunk.metadata.callSites || chunk.metadata.callSites.length === 0) continue;

    const importMap = chunkImportMaps.get(chunk);
    const callerFile = chunk.metadata.file;
    const pkgSymbols = packageImports.get(chunk);

    for (const callSite of chunk.metadata.callSites) {
      const calledSymbol = callSite.symbol;

      // 1. Try to resolve via relative imports
      const resolved = importMap?.get(calledSymbol);
      if (resolved) {
        addEdge(edges, `${resolved.definitionFilepath}::${calledSymbol}`, chunk, callSite.line);
        continue;
      }

      // 2. Try same-file: symbol is exported by the same file
      const exportLocations = exportIndex.get(calledSymbol);
      if (exportLocations?.some(e => e.filepath === callerFile)) {
        addEdge(edges, `${callerFile}::${calledSymbol}`, chunk, callSite.line);
        continue;
      }

      // 3a. Symbol-name fallback for cross-package imports (direct symbol match)
      //     Works across languages: @liendev/review (TS), from package import ... (Python),
      //     use crate::... (Rust). Handles re-exports from barrel/index files.
      if (exportLocations && pkgSymbols?.has(calledSymbol)) {
        for (const loc of exportLocations) {
          if (loc.filepath === callerFile) continue;
          addEdge(edges, `${loc.filepath}::${calledSymbol}`, chunk, callSite.line);
        }
        continue;
      }

      // 3b. OOP method fallback: the caller imports a class (e.g., `use App\Models\Order`)
      //     and calls one of its methods (e.g., `findById`). The import is for the class,
      //     not the method, so direct symbol matching fails. Instead, check if the caller
      //     imports ANY symbol from a file that defines the called method.
      if (exportLocations) {
        let matched = false;
        for (const loc of exportLocations) {
          if (loc.filepath === callerFile) continue;
          if (chunkImportsFromFile(chunk, loc.filepath, pkgSymbols, exportFileMap)) {
            addEdge(edges, `${loc.filepath}::${calledSymbol}`, chunk, callSite.line);
            matched = true;
          }
        }
        if (matched) continue;

        // 3c. Same-namespace/module fallback: in PHP/Python/Rust, classes in the same
        //     namespace can reference each other without explicit imports. If the method
        //     is defined in a file within the same directory, create the edge.
        //     Skip for TS/JS which always require explicit imports.
        const lang = chunk.metadata.language;
        const supportsImplicitNamespace = lang && !['typescript', 'javascript'].includes(lang);
        if (supportsImplicitNamespace) {
          const otherFileLocations = exportLocations.filter(e => e.filepath !== callerFile);
          if (otherFileLocations.length > 0) {
            const callerDir = callerFile.substring(0, callerFile.lastIndexOf('/') + 1);
            for (const loc of otherFileLocations) {
              const locDir = loc.filepath.substring(0, loc.filepath.lastIndexOf('/') + 1);
              if (locDir === callerDir) {
                addEdge(edges, `${loc.filepath}::${calledSymbol}`, chunk, callSite.line);
              }
            }
          }
        }
      }
    }
  }

  return edges;
}

function addEdge(
  edges: Map<string, CallerEdge[]>,
  key: string,
  callerChunk: CodeChunk,
  callSiteLine: number,
): void {
  const existing = edges.get(key) ?? [];
  existing.push({
    caller: {
      filepath: callerChunk.metadata.file,
      symbolName: callerChunk.metadata.symbolName ?? 'unknown',
      chunk: callerChunk,
    },
    callSiteLine,
  });
  edges.set(key, existing);
}

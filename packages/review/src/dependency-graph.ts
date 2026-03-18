/**
 * In-memory dependency graph built from CodeChunk[] metadata.
 *
 * Resolves caller/callee relationships using imports, exports, and callSites
 * without any vector DB. Used by the bug-finding plugin to find all callers
 * of changed functions across the full repo.
 */

import path from 'node:path';
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

export interface DependencyGraph {
  /** Find all chunks that call a given exported symbol. */
  getCallers(filepath: string, symbolName: string): CallerEdge[];
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

  return {
    getCallers(filepath: string, symbolName: string): CallerEdge[] {
      return callerEdges.get(`${filepath}::${symbolName}`) ?? [];
    },
  };
}

type ExportEntry = { filepath: string; chunk: CodeChunk };
type ExportIndex = Map<string, ExportEntry[]>;
type ResolvedImport = { definitionFilepath: string };
type ChunkImportMap = Map<string, ResolvedImport>;

/** Pass 1: Build file set and export index. */
function buildExportIndex(chunks: CodeChunk[]): { fileSet: Set<string>; exportIndex: ExportIndex } {
  const fileSet = new Set<string>();
  const exportIndex: ExportIndex = new Map();

  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    fileSet.add(file);

    if (!chunk.metadata.exports) continue;
    for (const exportedSymbol of chunk.metadata.exports) {
      const existing = exportIndex.get(exportedSymbol) ?? [];
      if (!existing.some(e => e.filepath === file)) {
        existing.push({ filepath: file, chunk });
      }
      exportIndex.set(exportedSymbol, existing);
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

/** Pass 3: Build caller edges from call sites + resolved imports. */
function buildCallerEdges(
  chunks: CodeChunk[],
  chunkImportMaps: Map<CodeChunk, ChunkImportMap>,
  exportIndex: ExportIndex,
): Map<string, CallerEdge[]> {
  const edges = new Map<string, CallerEdge[]>();

  for (const chunk of chunks) {
    if (!chunk.metadata.callSites || chunk.metadata.callSites.length === 0) continue;

    const importMap = chunkImportMaps.get(chunk);
    const callerFile = chunk.metadata.file;

    for (const callSite of chunk.metadata.callSites) {
      const calledSymbol = callSite.symbol;

      // Try to resolve via imports
      const resolved = importMap?.get(calledSymbol);
      if (resolved) {
        addEdge(edges, `${resolved.definitionFilepath}::${calledSymbol}`, chunk, callSite.line);
        continue;
      }

      // Try same-file: symbol is exported by the same file
      const exportLocations = exportIndex.get(calledSymbol);
      if (exportLocations?.some(e => e.filepath === callerFile)) {
        addEdge(edges, `${callerFile}::${calledSymbol}`, chunk, callSite.line);
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

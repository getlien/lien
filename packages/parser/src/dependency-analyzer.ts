import type { CodeChunk } from './types.js';
import type { RiskLevel } from './insights/types.js';
import {
  createPathNormalizer,
  getCanonicalPath,
  matchesFile,
  isTestFile,
  isUnresolvableWholeModuleImport,
  importMatchesTarget,
} from './utils/path-matching.js';
import { RISK_ORDER } from './insights/types.js';
import {
  detectLanguage,
  hasEnclosingNamespaceAccess,
  hasDependentAttributionBlindSpot,
} from './ast/languages/registry.js';
import { findChunkLineIndex } from './chunk-line-lookup.js';
import {
  buildCSharpTypeReferenceIndex,
  resolveCSharpTypeReferenceDependents,
} from './csharp-type-reference-signals.js';
import {
  buildGoRootPackageIndex,
  resolveGoRootPackageDependents,
  isRootLevelGoFile,
} from './go-root-package-signals.js';
import {
  buildJvmSamePackageIndex,
  resolveJvmSamePackageDependents,
} from './jvm-same-package-signals.js';
import type { RecoveryIndexes } from './dependent-count-index.js';
import type { InferredDependentMechanism } from './inferred-dependent-mechanisms.js';

/**
 * Risk level thresholds for dependent count.
 * Based on impact analysis: more dependents = higher risk of breaking changes.
 */
export const DEPENDENT_COUNT_THRESHOLDS = {
  LOW: 5, // Few dependents, safe to change
  MEDIUM: 15, // Moderate impact, review dependents
  HIGH: 30, // High impact, careful planning needed
} as const;

/**
 * Complexity thresholds for risk assessment.
 * Based on cyclomatic complexity: higher complexity = harder to change safely.
 */
export const COMPLEXITY_THRESHOLDS = {
  HIGH_COMPLEXITY_DEPENDENT: 10, // Individual file is complex
  CRITICAL_AVG: 15, // Average complexity indicates systemic complexity
  CRITICAL_MAX: 25, // Peak complexity indicates hotspot
  HIGH_AVG: 10, // Moderately complex on average
  HIGH_MAX: 20, // Some complex functions exist
  MEDIUM_AVG: 6, // Slightly above simple code
  MEDIUM_MAX: 15, // Occasional branching
} as const;

export interface FileComplexityInfo {
  filepath: string;
  avgComplexity: number;
  maxComplexity: number;
  complexityScore: number;
  chunksWithComplexity: number;
}

/**
 * Result of `analyzeDependencies` below -- the chunk-only-index / complexity-
 * report consumer (`lien complexity`). See `FindDependentsResult` further down
 * for the richer shape used by `findDependents` (which `lien health` drives);
 * the two are deliberately separate types -- `calculateOverallComplexityMetrics` (leaves
 * `complexityMetrics` `undefined` when there's no complexity data at all) is
 * part of what makes them distinct, see that function's own doc comment.
 */
export interface DependencyAnalysisResult {
  dependents: Array<{
    filepath: string;
    isTestFile: boolean;
  }>;
  dependentCount: number;
  riskLevel: RiskLevel;
  complexityMetrics?: {
    averageComplexity: number;
    maxComplexity: number;
    filesWithComplexityData: number;
    highComplexityDependents: Array<{
      filepath: string;
      maxComplexity: number;
      avgComplexity: number;
    }>;
    complexityRiskBoost: RiskLevel;
  };
}

/**
 * Same field shape as `DependencyAnalysisResult['complexityMetrics']` above,
 * just always present rather than optional -- `findDependents`'s consumers
 * (the `get_dependents` MCP tool, `lien api-delta`) read
 * `complexityMetrics.maxComplexity` etc. unconditionally, so
 * `calculateComplexityMetricsOrDefault` (below
 * `calculateOverallComplexityMetrics`) substitutes an explicit all-zero/
 * `'low'` default instead of `undefined` when there's no complexity data,
 * rather than pushing an optional-chaining burden onto every caller.
 */
export type ComplexityMetrics = NonNullable<DependencyAnalysisResult['complexityMetrics']>;

/**
 * One (chunk, raw import specifier) pair in an import index bucket. #994
 * Phase 3: the index used to store bare chunks, discarding both the raw
 * (pre-normalization) specifier and the fact that a bucket can span multiple
 * importer files -- so match-time code (`findDependentChunks`'s fuzzy loop)
 * had nothing to hand `importMatchesTarget` and had to re-derive the #887/
 * #929 guards per chunk instead. Keeping `rawSpecifier` alongside each chunk
 * means every entry now carries both of `importMatchesTarget`'s required
 * inputs (the raw specifier and `chunk.metadata.file`), so match-time code
 * can call the single guarded primitive directly. See path-matching.ts:378
 * for the resulting invariant.
 */
export interface ImportIndexEntry<T extends CodeChunk> {
  chunk: T;
  rawSpecifier: string;
}

/**
 * Builds an index mapping normalized import paths to (chunk, raw specifier)
 * entries for chunks that import them. Enables O(1) lookup instead of
 * O(n*m) iteration.
 *
 * Skips bare whole-module imports (#884): for a `wholeModuleImports`
 * language (Swift), a bare import can only ever match a target through
 * basename coincidence, not a real per-file dependency — see
 * `isUnresolvableWholeModuleImport`'s doc comment. `findDependents` below
 * applies the identical guard via its own `indexImportEntry` -- this file
 * feeds both `analyzeDependencies` (consumed by `lien complexity` for
 * complexity reports) and `findDependents` (consumed by `lien health` for the
 * fan-in axis), so both index builders need the same
 * treatment. This is an early-drop optimization, not a match-time guard --
 * retaining `rawSpecifier` on every entry that DOES get indexed doesn't
 * require giving it up.
 *
 * @param chunks - All chunks from the vector database
 * @param normalizePathCached - Cached path normalization function
 * @returns Map of normalized import paths to matching (chunk, rawSpecifier) entries
 */
function buildImportIndex(
  chunks: CodeChunk[],
  normalizePathCached: (path: string) => string,
): Map<string, ImportIndexEntry<CodeChunk>[]> {
  const importIndex = new Map<string, ImportIndexEntry<CodeChunk>[]>();

  for (const chunk of chunks) {
    const imports = chunk.metadata.imports || [];
    for (const imp of imports) {
      if (isUnresolvableWholeModuleImport(imp, chunk.metadata.file)) continue;
      const normalizedImport = normalizePathCached(imp);
      let entries = importIndex.get(normalizedImport);
      if (!entries) {
        entries = [];
        importIndex.set(normalizedImport, entries);
      }
      entries.push({ chunk, rawSpecifier: imp });
    }
  }

  return importIndex;
}

/**
 * Add the chunks in an import-index bucket to the dependent set via
 * `addChunk`, applying all three match-side guards (#884/#887/#929) through
 * `importMatchesTarget` -- one call per entry, using that entry's own
 * `rawSpecifier` and `chunk.metadata.file` (#994 Phase 3). Previously this
 * function received only a normalized specifier with no per-chunk importer
 * identity, so it had to reconstruct the #887/#929 guards itself via two
 * extra `matchesFile` calls (`ambiguous`/`pythonOnlyMatch`) instead of
 * calling the primitive directly -- see git history on this function for
 * that shape. Because each `ImportIndexEntry` now carries its own raw
 * specifier, a bucket spanning multiple importer files (and in principle
 * languages) is handled correctly for free: `importMatchesTarget` derives
 * each guard from that entry's own importer file, per entry, exactly like
 * every other match-side call site.
 */
export function addFuzzyMatchChunks<T extends CodeChunk>(
  normalizedTarget: string,
  entries: ImportIndexEntry<T>[],
  normalizePathCached: (path: string) => string,
  addChunk: (chunk: T) => void,
): void {
  for (const entry of entries) {
    if (
      importMatchesTarget(
        entry.rawSpecifier,
        entry.chunk.metadata.file,
        normalizedTarget,
        normalizePathCached,
      )
    ) {
      addChunk(entry.chunk);
    }
  }
}

/**
 * Finds all chunks that import the target file using index + fuzzy matching.
 *
 * @param normalizedTarget - The normalized path of the target file
 * @param importIndex - Index mapping import paths to (chunk, rawSpecifier) entries
 * @param normalizePathCached - Cached path normalization function, threaded
 *   through to `importMatchesTarget` for the fuzzy match branch (#994)
 * @returns Array of chunks that import the target file (deduplicated)
 */
export function findDependentChunks<T extends CodeChunk>(
  normalizedTarget: string,
  importIndex: Map<string, ImportIndexEntry<T>[]>,
  normalizePathCached: (path: string) => string,
): T[] {
  const dependentChunks: T[] = [];
  const seenChunkIds = new Set<string>();

  const addChunk = (chunk: T): void => {
    const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
    if (!seenChunkIds.has(chunkId)) {
      dependentChunks.push(chunk);
      seenChunkIds.add(chunkId);
    }
  };

  // Direct index lookup (fastest path). Bucket entries were built via the
  // identical normalizePathCached, and already passed the build-time #884
  // prune, so no further guard is needed for an exact key match.
  const directMatches = importIndex.get(normalizedTarget);
  if (directMatches) {
    for (const entry of directMatches) {
      addChunk(entry.chunk);
    }
  }

  // Fuzzy match for relative imports and path variations
  // Note: This is O(M) where M = unique import paths. For large codebases with many
  // violations, consider caching fuzzy match results at a higher level.
  for (const [normalizedImport, entries] of importIndex.entries()) {
    if (normalizedImport !== normalizedTarget) {
      addFuzzyMatchChunks(normalizedTarget, entries, normalizePathCached, addChunk);
    }
  }

  return dependentChunks;
}

/**
 * Groups chunks by their canonical file path.
 *
 * Shared by `analyzeDependencies` and `findDependents` below -- both need
 * "group these chunks by the file they came from," canonicalized against
 * the same `workspaceRoot` so results are stable regardless of whether a
 * chunk's raw path is absolute or relative.
 *
 * @param chunks - Array of chunks to group
 * @param workspaceRoot - The workspace root directory
 * @returns Map of canonical file paths to their chunks
 */
function groupChunksByFile<T extends CodeChunk>(
  chunks: T[],
  workspaceRoot: string,
): Map<string, T[]> {
  const chunksByFile = new Map<string, T[]>();

  for (const chunk of chunks) {
    const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
    let existing = chunksByFile.get(canonical);
    if (!existing) {
      existing = [];
      chunksByFile.set(canonical, existing);
    }
    existing.push(chunk);
  }

  return chunksByFile;
}

/**
 * Calculates complexity metrics for each file based on its chunks. Shared by
 * `analyzeDependencies` and `findDependents` below.
 *
 * @param chunksByFile - Map of file paths to their chunks
 * @returns Array of complexity info for files with complexity data
 */
function calculateFileComplexities<T extends CodeChunk>(
  chunksByFile: Map<string, T[]>,
): FileComplexityInfo[] {
  const fileComplexities: FileComplexityInfo[] = [];

  for (const [filepath, chunks] of chunksByFile.entries()) {
    const complexities = chunks
      .map(c => c.metadata.complexity)
      .filter((c): c is number => typeof c === 'number' && c > 0);

    if (complexities.length > 0) {
      const sum = complexities.reduce((a, b) => a + b, 0);
      const avg = sum / complexities.length;
      const max = Math.max(...complexities);

      fileComplexities.push({
        filepath,
        avgComplexity: Math.round(avg * 10) / 10,
        maxComplexity: max,
        complexityScore: sum,
        chunksWithComplexity: complexities.length,
      });
    }
  }

  return fileComplexities;
}

/**
 * Calculates overall complexity metrics from per-file data.
 *
 * Returns `undefined` when there's no complexity data at all -- this is
 * `analyzeDependencies`'s own contract (its tests pin this, e.g. "no
 * complexity data" expecting `result.complexityMetrics` to be `undefined`).
 * `findDependents` below has a different, always-present contract for the
 * same shape; see `calculateComplexityMetricsOrDefault`, which wraps this
 * function rather than re-implementing its computation.
 *
 * @param fileComplexities - Array of per-file complexity info
 * @returns Aggregated complexity metrics, or undefined if no data
 */
function calculateOverallComplexityMetrics(
  fileComplexities: FileComplexityInfo[],
): DependencyAnalysisResult['complexityMetrics'] | undefined {
  if (fileComplexities.length === 0) {
    return undefined;
  }

  const allAvgs = fileComplexities.map(f => f.avgComplexity);
  const allMaxes = fileComplexities.map(f => f.maxComplexity);
  const totalAvg = allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length;
  const globalMax = Math.max(...allMaxes);

  // Identify high-complexity dependents (top 5)
  const highComplexityDependents = fileComplexities
    .filter(f => f.maxComplexity > COMPLEXITY_THRESHOLDS.HIGH_COMPLEXITY_DEPENDENT)
    .sort((a, b) => b.maxComplexity - a.maxComplexity)
    .slice(0, 5)
    .map(f => ({
      filepath: f.filepath,
      maxComplexity: f.maxComplexity,
      avgComplexity: f.avgComplexity,
    }));

  // Calculate complexity-based risk boost
  const complexityRiskBoost = calculateComplexityRiskBoost(totalAvg, globalMax);

  return {
    averageComplexity: Math.round(totalAvg * 10) / 10,
    maxComplexity: globalMax,
    filesWithComplexityData: fileComplexities.length,
    highComplexityDependents,
    complexityRiskBoost,
  };
}

/**
 * `findDependents`'s flavor of `calculateOverallComplexityMetrics` above:
 * same computation, but substitutes an explicit all-zero/`'low'` default
 * instead of `undefined` when `fileComplexities` is empty -- see
 * `ComplexityMetrics`'s doc comment for why that contract differs from
 * `analyzeDependencies`'s. Deliberately a thin wrapper rather than a copy:
 * the non-empty branch is identical, so only the empty-case default is
 * spelled out here.
 */
function calculateComplexityMetricsOrDefault(
  fileComplexities: FileComplexityInfo[],
): ComplexityMetrics {
  return (
    calculateOverallComplexityMetrics(fileComplexities) ?? {
      averageComplexity: 0,
      maxComplexity: 0,
      filesWithComplexityData: 0,
      highComplexityDependents: [],
      complexityRiskBoost: 'low',
    }
  );
}

/**
 * Calculates risk level based on complexity thresholds. Shared by
 * `analyzeDependencies` and `findDependents` below -- byte-identical logic,
 * so it was never actually duplicated the way the other five helpers were.
 *
 * @param avgComplexity - Average complexity across all files
 * @param maxComplexity - Maximum complexity found in any file
 * @returns Risk level based on complexity thresholds
 */
function calculateComplexityRiskBoost(avgComplexity: number, maxComplexity: number): RiskLevel {
  if (
    avgComplexity > COMPLEXITY_THRESHOLDS.CRITICAL_AVG ||
    maxComplexity > COMPLEXITY_THRESHOLDS.CRITICAL_MAX
  ) {
    return 'critical';
  }
  if (
    avgComplexity > COMPLEXITY_THRESHOLDS.HIGH_AVG ||
    maxComplexity > COMPLEXITY_THRESHOLDS.HIGH_MAX
  ) {
    return 'high';
  }
  if (
    avgComplexity > COMPLEXITY_THRESHOLDS.MEDIUM_AVG ||
    maxComplexity > COMPLEXITY_THRESHOLDS.MEDIUM_MAX
  ) {
    return 'medium';
  }
  return 'low';
}

/**
 * Calculates risk level based on dependent count.
 *
 * @param count - Number of dependent files
 * @returns Risk level based on dependent count thresholds
 */
function calculateRiskLevelFromCount(count: number): RiskLevel {
  if (count <= DEPENDENT_COUNT_THRESHOLDS.LOW) {
    return 'low';
  }
  if (count <= DEPENDENT_COUNT_THRESHOLDS.MEDIUM) {
    return 'medium';
  }
  if (count <= DEPENDENT_COUNT_THRESHOLDS.HIGH) {
    return 'high';
  }
  return 'critical';
}

/**
 * Maximum depth for following re-export chains.
 * Covers real-world barrel chains (A → barrel → barrel → consumer)
 * without risk of runaway traversal.
 */
const MAX_REEXPORT_DEPTH = 3;

/**
 * Check if a single chunk imports from the given source path.
 * Checks both `importedSymbols` keys and raw `imports` array.
 *
 * Uses `importMatchesTarget`, which applies the #884 whole-module guard
 * before `matchesFile` — see its doc comment in path-matching.ts (#886).
 */
export function chunkImportsFrom(
  chunk: CodeChunk,
  sourcePath: string,
  normalizePathCached: (path: string) => string,
): boolean {
  const importedSymbols = chunk.metadata.importedSymbols;
  const importedSymbolPaths =
    importedSymbols && typeof importedSymbols === 'object' ? Object.keys(importedSymbols) : [];
  const allImportPaths = [...importedSymbolPaths, ...(chunk.metadata.imports || [])];

  return allImportPaths.some(imp =>
    importMatchesTarget(imp, chunk.metadata.file, sourcePath, normalizePathCached),
  );
}

/**
 * Group chunks by their normalized file path.
 */
export function groupChunksByNormalizedPath(
  chunks: CodeChunk[],
  normalizePathCached: (path: string) => string,
): Map<string, CodeChunk[]> {
  const grouped = new Map<string, CodeChunk[]>();
  for (const chunk of chunks) {
    const canonical = normalizePathCached(chunk.metadata.file);
    let list = grouped.get(canonical);
    if (!list) {
      list = [];
      grouped.set(canonical, list);
    }
    list.push(chunk);
  }
  return grouped;
}

/**
 * Collect the symbols a file imports from a given source path, sourced
 * exclusively from `importedSymbols`.
 *
 * Deliberately ignores the raw `imports` array — a raw-only match means the
 * file imports for side effect or does `export * from`, neither of which
 * should qualify it as a re-exporter on its own (#526).
 *
 * Uses `importMatchesTarget`, which applies the #884 whole-module guard
 * before `matchesFile` — see its doc comment in path-matching.ts (#886).
 */
function collectImportedSymbolsFromSource(
  chunks: CodeChunk[],
  sourcePath: string,
  normalizePathCached: (path: string) => string,
): Set<string> {
  const symbols = new Set<string>();
  for (const chunk of chunks) {
    const importedSymbols = chunk.metadata.importedSymbols;
    if (!importedSymbols || typeof importedSymbols !== 'object') continue;
    Object.entries(importedSymbols)
      .filter(([importPath]) =>
        importMatchesTarget(importPath, chunk.metadata.file, sourcePath, normalizePathCached),
      )
      .forEach(([, syms]) => syms.forEach(sym => symbols.add(sym)));
  }
  return symbols;
}

/**
 * Collect all symbols the file exports across its chunks.
 */
function collectExportsFromChunks(chunks: CodeChunk[]): Set<string> {
  const allExports = new Set<string>();
  for (const chunk of chunks) {
    for (const exp of chunk.metadata.exports || []) allExports.add(exp);
  }
  return allExports;
}

/**
 * Find which symbols a file (given its chunks) genuinely re-exports from a
 * source path.
 *
 * Requires a non-empty intersection between (a) symbols the file imports from
 * the source and (b) symbols the file exports. A plain named import (`import
 * { x } from './a'`) paired with an unrelated own export (`export function y`)
 * is no longer a re-exporter — closing the #526 false positive.
 *
 * Wildcard markers (`'*'` from Rust `use foo::*`, `'* as x'` from JS
 * namespace imports) still trigger re-export detection: both mean "we pulled
 * in everything the source exports," so every own export counts as
 * re-exported.
 *
 * Single source of truth for this algorithm: both `fileIsReExporter` below
 * and `findDependents`'s own `buildReExportGraph` consume this (#532) --
 * previously duplicated across the parser and CLI packages before
 * `findDependents` moved here; now a single in-module call either way.
 *
 * @returns The re-exported symbols; empty means the file is not a re-exporter.
 */
export function findReExportedSymbolsForFile(
  chunks: CodeChunk[],
  sourcePath: string,
  normalizePathCached: (path: string) => string,
): string[] {
  const importsFromSource = collectImportedSymbolsFromSource(
    chunks,
    sourcePath,
    normalizePathCached,
  );
  if (importsFromSource.size === 0) return [];

  const allExports = collectExportsFromChunks(chunks);
  if (allExports.size === 0) return [];

  // Wildcards mean "imported everything"; every own export counts as re-exported.
  if (importsFromSource.has('*')) return [...allExports];
  for (const sym of importsFromSource) {
    if (sym.startsWith('* as ')) return [...allExports];
  }

  return [...importsFromSource].filter(sym => allExports.has(sym));
}

/**
 * Check if a file (given its chunks) genuinely re-exports anything from a
 * source path. Thin boolean wrapper over `findReExportedSymbolsForFile`.
 */
export function fileIsReExporter(
  chunks: CodeChunk[],
  sourcePath: string,
  normalizePathCached: (path: string) => string,
): boolean {
  return findReExportedSymbolsForFile(chunks, sourcePath, normalizePathCached).length > 0;
}

/**
 * Build a list of files that re-export from the target file.
 *
 * A re-exporter is a file where a symbol appears in both
 * `importedSymbols[targetPath]` (or raw `imports`) AND `exports`.
 *
 * Shared by `analyzeDependencies` and `findDependents` below. Returns bare
 * filepaths rather than a filepath+symbols struct: only the filepath is
 * ever consumed downstream (by `findTransitiveDependents`'s BFS), so there
 * is nothing to gain from also carrying each file's re-exported symbol list
 * through this graph.
 */
function buildReExportGraph<T extends CodeChunk>(
  allChunksByFile: Map<string, T[]>,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
): string[] {
  const reExporters: string[] = [];

  for (const [filepath, chunks] of allChunksByFile.entries()) {
    if (matchesFile(filepath, normalizedTarget)) continue;
    if (fileIsReExporter(chunks, normalizedTarget, normalizePathCached)) {
      reExporters.push(filepath);
    }
  }

  return reExporters;
}

/**
 * Process a single dependent chunk during BFS traversal.
 *
 * Returns the chunk if its file hasn't been reported as a dependent yet, or
 * `null` if it has (dedup for the output list -- `reported`). Independently
 * of that, if `chunkFile` hasn't already been queued for its OWN re-export
 * exploration, checks whether it re-exports from `reExporterPath` and -- if
 * so -- enqueues it (`queued`).
 *
 * `reported` and `queued` are deliberately two separate sets, not one
 * (#1044): a file reachable from more than one depth-1 re-export candidate
 * (a common shape -- a namespace-import heuristic in `fileIsReExporter`
 * flags any file that imports-and-also-exports as a "re-exporter," so a
 * genuine barrel and several files that merely happen to import-for-
 * internal-use both qualify) is a genuine re-exporter of SOME of those
 * candidates and not others. A single shared `visited` set used to gate
 * both concerns at once, so whichever candidate's turn came first in the
 * (traversal-order-dependent) queue "consumed" the file: if that first
 * candidate happened to be a dead end (the file doesn't re-export from
 * it), the file got reported once but never queued for further
 * exploration, and the genuine chain through a LATER candidate was never
 * checked at all -- silently dropping every dependent reachable only past
 * that file, non-deterministically, depending on which candidate the
 * BFS's traversal order (itself downstream of nondeterministic concurrent
 * file-scan order) happened to process first. Checking the re-exporter
 * condition once per (file, candidate) pair -- gated only on `queued`, not
 * on whether the file was already reported -- makes the result depend on
 * whether ANY valid chain exists, not on which one was tried first.
 */
function processTransitiveChunk(
  chunk: CodeChunk,
  reExporterPath: string,
  depth: number,
  reported: Set<string>,
  queued: Set<string>,
  checkedThisStep: Set<string>,
  allChunksByFile: Map<string, CodeChunk[]>,
  normalizePathCached: (path: string) => string,
  queue: Array<[string, number]>,
): CodeChunk | null {
  const chunkFile = normalizePathCached(chunk.metadata.file);

  // `checkedThisStep` memoizes the re-exporter check per (file,
  // reExporterPath) pair within one BFS step, since `dependentChunks` can
  // contain many chunks for the same file -- without it, a dead-end file
  // with N chunks would re-run `fileIsReExporter` N times for no benefit.
  if (depth < MAX_REEXPORT_DEPTH && !queued.has(chunkFile) && !checkedThisStep.has(chunkFile)) {
    checkedThisStep.add(chunkFile);
    const fileChunks = allChunksByFile.get(chunkFile) || [];
    if (fileIsReExporter(fileChunks, reExporterPath, normalizePathCached)) {
      queue.push([chunkFile, depth + 1]);
      queued.add(chunkFile);
    }
  }

  if (reported.has(chunkFile)) return null;
  reported.add(chunkFile);
  return chunk;
}

/**
 * Find transitive dependents through re-export chains using BFS.
 * Bounded to MAX_REEXPORT_DEPTH.
 *
 * `reported` (output dedup) and `queued` (BFS-exploration dedup) are kept
 * as two separate sets -- see `processTransitiveChunk`'s doc comment for why
 * conflating them into one `visited` set made the result depend on BFS
 * traversal order (#1044).
 */
export function findTransitiveDependents(
  reExporterPaths: string[],
  importIndex: Map<string, ImportIndexEntry<CodeChunk>[]>,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  allChunksByFile: Map<string, CodeChunk[]>,
  existingFiles: Set<string>,
): CodeChunk[] {
  const transitiveChunks: CodeChunk[] = [];
  const reported = new Set<string>([normalizedTarget, ...existingFiles]);
  const queued = new Set<string>();

  const queue: Array<[string, number]> = [];
  for (const rePath of reExporterPaths) {
    if (!queued.has(rePath)) {
      queue.push([rePath, 1]);
      queued.add(rePath);
    }
  }

  while (queue.length > 0) {
    const [reExporterPath, depth] = queue.shift()!;
    const dependentChunks = findDependentChunks(reExporterPath, importIndex, normalizePathCached);
    const checkedThisStep = new Set<string>();

    for (const chunk of dependentChunks) {
      const result = processTransitiveChunk(
        chunk,
        reExporterPath,
        depth,
        reported,
        queued,
        checkedThisStep,
        allChunksByFile,
        normalizePathCached,
        queue,
      );
      if (result) transitiveChunks.push(result);
    }
  }

  return transitiveChunks;
}

/**
 * Find transitive dependents through re-export chains (barrel files) and
 * merge them into `chunksByFile` in place. Extracted out of
 * `analyzeDependencies` to keep that function's own complexity flat (#994
 * Phase 3) -- mirrors `resolveTransitiveDependents`/`mergeTransitiveDependents`
 * further down, the `findDependents` equivalent of this same merge; this
 * version has no `ScanContext`/`log` callback since `analyzeDependencies`
 * has no logging contract.
 */
function mergeReExportTransitiveDependents(
  allChunksByFile: Map<string, CodeChunk[]>,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  importIndex: Map<string, ImportIndexEntry<CodeChunk>[]>,
  workspaceRoot: string,
  chunksByFile: Map<string, CodeChunk[]>,
): void {
  const reExporterPaths = buildReExportGraph(
    allChunksByFile,
    normalizedTarget,
    normalizePathCached,
  );
  if (reExporterPaths.length === 0) return;

  const existingFiles = new Set(chunksByFile.keys());
  const transitiveChunks = findTransitiveDependents(
    reExporterPaths,
    importIndex,
    normalizedTarget,
    normalizePathCached,
    allChunksByFile,
    existingFiles,
  );
  if (transitiveChunks.length > 0) {
    const transitiveByFile = groupChunksByFile(transitiveChunks, workspaceRoot);
    mergeChunksByFile(chunksByFile, transitiveByFile);
  }
}

/**
 * Analyzes dependencies for a given file by finding all chunks that import it.
 *
 * @param targetFilepath - The file to analyze dependencies for
 * @param allChunks - All chunks from the vector database
 * @param workspaceRoot - The workspace root directory
 * @returns Dependency analysis including dependents, count, and risk level
 */
export function analyzeDependencies(
  targetFilepath: string,
  allChunks: CodeChunk[],
  workspaceRoot: string,
): DependencyAnalysisResult {
  // Create cached path normalizer
  const normalizePathCached = createPathNormalizer(workspaceRoot);

  // Build import index for efficient lookup
  const importIndex = buildImportIndex(allChunks, normalizePathCached);

  // Find all dependent chunks
  const normalizedTarget = normalizePathCached(targetFilepath);
  const dependentChunks = findDependentChunks(normalizedTarget, importIndex, normalizePathCached);

  // Group by file for analysis
  const chunksByFile = groupChunksByFile(dependentChunks, workspaceRoot);

  // Find transitive dependents through re-export chains (barrel files)
  const allChunksByFile = groupChunksByNormalizedPath(allChunks, normalizePathCached);
  mergeReExportTransitiveDependents(
    allChunksByFile,
    normalizedTarget,
    normalizePathCached,
    importIndex,
    workspaceRoot,
    chunksByFile,
  );

  // Calculate complexity metrics
  const fileComplexities = calculateFileComplexities(chunksByFile);
  const complexityMetrics = calculateOverallComplexityMetrics(fileComplexities);

  // Build dependents list
  const dependents = Array.from(chunksByFile.keys()).map(filepath => ({
    filepath,
    isTestFile: isTestFile(filepath),
  }));

  // Calculate risk level
  let riskLevel = calculateRiskLevelFromCount(dependents.length);

  // Boost risk level if complexity warrants it
  if (complexityMetrics?.complexityRiskBoost) {
    if (RISK_ORDER[complexityMetrics.complexityRiskBoost] > RISK_ORDER[riskLevel]) {
      riskLevel = complexityMetrics.complexityRiskBoost;
    }
  }

  return {
    dependents,
    dependentCount: dependents.length,
    riskLevel,
    complexityMetrics,
  };
}

// =============================================================================
// findDependents — the richer reverse-dependency engine, now driven by
// `lien health`'s fan-in axis. Originally the body of the `get_dependents` MCP
// tool and moved here from `packages/cli/src/mcp/handlers/dependency-analyzer.ts`;
// that tool, and the persisted store it read from, have since been deleted.
// The move is why this survived them: it is chunk-in/chunk-out and never
// depended on the store, so callers now hand it chunks straight from
// `performChunkOnlyIndex`. Generic over `<T extends CodeChunk>` so a caller
// carrying a richer chunk type passes it through without a widening cast.
// =============================================================================

/**
 * A single usage of a symbol (call site).
 */
export interface SymbolUsage {
  /** The function/method that contains this call */
  callerSymbol: string;
  /** Line number where the call occurs */
  line: number;
  /** Code snippet showing the call */
  snippet: string;
}

/**
 * Dependent file info, with optional symbol-level usages.
 */
export interface DependentInfo {
  filepath: string;
  isTestFile: boolean;
  /** Only present when symbol parameter is provided */
  usages?: SymbolUsage[];
  /** Depth at which this dependent was first discovered (1 = direct). */
  hops?: number;
  /**
   * Present (`'inferred'`) only for a dependent recovered by a non-import
   * fallback instead of a real import edge -- absent for every ordinary,
   * import-verified dependent (the default, confident tier). A caller that
   * needs to distinguish "verified" from "recovered, lower confidence"
   * should filter on this field rather than assuming every entry in
   * `dependents` came from the import graph.
   *
   * Which fallbacks exist is NOT restated here: they are enumerated once, with
   * their canonical prose, in `./inferred-dependent-mechanisms.ts`, and named
   * per dependent by `inferredVia` below. This comment used to hand-list them
   * and was one of six surfaces that still said "C# only" after #1039 added a
   * second (see that module's doc for the measured consequence).
   */
  confidence?: 'inferred';
  /**
   * Which fallback recovered this dependent. Set if and only if `confidence`
   * is `'inferred'` -- both are written together by `inferredDependent()`
   * below, which is the only way either is produced.
   *
   * Exists so a consumer describing a recovered dependent can say which
   * mechanism ran instead of assuming one (#1018). Downstream prose must read
   * `INFERRED_DEPENDENT_MECHANISMS[inferredVia]` rather than restating it.
   */
  inferredVia?: InferredDependentMechanism;
}

/**
 * The one constructor for a fallback-recovered dependent.
 *
 * Writing `confidence` and `inferredVia` together, in one place, is what keeps
 * the pair from drifting: there is no code path that can produce a
 * `confidence: 'inferred'` dependent whose mechanism is unknown, so a consumer
 * may rely on `inferredVia` being present whenever `confidence` is. A third
 * fallback (#1067) calls this with its own mechanism id and inherits every
 * prose surface for free.
 */
export function inferredDependent(
  filepath: string,
  mechanism: InferredDependentMechanism,
): DependentInfo {
  return {
    filepath,
    isTestFile: isTestFile(filepath),
    confidence: 'inferred',
    inferredVia: mechanism,
  };
}

/**
 * Result of `findDependents` below. Generic over `<T extends CodeChunk>` so
 * `chunksByFile`/`allChunks` preserve whatever chunk shape the caller fed
 * in (the CLI instantiates this at `T = SearchResult`, via its own
 * `DependencyAnalysisResult = FindDependentsResult<SearchResult>` alias).
 */
export interface FindDependentsResult<T extends CodeChunk = CodeChunk> {
  dependents: DependentInfo[];
  productionDependentCount: number;
  testDependentCount: number;
  chunksByFile: Map<string, T[]>;
  fileComplexities: FileComplexityInfo[];
  complexityMetrics: ComplexityMetrics;
  /**
   * Always `false`: `findDependents` reads its whole chunk set eagerly in
   * one pass (see `findDependents`'s own doc comment on `Iterable<T>`),
   * never a paginated/truncated one. Kept on the result shape for API
   * stability with callers that already destructure it.
   */
  hitLimit: boolean;
  allChunks: T[];
  /** Total count of usages across all files (when symbol is specified) */
  totalUsageCount?: number;
  /** True when BFS stopped because it hit the maxNodes cap. */
  truncated: boolean;
  /** Count of production dependents that are NOT imported by any test file. */
  uncoveredProductionDependents: number;
  /**
   * True when `symbol` was requested but couldn't be attributed at the
   * symbol level (it isn't a top-level export of the target file -- the
   * signature of a method or constructor, which no import statement in any
   * language names independently of its class -- see `buildDependentsList`),
   * so `dependents`/`riskLevel` were widened to the full file-level answer
   * instead of asserting an unverifiable symbol-scoped count.
   */
  symbolAttributionDegraded?: boolean;
  /**
   * Only meaningful when `symbolAttributionDegraded` is `true`. Whether
   * `symbol` was found ANYWHERE among the target file's own indexed chunks
   * (as a chunk's own `symbolName` -- methods, constructors, and nested
   * functions/classes each get their own chunk -- or inside that chunk's
   * `symbols` bag), as opposed to a top-level export specifically. `true`
   * backs up the "likely a method or constructor" reading; `false` means the
   * name doesn't appear in this file's indexed chunks at all, which is just
   * as consistent with a typo, a hallucinated symbol, or one that used to
   * exist and was removed -- a caller wording the caveat should hedge
   * instead of asserting the method/constructor cause in that case.
   */
  symbolFoundInFile?: boolean;
  /**
   * True for a SYMBOL-level query (`symbol` requested) where `symbol`
   * resolves to a real class/struct/interface/enum declaration in
   * `filepath` -- #1015. Distinct from (and mutually exclusive with)
   * `symbolAttributionDegraded`: that one fires when `symbol` is NOT a
   * top-level export at all (the shape of a method/constructor/typo, #931);
   * this one fires when `symbol` VERY MUCH IS a top-level export, just one
   * whose kind (a type) call-site tracking structurally cannot see through.
   * Nothing "calls" a type by its own name the way a function call does --
   * constructor calls, type hints, `extends`/`implements` clauses, generic
   * type arguments, and dependency-injected property access don't reliably
   * surface as a tracked `callSite` -- so `totalUsageCount`/`dependents[].usages`
   * are a partial, best-effort floor here (often `0` even when real usages
   * exist), never a verified total, unlike a function/method symbol query
   * where `totalUsageCount` IS call-site-verified (see #1015's PHP
   * `formatPrice` reference case). `dependents`/`dependentCount` (which
   * files import the symbol) stay reliable either way -- only the
   * per-symbol usage count is in question. See `isTypeDeclarationSymbol`.
   */
  typeSymbolAttributionIncomplete?: boolean;
  /**
   * True for a query -- file-level (no `symbol`) OR symbol-level -- that
   * came back with zero dependents for a language where
   * `hasDependentAttributionBlindSpot` is set (C#, Java, Kotlin, and Swift
   * as of #1005 -- see that predicate's doc comment for why each qualifies
   * for its own reason), EVEN AFTER attempting the type-reference-matching
   * recovery below (`dependentAttributionPartial`, still C#-only -- see
   * `enrichWithCSharpTypeReferenceDependents`). Those languages let a real
   * caller use `filepath`'s exports with no per-file import statement naming
   * it at all (C#'s `global using` / implicit enclosing-namespace member
   * access, #930; Java/Kotlin's same-package visibility; Swift's
   * whole-module access), so the import-graph scan this function runs has
   * no signal for that usage shape. `dependentCount: 0` / `riskLevel: "low"`
   * in this case means "neither scan found anything," not "nothing depends
   * on this file."
   *
   * Widened to symbol-level queries by #1097: until then,
   * `checkDependentAttributionIncomplete` unconditionally skipped this
   * determination whenever `symbol` was set, which is exactly the shape of
   * `get_dependents({filepath, symbol})` and every `lien api-delta` check --
   * so a symbol-scoped query in one of these languages could report a bare,
   * uncaveated zero even when the file-level query on the identical file
   * correctly carried this same flag. Skipped for a symbol query when
   * `typeSymbolAttributionIncomplete` already explains the same zero (its
   * own, more specific caveat), so the two never contradict each other on
   * one response; no explicit exclusion is needed for
   * `symbolAttributionDegraded`, since that one only ever fires with a
   * nonzero final `dependents.length` (it widens to the file-level answer,
   * which requires at least one file to begin with) -- the zero-count guard
   * here already excludes it.
   */
  dependentAttributionIncomplete?: boolean;
  /**
   * True for a FILE-level query (no `symbol`) where the import graph found
   * zero dependents but the C# type-reference-matching fallback
   * (`findCSharpTypeReferenceDependents`, #930's remaining half) recovered
   * one or more. Those recovered entries are tagged `confidence: 'inferred'`
   * on `DependentInfo` -- a word-boundary text match against a
   * uniquely-declared type name, not an import-verified edge -- so
   * `dependentCount`/`riskLevel` here are a recovered LOWER BOUND, not a
   * verified/complete answer: the heuristic can still miss a real dependent
   * that references the type via an alias, a generic type argument, or
   * reflection, none of which spell the bare type name in a matchable way.
   */
  dependentAttributionPartial?: boolean;
  /**
   * False when the requested target has zero chunks anywhere in the scanned
   * index (#928) — i.e. it isn't a real file the indexer has seen, whether
   * because it was never indexed, is misspelled, or genuinely has no
   * extractable content. `matchesFile`'s fuzzy-matching strategies are tuned
   * to resolve real ambiguous specifiers (relative imports, namespace
   * prefixes, bare crate-root modules); they were never meant to stand in
   * for an existence check, and running them against a target with no
   * chunks of its own risks matching on textual coincidence alone (a
   * fabricated path silently inheriting an unrelated real file's entire
   * dependent graph — see the PHP `Command/Command.php` basename-collision
   * repro in #928). When `false`, `dependents`/`symbolAttributionDegraded`/
   * `dependentAttributionIncomplete` above are moot -- `dependents` is
   * deliberately left empty rather than fuzzy-matched, and callers should
   * treat the whole result as "unresolved", not "confirmed zero dependents".
   */
  targetIndexed: boolean;
}

/**
 * Check if any chunk in the file imports the target symbol from any of the
 * given paths (direct target or re-exporter paths).
 *
 * Uses `importMatchesTarget`, which applies the #884 whole-module guard
 * before `matchesFile` — see its doc comment in path-matching.ts (#886).
 *
 * Qualified-access fallback: no language's import statement names a class's
 * members, or (for Go) a package's individual functions, independently of
 * the class/package itself -- `use Ns\\Cursor;` records `Cursor`, never
 * `__construct`; Go's `import "app/bytesconv"` records the package alias
 * `bytesconv`, never `StringToBytes`. Requiring a literal `targetSymbol`
 * match inside `importedSymbols` for those cases means the check can never
 * pass, even though the call site itself (`bytesconv.StringToBytes(...)`,
 * `$cursor->moveUp()`) is genuine, correctly-attributed evidence -- and a
 * caller mandated to check this before touching a method/constructor/
 * package-level function would see a false "0 dependents, low risk"
 * all-clear on code with real callers. So once a chunk is confirmed to
 * import from the target path at all, a real call site named
 * `targetSymbol` in that same chunk is accepted too -- the same category of
 * trade-off already documented on `findSymbolUsages` below for JS namespace
 * imports (occasional same-name false positives, far better than a
 * guaranteed false negative for every member/qualified symbol).
 */
function fileImportsSymbolFromAny<T extends CodeChunk>(
  chunks: T[],
  targetSymbol: string,
  targetPaths: string[],
  normalizePathCached: (path: string) => string,
): boolean {
  return chunks.some(chunk => {
    const importedSymbols = chunk.metadata.importedSymbols;
    if (!importedSymbols) return false;

    const entriesFromTarget = Object.entries(importedSymbols).filter(([importPath]) =>
      targetPaths.some(tp =>
        importMatchesTarget(importPath, chunk.metadata.file, tp, normalizePathCached),
      ),
    );
    if (entriesFromTarget.length === 0) return false;

    const namedMatch = entriesFromTarget.some(
      ([, symbols]) => symbols.includes(targetSymbol) || symbols.some(s => s.startsWith('* as ')),
    );
    if (namedMatch) return true;

    return (chunk.metadata.callSites ?? []).some(cs => cs.symbol === targetSymbol);
  });
}

/**
 * Index one (importPath, chunk) pair, unless it's a bare whole-module import
 * (#884): for a `wholeModuleImports` language (Swift), a bare import can only
 * ever match a target through basename coincidence, not a real per-file
 * dependency — see `isUnresolvableWholeModuleImport`'s doc comment. Indexing
 * it anyway would let it win both the direct-lookup and fuzzy-match branches
 * of `findDependentChunks` purely by coincidence.
 *
 * Stores the raw `importPath` alongside the chunk (#994 Phase 3) so
 * `findDependentChunks`'s fuzzy loop can call `importMatchesTarget` directly
 * instead of reconstructing the #887/#929 guards from a bare chunk list.
 */
function indexImportEntry<T extends CodeChunk>(
  importPath: string,
  chunk: T,
  normalizePathCached: (path: string) => string,
  importIndex: Map<string, ImportIndexEntry<T>[]>,
): void {
  if (isUnresolvableWholeModuleImport(importPath, chunk.metadata.file)) return;
  const normalizedImport = normalizePathCached(importPath);
  if (!importIndex.has(normalizedImport)) {
    importIndex.set(normalizedImport, []);
  }
  importIndex.get(normalizedImport)!.push({ chunk, rawSpecifier: importPath });
}

/**
 * Add a chunk to the import index.
 */
function addChunkToImportIndex<T extends CodeChunk>(
  chunk: T,
  normalizePathCached: (path: string) => string,
  importIndex: Map<string, ImportIndexEntry<T>[]>,
): void {
  const imports = chunk.metadata.imports || [];
  for (const imp of imports) {
    indexImportEntry(imp, chunk, normalizePathCached, importIndex);
  }

  const importedSymbols = chunk.metadata.importedSymbols;
  if (importedSymbols && typeof importedSymbols === 'object') {
    for (const modulePath of Object.keys(importedSymbols)) {
      indexImportEntry(modulePath, chunk, normalizePathCached, importIndex);
    }
  }
}

/**
 * Add a chunk to the file grouping map.
 */
function addChunkToFileMap<T extends CodeChunk>(
  chunk: T,
  normalizePathCached: (path: string) => string,
  fileMap: Map<string, T[]>,
  seenRanges: Map<string, Set<string>>,
): void {
  const canonical = normalizePathCached(chunk.metadata.file);
  if (!fileMap.has(canonical)) {
    fileMap.set(canonical, []);
    seenRanges.set(canonical, new Set());
  }
  // Skip duplicate chunks (same line range) from abs/relative path variants
  const rangeKey = `${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
  const seen = seenRanges.get(canonical)!;
  if (seen.has(rangeKey)) return;
  seen.add(rangeKey);
  fileMap.get(canonical)!.push(chunk);
}

/**
 * Build the import index + per-file chunk groupings from an already-fetched
 * chunk set for a single `findDependents` call.
 *
 * Takes `Iterable<T>` rather than `T[]`: the CLI's only caller today always
 * passes an array (`vectorDB.scanAll()`'s result), but `VectorDBInterface`
 * also has an implemented-but-unused `scanPaginated` streaming path -- typing
 * this as `Iterable<T>` means a future caller could feed pages from that
 * path straight through (`for...of` works identically over an array or a
 * generator) without another signature change here.
 */
function buildScanIndex<T extends CodeChunk>(
  chunks: Iterable<T>,
  normalizePathCached: (path: string) => string,
): {
  importIndex: Map<string, ImportIndexEntry<T>[]>;
  allChunksByFile: Map<string, T[]>;
} {
  const importIndex = new Map<string, ImportIndexEntry<T>[]>();
  const allChunksByFile = new Map<string, T[]>();
  const seenRanges = new Map<string, Set<string>>();

  for (const chunk of chunks) {
    addChunkToImportIndex(chunk, normalizePathCached, importIndex);
    addChunkToFileMap(chunk, normalizePathCached, allChunksByFile, seenRanges);
  }

  return { importIndex, allChunksByFile };
}

/**
 * Build the dependents list, either file-level or symbol-level.
 *
 * When `symbol` doesn't resolve to any usage AND it isn't one of the target
 * file's own top-level exports, that combination is the structural
 * signature of a method or constructor query (#928-adjacent) -- no
 * language's import statement names a class member independently of its
 * class, so neither the named-import check nor its call-site fallback in
 * `fileImportsSymbolFromAny` had anything to key off. Asserting the
 * symbol-scoped zero in that case would read as "no callers, safe to
 * change" on a file that may have real file-level dependents, so this
 * degrades to the file-level answer instead (`symbolAttributionDegraded`
 * tells the caller the count is a widened floor, not a verified
 * per-symbol count) -- getting the failure mode right beats asserting a
 * precise count we can't actually back up.
 *
 * A second, DIFFERENT honesty gap (#1015) applies when `symbol` DOES resolve
 * as a real top-level export but is a TYPE declaration (class/struct/
 * interface/enum) rather than a function or method: nothing "calls" a type
 * by its own name the way a function call does, so `findSymbolUsages`'s
 * call-site-driven `totalUsageCount` structurally can't see constructor
 * calls, type hints, `extends`/`implements` clauses, generic type arguments,
 * or DI-injected property access -- regardless of whether that count comes
 * back `0` or some small positive number, it is a floor, not a verified
 * total. See `isTypeDeclarationSymbol` and `typeSymbolAttributionIncomplete`'s
 * doc comment on `FindDependentsResult`.
 */
function buildDependentsList<T extends CodeChunk>(
  chunksByFile: Map<string, T[]>,
  symbol: string | undefined,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  targetFileChunks: T[],
  filepath: string,
  log: (message: string, level?: 'warning') => void,
  reExporterPaths: string[] = [],
): {
  dependents: DependentInfo[];
  totalUsageCount?: number;
  symbolAttributionDegraded?: boolean;
  symbolFoundInFile?: boolean;
  typeSymbolAttributionIncomplete?: boolean;
} {
  if (symbol) {
    const exportsSymbol = validateSymbolExport(targetFileChunks, symbol, filepath, log);

    // Symbol-level analysis — check imports from target AND re-exporter paths
    const symbolResult = findSymbolUsages(
      chunksByFile,
      symbol,
      normalizedTarget,
      normalizePathCached,
      reExporterPaths,
    );

    if (!exportsSymbol && symbolResult.dependents.length === 0 && chunksByFile.size > 0) {
      const foundInFile = symbolFoundInFileChunks(targetFileChunks, symbol);
      log(
        foundInFile
          ? `Note: "${symbol}" isn't a top-level export of ${filepath} (likely a method or ` +
              `constructor) — symbol-level usage could not be confirmed. Falling back to ` +
              `file-level dependents.`
          : `Note: "${symbol}" doesn't appear anywhere in ${filepath}'s indexed chunks — ` +
              `possibly a typo or a removed symbol. Falling back to file-level dependents.`,
        'warning',
      );
      return {
        ...buildFileLevelDependents(chunksByFile),
        symbolAttributionDegraded: true,
        symbolFoundInFile: foundInFile,
      };
    }

    if (isTypeDeclarationSymbol(targetFileChunks, symbol)) {
      log(
        `Note: "${symbol}" is a class/struct/interface/enum declaration in ${filepath} — ` +
          `usage attribution for types is call-site-driven and structurally can't see ` +
          `constructor calls, type hints, extends/implements clauses, generic type ` +
          `arguments, or DI-injected property access, so totalUsageCount here is a ` +
          `partial, best-effort floor, not a verified total (#1015).`,
      );
      return { ...symbolResult, typeSymbolAttributionIncomplete: true };
    }

    return symbolResult;
  }

  return buildFileLevelDependents(chunksByFile);
}

/** File-level dependents: every file in `chunksByFile`, regardless of symbol. */
function buildFileLevelDependents<T extends CodeChunk>(
  chunksByFile: Map<string, T[]>,
): {
  dependents: DependentInfo[];
  totalUsageCount?: number;
} {
  const dependents = Array.from(chunksByFile.keys()).map(fp => ({
    filepath: fp,
    isTestFile: isTestFile(fp),
  }));

  return { dependents, totalUsageCount: undefined };
}

/**
 * Validate that the target file exports the requested symbol.
 *
 * Design decision: This function only logs a warning and does NOT throw an error
 * or stop execution on a miss. This is intentional because:
 *
 * 1. The export might be dynamic or conditional (not captured by static analysis)
 * 2. False positives are better than false negatives (we want to show potential matches)
 * 3. The user can see the warning and interpret results accordingly
 *
 * The caller continues to search for usages even when this returns false, which may
 * reveal re-exports, dynamic exports, or help diagnose indexing issues. The boolean
 * return additionally lets `buildDependentsList` distinguish "genuinely zero callers"
 * from "not a top-level export at all" (methods/constructors) — see its doc comment.
 */
function validateSymbolExport<T extends CodeChunk>(
  targetFileChunks: T[],
  symbol: string,
  filepath: string,
  log: (message: string, level?: 'warning') => void,
): boolean {
  const exportsSymbol = targetFileChunks.some(chunk => chunk.metadata.exports?.includes(symbol));

  if (!exportsSymbol) {
    log(`Warning: Symbol "${symbol}" not found in exports of ${filepath}`, 'warning');
  }

  return exportsSymbol;
}

/**
 * Whether `symbol` shows up anywhere among the target file's OWN chunks --
 * as a chunk's `symbolName` (methods, constructors, and nested
 * functions/classes each get their own chunk with `symbolName` set to their
 * own name, not just the file-level `exports` list) or inside that chunk's
 * `symbols` bag. `validateSymbolExport` above only answers "is this a
 * top-level export"; this answers the different, narrower question "does
 * this name appear in the file AT ALL" -- used to word
 * `symbolAttributionDegraded`'s caveat honestly instead of always guessing
 * "method or constructor". A hit here means that guess is backed by
 * evidence; no hit means `symbol` may just as easily be a typo, a
 * hallucinated name, or a symbol that used to exist and was removed, and the
 * caveat should say so instead of picking one cause with false confidence.
 */
function symbolFoundInFileChunks<T extends CodeChunk>(
  targetFileChunks: T[],
  symbol: string,
): boolean {
  return targetFileChunks.some(chunk => {
    const { symbolName, symbols } = chunk.metadata;
    if (symbolName === symbol) return true;
    if (!symbols) return false;
    return (
      symbols.functions.includes(symbol) ||
      symbols.classes.includes(symbol) ||
      symbols.interfaces.includes(symbol)
    );
  });
}

function escapeForTypeDeclarationRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Type-declaration keywords whose header line names the type BEFORE the
 * symbol -- the dominant shape across every supported language except Go
 * (`class Foo`, `pub struct Foo`, `public interface Foo`, `data class Foo`,
 * `protocol Foo`). Deliberately excludes TypeScript's `type X = ...` alias:
 * no language's `symbolType` has a distinct kind for it either (`ast/types.ts`'s
 * `SymbolInfo.type` caps out at `'function'|'method'|'class'|'interface'`),
 * and bare `type` is too common a token elsewhere (variable/parameter names,
 * generic bounds) to scan for safely.
 */
const TYPE_DECLARATION_KEYWORD_RE = /\b(?:class|struct|interface|enum|trait|protocol|module)\b/;

/** A comment-only line (the common false-positive source: a doc comment prose-mentioning both a keyword and the symbol name). */
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*|#)/;

/** Go's `type Foo struct` / `type Foo interface` -- the one dominant shape where the keyword follows the name instead of preceding it. */
function isGoTypeDeclarationLine(line: string, symbolNameRe: RegExp): boolean {
  return /\btype\s+/.test(line) && symbolNameRe.test(line) && /\b(?:struct|interface)\b/.test(line);
}

/**
 * The "header" portion of a raw source line usable as declaration evidence,
 * or `undefined` when the line is disqualified entirely -- a comment (the
 * common false-positive source: a doc comment prose-mentioning both a
 * keyword and the symbol name) or containing a quote character (a string
 * literal/log message that happens to mention both words, e.g.
 * `log.debug("struct Error created")`). Truncated at the first `{`/`;` so a
 * multi-statement line's LATER, unrelated statement can't smuggle in a
 * keyword or name match.
 */
function declarationHeader(rawLine: string): string | undefined {
  if (COMMENT_LINE_RE.test(rawLine) || rawLine.includes('"') || rawLine.includes("'")) {
    return undefined;
  }
  return rawLine.split('{')[0].split(';')[0];
}

/** True iff `header` itself declares a type named per `nameRe` -- keyword-then-name, or Go's name-then-keyword. */
function headerDeclaresType(header: string, nameRe: RegExp): boolean {
  if (!nameRe.test(header)) return false;
  const nameIndex = header.search(nameRe);
  const keywordMatch = TYPE_DECLARATION_KEYWORD_RE.exec(header);
  if (keywordMatch && keywordMatch.index < nameIndex) return true;
  return isGoTypeDeclarationLine(header, nameRe);
}

/**
 * Text-based fallback for `isTypeDeclarationSymbol` (#1015): true iff some
 * line of `targetFileChunks`' own raw content declares `symbol` as a
 * class/struct/interface/enum/trait/protocol/module, keyword-then-name (or
 * Go's name-then-keyword), BEFORE the first `{`/`;` on that line (the
 * "header" portion, see `declarationHeader`) and with no quote character on
 * the line (kills the dominant false-positive source: a string literal or
 * log message that happens to mention both words, e.g.
 * `log.debug("struct Error created")`).
 *
 * Needed because a plain data-only type with no inline methods (e.g. Rust's
 * `pub struct Error { inner: ErrorImpl }` in a real anyhow/anyhow clone)
 * never gets its own chunk with a matching `symbolName`/`symbolType` --
 * the chunker only creates a dedicated chunk for a symbol with its own
 * extractable body (see `chunker.ts`), so a bare struct with no methods
 * falls into a surrounding "uncovered"/block chunk that carries no
 * per-symbol metadata at all, even though the file's own `exports` list
 * (duplicated onto every chunk) still names it -- confirmed empirically
 * against a real `dtolnay/anyhow` clone: `Error` (declared in `src/lib.rs`)
 * has zero chunks with `symbolName === 'Error'` at all.
 *
 * Scoped to the DECLARING FILE'S OWN text, never a corpus-wide scan --
 * unlike C#'s `findCSharpTypeReferenceDependents` (a real cross-file
 * resolution mechanism, explicitly out of scope for #1015's honesty-only
 * fix), this only asks "does this file's own source declare a type by this
 * name", which needs none of that mechanism's cross-file fabrication-risk
 * guards. Callers must already have confirmed `symbol` is a genuine
 * top-level export (`validateSymbolExport`) before consulting this --
 * scanning raw text for an unconfirmed name would risk matching an
 * unrelated local variable/parameter that merely shares a same-line keyword
 * by coincidence.
 */
function isTypeDeclarationLine<T extends CodeChunk>(
  targetFileChunks: T[],
  symbol: string,
): boolean {
  const nameRe = new RegExp(`\\b${escapeForTypeDeclarationRegex(symbol)}\\b`);
  return targetFileChunks.some(chunk =>
    chunk.content.split('\n').some(rawLine => {
      const header = declarationHeader(rawLine);
      return header !== undefined && headerDeclaresType(header, nameRe);
    }),
  );
}

/**
 * True iff `symbol` is a class/struct/interface/enum/record declaration in
 * `targetFileChunks`. Two tiers, cheapest first:
 * 1. Some chunk's own `symbolName` equals `symbol` and that chunk's
 *    `symbolType` is `'class'` or `'interface'` -- every language extractor
 *    collapses struct/enum/record declarations into these same two
 *    `SymbolInfo.type` values (see `ast/types.ts`'s doc comment on
 *    `SymbolInfo`, and `csharp-type-reference-signals.ts`'s
 *    `isCandidateCSharpTypeDeclarationChunk` for the same fact verified
 *    empirically against C#) -- so this check is language-agnostic across
 *    every AST-supported language, not just C#, and needs no text scanning.
 * 2. `isTypeDeclarationLine`: a text-based fallback for when tier 1 misses
 *    because the type never got its own chunk at all (a plain data-only
 *    struct with no inline methods -- see that function's doc comment).
 *
 * Used by `buildDependentsList` to recognize the #1015 shape:
 * `typeSymbolAttributionIncomplete`'s doc comment on `FindDependentsResult`
 * explains why a type-shaped symbol query needs its own honesty caveat
 * distinct from `symbolAttributionDegraded`.
 */
function isTypeDeclarationSymbol<T extends CodeChunk>(
  targetFileChunks: T[],
  symbol: string,
): boolean {
  const hasDeclarationChunk = targetFileChunks.some(
    chunk =>
      chunk.metadata.symbolName === symbol &&
      (chunk.metadata.symbolType === 'class' || chunk.metadata.symbolType === 'interface'),
  );
  return hasDeclarationChunk || isTypeDeclarationLine(targetFileChunks, symbol);
}

/**
 * Merge source chunks into the target map, grouping by file path.
 */
function mergeChunksByFile<T extends CodeChunk>(
  target: Map<string, T[]>,
  source: Map<string, T[]>,
): void {
  for (const [fp, chunks] of source.entries()) {
    const existing = target.get(fp);
    if (existing) {
      existing.push(...chunks);
    } else {
      target.set(fp, chunks);
    }
  }
}

/**
 * Shared context for a single `findDependents` call. These values always
 * travel together, so grouping them removes parameter noise from helpers.
 *
 * `recoveryIndexes` (#1101) is always populated by `findDependents` itself --
 * either the caller-supplied batch-scoped bag, or a fresh `{}` scoped to just
 * this one call -- so every one of the three `enrichWith*Dependents` helpers
 * below can unconditionally read/write through it (`ctx.recoveryIndexes.jvm
 * ??= buildJvmSamePackageIndex(...)`) with no extra undefined-check.
 */
interface ScanContext<T extends CodeChunk> {
  importIndex: Map<string, ImportIndexEntry<T>[]>;
  allChunksByFile: Map<string, T[]>;
  normalizePathCached: (p: string) => string;
  log: (message: string, level?: 'warning') => void;
  workspaceRoot: string;
  recoveryIndexes: RecoveryIndexes;
}

/**
 * Find and merge transitive dependents from re-export chains (barrel files).
 */
function resolveTransitiveDependents<T extends CodeChunk>(
  ctx: ScanContext<T>,
  normalizedTarget: string,
  chunksByFile: Map<string, T[]>,
): string[] {
  const reExporterPaths = buildReExportGraph(
    ctx.allChunksByFile,
    normalizedTarget,
    ctx.normalizePathCached,
  );
  if (reExporterPaths.length > 0) {
    mergeTransitiveDependents(ctx, normalizedTarget, chunksByFile, reExporterPaths);
  }
  return reExporterPaths;
}

/**
 * Find and merge transitive dependents through re-export chains into chunksByFile.
 */
function mergeTransitiveDependents<T extends CodeChunk>(
  ctx: ScanContext<T>,
  normalizedTarget: string,
  chunksByFile: Map<string, T[]>,
  reExporterPaths: string[],
): void {
  const { importIndex, allChunksByFile, normalizePathCached, log, workspaceRoot } = ctx;
  const existingFiles = new Set(chunksByFile.keys());
  const transitiveChunks = findTransitiveDependents(
    reExporterPaths,
    importIndex,
    normalizedTarget,
    normalizePathCached,
    allChunksByFile,
    existingFiles,
  );
  if (transitiveChunks.length > 0) {
    // Cast is safe: runtime values are T objects from the caller's own chunk set.
    const transitiveByFile = groupChunksByFile(transitiveChunks as T[], workspaceRoot);
    mergeChunksByFile(chunksByFile, transitiveByFile);
    log(`Found ${transitiveByFile.size} additional dependents via re-export chains`);
  }
}

/**
 * Resolve the final dependents list for one `findDependents` call: the
 * import-graph answer (`buildDependentsList`), the C# type-reference
 * recovery attempt (`enrichWithCSharpTypeReferenceDependents`, #930 part 2),
 * and hop stamping/sorting -- grouped here so `findDependents` itself stays
 * a thin orchestration shell rather than inlining all three steps.
 */
function resolveDependents<T extends CodeChunk>(args: {
  ctx: ScanContext<T>;
  chunksByFile: Map<string, T[]>;
  hopsByFile: Map<string, number>;
  symbol: string | undefined;
  normalizedTarget: string;
  targetFileChunks: T[];
  filepath: string;
  reExporterPaths: string[];
  targetIndexed: boolean;
}): {
  dependents: DependentInfo[];
  totalUsageCount?: number;
  symbolAttributionDegraded?: boolean;
  symbolFoundInFile?: boolean;
  typeSymbolAttributionIncomplete?: boolean;
  dependentAttributionPartial?: true;
} {
  const {
    ctx,
    chunksByFile,
    hopsByFile,
    symbol,
    normalizedTarget,
    targetFileChunks,
    filepath,
    reExporterPaths,
    targetIndexed,
  } = args;

  const {
    dependents,
    totalUsageCount,
    symbolAttributionDegraded,
    symbolFoundInFile,
    typeSymbolAttributionIncomplete,
  } = buildDependentsList(
    chunksByFile,
    symbol,
    normalizedTarget,
    ctx.normalizePathCached,
    targetFileChunks,
    filepath,
    ctx.log,
    reExporterPaths,
  );
  const dependentAttributionPartial =
    enrichWithCSharpTypeReferenceDependents(
      ctx,
      filepath,
      normalizedTarget,
      symbol,
      targetIndexed,
      dependents,
    ) ??
    enrichWithGoRootPackageDependents(
      ctx,
      filepath,
      normalizedTarget,
      symbol,
      targetIndexed,
      dependents,
    ) ??
    enrichWithJvmSamePackageDependents(
      ctx,
      filepath,
      normalizedTarget,
      symbol,
      targetIndexed,
      dependents,
    );
  stampHopsAndSort(dependents, hopsByFile);

  return {
    dependents,
    totalUsageCount,
    symbolAttributionDegraded,
    symbolFoundInFile,
    typeSymbolAttributionIncomplete,
    dependentAttributionPartial,
  };
}

/**
 * Find all files that depend on a target file, including transitive dependents
 * through re-export chains. Optionally tracks usages of a specific symbol.
 *
 * When `depth > 1`, the walk continues outward (BFS) over the import graph
 * using the same in-memory `importIndex`. Each newly discovered file is
 * tagged with the depth (hops) at which it was first reached. BFS stops when
 * `depth` is reached or `chunksByFile.size >= maxNodes` (sets `truncated`).
 *
 * Symbol-level queries (`symbol` set) always behave as depth=1 — transitive
 * symbol tracking through re-renaming chains is out of scope for this tool.
 *
 * Chunk-in/chunk-out and synchronous -- no dependency on a vectorDB. The
 * CLI's `get_dependents` MCP tool handler is a thin async wrapper around
 * this (see `packages/cli/src/mcp/handlers/dependency-analyzer.ts`): it
 * fetches (and caches) chunks via `vectorDB.scanAll()`, then calls this
 * function. `workspaceRoot` is a required, explicit parameter rather than
 * read from `process.cwd()` internally -- same reasoning as
 * `analyzeDependencies` above: keeps this function pure and independently
 * testable, with no hidden environment read.
 *
 * `recoveryIndexes` (#1101) is an optional, caller-threaded bag for the three
 * non-import recovery tiers' project-wide indexes (C# type-reference, Go
 * root-package, JVM same-package -- see the `enrichWith*Dependents`
 * functions below). Omit it (the default) for a one-off call -- this
 * function builds and discards a fresh, empty bag internally, identical to
 * today's behavior for every existing caller. A caller that invokes this
 * function in a loop over many FILE-LEVEL targets (no `symbol`) within ONE
 * outer batch should construct ONE `{}` bag before the loop and pass the
 * SAME object into every call -- each of the three tiers is then built at
 * most once per batch and reused for the rest of it, mirroring
 * `dependent-count-index.ts`'s own `RecoveryIndexes` batching discipline.
 * Note the "FILE-LEVEL" qualifier is load-bearing: all three
 * `enrichWith*Dependents` functions unconditionally no-op whenever `symbol`
 * is set (see their shared `if (symbol || ...)` guard), so a caller that
 * always queries with a `symbol` (`lien api-delta`'s `enrichDeltas`, which
 * always passes `change.symbolName`) never reaches this tier at all,
 * batched or not -- threading the bag through such a caller is still
 * correct and harmless, just not currently observable as a speedup there
 * (measured; see #1101's PR for the real before/after). Never a
 * module-level cache keyed by workspace root: see `jvm-source-root.ts`'s own
 * doc comment for why that goes stale under a long-running `lien serve` --
 * this bag must stay scoped to one batch/call.
 */
export function findDependents<T extends CodeChunk>(
  chunks: Iterable<T>,
  filepath: string,
  log: (message: string, level?: 'warning') => void,
  workspaceRoot: string,
  symbol?: string,
  depth: number = 1,
  maxNodes: number = 500,
  /**
   * Surface the full normalized chunk set on the result.
   * Callers opt in by passing `true` only if they need the chunks
   * (e.g., the CLI annotator for test-association + complexity lookups).
   * Default `false` keeps memory cost down for the common MCP path.
   */
  includeAllChunks: boolean = false,
  recoveryIndexes?: RecoveryIndexes,
): FindDependentsResult<T> {
  const normalizePathCached = createPathNormalizer(workspaceRoot);
  const normalizedTarget = normalizePathCached(filepath);

  const { importIndex, allChunksByFile } = buildScanIndex(chunks, normalizePathCached);
  const ctx: ScanContext<T> = {
    importIndex,
    allChunksByFile,
    normalizePathCached,
    log,
    workspaceRoot,
    recoveryIndexes: recoveryIndexes ?? {},
  };

  const { targetIndexed, chunksByFile, reExporterPaths } = seedIfTargetIndexed(
    ctx,
    normalizedTarget,
    filepath,
  );

  // Stamp depth-1 files, then BFS outward if requested.
  const hopsByFile = new Map<string, number>();
  for (const file of chunksByFile.keys()) hopsByFile.set(file, 1);
  const { truncated } = runBfsIfRequested({
    ctx,
    chunksByFile,
    hopsByFile,
    normalizedTarget,
    symbol,
    depth,
    maxNodes,
  });

  const targetFileChunks = symbol ? (allChunksByFile.get(normalizedTarget) ?? []) : [];
  const {
    dependents,
    totalUsageCount,
    symbolAttributionDegraded,
    symbolFoundInFile,
    typeSymbolAttributionIncomplete,
    dependentAttributionPartial,
  } = resolveDependents({
    ctx,
    chunksByFile,
    hopsByFile,
    symbol,
    normalizedTarget,
    targetFileChunks,
    filepath,
    reExporterPaths,
    targetIndexed,
  });

  // Complexity metrics must be joined against the *resolved* dependents, not
  // the broader import-graph candidate set (`chunksByFile`) considered before
  // symbol filtering. For file-level queries the two are identical, but for
  // symbol queries `chunksByFile` can contain files that import the target
  // file yet don't use the requested symbol — `buildDependentsList` drops
  // those. Reading complexity from `chunksByFile` directly let an unrelated
  // file's complexity leak into `complexityMetrics`/`riskReasoning` even when
  // `dependents` came back empty.
  const dependentChunksByFile = restrictToDependents(chunksByFile, dependents);
  const fileComplexities = calculateFileComplexities(dependentChunksByFile);
  const complexityMetrics = calculateComplexityMetricsOrDefault(fileComplexities);

  const testDependentCount = dependents.filter(f => f.isTestFile).length;
  const productionDependentCount = dependents.length - testDependentCount;
  const uncoveredProductionDependents = countUncoveredProductionDependents(dependents, ctx);

  // Surface the full normalized chunk set only when the caller asks for it via
  // the `includeAllChunks` flag. Leaving it `[]` for the common case avoids
  // allocating a flat array of every indexed chunk on each MCP get_dependents
  // call.
  const allChunks = includeAllChunks ? Array.from(allChunksByFile.values()).flat() : [];

  const dependentAttributionIncomplete = checkDependentAttributionIncomplete(
    filepath,
    symbol,
    dependents.length,
    targetIndexed,
    log,
    Boolean(typeSymbolAttributionIncomplete),
  );

  return {
    dependents,
    productionDependentCount,
    testDependentCount,
    chunksByFile,
    fileComplexities,
    complexityMetrics,
    hitLimit: false,
    allChunks,
    totalUsageCount,
    truncated,
    uncoveredProductionDependents,
    symbolAttributionDegraded,
    symbolFoundInFile,
    typeSymbolAttributionIncomplete,
    dependentAttributionIncomplete,
    dependentAttributionPartial,
    targetIndexed,
  };
}

/**
 * #930 (part 2): recover REAL production dependents for a C# file when the
 * import graph found none, by scanning for identifier-boundary references
 * to the target's uniquely-declared type name(s) across the corpus -- see
 * `findCSharpTypeReferenceDependents`'s module doc for the full mechanism
 * and why a type-declaration match (unlike a bare method-name match, #869)
 * doesn't need Swift's extra type-shaped-driver gate.
 *
 * Deliberately narrower than the import-graph seed it supplements:
 * - File-level only (`symbol` unset) -- there's no principled way to scope
 *   a text match to one exported member.
 * - Only attempted when the import graph found LITERALLY ZERO dependents --
 *   avoids a corpus-wide content scan on every C# `get_dependents` call,
 *   mirroring `checkDependentAttributionIncomplete`'s existing threshold.
 *   A future PR could widen this to also run when the import graph found
 *   *some* dependents (a mixed old/new-style C# project), but that's out of
 *   scope here.
 * - Only for `hasEnclosingNamespaceAccess` languages (currently C# only).
 *
 * Recovered entries are tagged `confidence: 'inferred'` (see
 * `DependentInfo`) and deliberately NOT joined against `chunksByFile` for
 * complexity-metrics purposes -- unlike a real import edge, there's no
 * associated import-graph chunk set to attribute complexity to, so these
 * dependents contribute to `dependentCount`/`productionDependentCount`/
 * `riskLevel` but not to `complexityMetrics`. `uncoveredProductionDependents`
 * still runs its own genuine import-based "is there a test importer of
 * THIS dependent" check against each recovered file, so that count stays
 * meaningful.
 *
 * Mutates `dependents` in place (pushes new entries); returns `true` when
 * anything was recovered (for `dependentAttributionPartial`) or `undefined`
 * otherwise -- matching this file's existing convention for optional
 * boolean flags (e.g. `symbolAttributionDegraded`,
 * `dependentAttributionIncomplete`), which are only ever `true` or absent,
 * never an explicit `false`.
 */
function enrichWithCSharpTypeReferenceDependents<T extends CodeChunk>(
  ctx: ScanContext<T>,
  filepath: string,
  normalizedTarget: string,
  symbol: string | undefined,
  targetIndexed: boolean,
  dependents: DependentInfo[],
): true | undefined {
  if (symbol || dependents.length !== 0 || !targetIndexed) return undefined;

  const targetLanguage = detectLanguage(filepath);
  if (targetLanguage === null || !hasEnclosingNamespaceAccess(targetLanguage)) return undefined;

  const targetChunks = ctx.allChunksByFile.get(normalizedTarget) ?? [];
  const targetRawFile = targetChunks[0]?.metadata.file;
  if (!targetRawFile) return undefined;

  // Build once per batch (#1101): a caller looping `findDependents` over many
  // targets in one outer batch (`lien api-delta`'s `enrichDeltas`) threads
  // the same `ctx.recoveryIndexes` bag through every call, so this only pays
  // the project-wide index build for the FIRST zero-dependent C# target it
  // reaches -- every subsequent one in the same batch reuses it. A one-off
  // caller (the common `get_dependents` MCP path) gets a fresh, empty bag
  // from `findDependents` itself, so this still builds exactly once per call,
  // identical to before.
  const allChunks = Array.from(ctx.allChunksByFile.values()).flat();
  ctx.recoveryIndexes.csharp ??= buildCSharpTypeReferenceIndex(allChunks);
  const inferredFiles = resolveCSharpTypeReferenceDependents(
    targetRawFile,
    ctx.recoveryIndexes.csharp,
  );
  if (inferredFiles.length === 0) return undefined;

  for (const rawFile of inferredFiles) {
    dependents.push(
      inferredDependent(getCanonicalPath(rawFile, ctx.workspaceRoot), 'csharp-type-reference'),
    );
  }

  ctx.log(
    `Recovered ${inferredFiles.length} dependent(s) for ${filepath} via C# type-reference ` +
      `matching (inferred from a uniquely-declared type name, not import-verified — #930)`,
  );
  return true;
}

/**
 * #1039: recover REAL dependents for a Go module's ROOT-package file when the
 * import graph found none, because a Go file outside the root package that
 * genuinely uses it can only ever spell that reference as a bare self-import
 * of the module's own full path (`import "github.com/go-chi/chi/v5"`) --
 * `resolveGoModuleImport` (`go-module.ts`) deliberately leaves that case
 * unresolved (#867's own scope), so nothing in the import graph ever names a
 * specific root-package file. See `go-root-package-signals.ts`'s module doc
 * for the full mechanism (export lookup keyed off a bare-self-importing
 * file's own call sites, never "credit the whole root directory" -- the
 * #1008/#1056 false-hub shape this is deliberately built to avoid).
 *
 * Mirrors `enrichWithCSharpTypeReferenceDependents` immediately above in
 * every structural respect: file-level only (no `symbol`), only attempted
 * when the import graph found LITERALLY ZERO dependents, only for a
 * root-level Go file (checked explicitly below via `isRootLevelGoFile`,
 * mirroring `findGoRootPackageDependents`'s own guard -- kept here too so a
 * non-root-level Go query never triggers `buildGoRootPackageIndex`'s
 * corpus-wide scan, #1101), and recovered entries are tagged
 * `confidence: 'inferred'` -- not joined against `chunksByFile` for
 * complexity-metrics purposes, same reasoning as the C# recovery.
 */
function enrichWithGoRootPackageDependents<T extends CodeChunk>(
  ctx: ScanContext<T>,
  filepath: string,
  normalizedTarget: string,
  symbol: string | undefined,
  targetIndexed: boolean,
  dependents: DependentInfo[],
): true | undefined {
  if (symbol || dependents.length !== 0 || !targetIndexed) return undefined;
  if (detectLanguage(filepath) !== 'go') return undefined;

  const targetChunks = ctx.allChunksByFile.get(normalizedTarget) ?? [];
  const targetRawFile = targetChunks[0]?.metadata.file;
  if (!targetRawFile || !isRootLevelGoFile(targetRawFile)) return undefined;

  // Build once per batch (#1101) -- see the C# recovery's identical comment
  // immediately above for the full reasoning.
  const allChunks = Array.from(ctx.allChunksByFile.values()).flat();
  ctx.recoveryIndexes.go ??= buildGoRootPackageIndex(allChunks, ctx.workspaceRoot);
  const inferredFiles = resolveGoRootPackageDependents(targetRawFile, ctx.recoveryIndexes.go);
  if (inferredFiles.length === 0) return undefined;

  for (const rawFile of inferredFiles) {
    dependents.push(
      inferredDependent(getCanonicalPath(rawFile, ctx.workspaceRoot), 'go-root-package-export'),
    );
  }

  ctx.log(
    `Recovered ${inferredFiles.length} dependent(s) for ${filepath} via Go root-package export ` +
      `lookup (inferred from a bare module-root self-import + a matching call site, not a ` +
      `direct import edge — #1039)`,
  );
  return true;
}

/**
 * #1005 (Mechanism 3, Phase 1): recover REAL dependents for a Java/Kotlin
 * file when the import graph found none, because same-package visibility
 * lets a real caller reach it with no per-file import at all -- see
 * `jvm-same-package-signals.ts`'s module doc for the full six-gate mechanism.
 *
 * Mirrors `enrichWithCSharpTypeReferenceDependents`/
 * `enrichWithGoRootPackageDependents` in every structural respect: file-level
 * only (no `symbol`), only attempted when the import graph found LITERALLY
 * ZERO dependents, gated on a literal `detectLanguage` check (not a
 * capability flag -- see the module doc's own note on why this follows the
 * Go RESOLVER precedent, not the caveat-flag one), and recovered entries are
 * tagged `confidence: 'inferred'` -- not joined against `chunksByFile` for
 * complexity-metrics purposes, same reasoning as the other two.
 */
function enrichWithJvmSamePackageDependents<T extends CodeChunk>(
  ctx: ScanContext<T>,
  filepath: string,
  normalizedTarget: string,
  symbol: string | undefined,
  targetIndexed: boolean,
  dependents: DependentInfo[],
): true | undefined {
  if (symbol || dependents.length !== 0 || !targetIndexed) return undefined;
  const targetLanguage = detectLanguage(filepath);
  if (targetLanguage !== 'java' && targetLanguage !== 'kotlin') return undefined;

  const targetChunks = ctx.allChunksByFile.get(normalizedTarget) ?? [];
  const targetRawFile = targetChunks[0]?.metadata.file;
  if (!targetRawFile) return undefined;

  // Build once per batch (#1101) -- see the C# recovery's identical comment
  // near the top of this file for the full reasoning. This is the tier the
  // issue's own measurement targeted: ~37-40ms per rebuild on OkHttp
  // (682 files / 9033 chunks).
  const allChunks = Array.from(ctx.allChunksByFile.values()).flat();
  ctx.recoveryIndexes.jvm ??= buildJvmSamePackageIndex(allChunks);
  const inferredFiles = resolveJvmSamePackageDependents(targetRawFile, ctx.recoveryIndexes.jvm);
  if (inferredFiles.length === 0) return undefined;

  for (const rawFile of inferredFiles) {
    dependents.push(
      inferredDependent(getCanonicalPath(rawFile, ctx.workspaceRoot), 'jvm-same-package'),
    );
  }

  ctx.log(
    `Recovered ${inferredFiles.length} dependent(s) for ${filepath} via JVM same-package ` +
      `matching (inferred from a package-locally-unique declared type name, not import-verified ` +
      `— #1005)`,
  );
  return true;
}

/**
 * Found zero dependents (file-level OR symbol-level) in a language where the
 * import graph structurally cannot see every real usage, EVEN AFTER
 * `enrichWithCSharpTypeReferenceDependents` above already had a chance to
 * recover some (see `FindDependentsResult.dependentAttributionIncomplete`'s
 * doc comment). Logs a warning when it fires, matching the logging
 * `buildDependentsList` already does for its own degradation case.
 *
 * Gated by `hasDependentAttributionBlindSpot` (#1005's Mechanism 2), not
 * `hasEnclosingNamespaceAccess` directly -- C# is one of four languages this
 * now covers (Java/Kotlin/Swift too), each for its own reason (same-package
 * or whole-module access, not C#'s specific namespace-nesting rule). See
 * that predicate's own doc comment in `ast/languages/registry.ts` for why
 * it's a composed, wider check rather than a reuse of
 * `hasEnclosingNamespaceAccess`'s narrower meaning.
 *
 * Skipped when `targetIndexed` is false (#928): an unresolved target's zero
 * dependents already carries its own, more fundamental "unresolved" signal
 * (see `seedIfTargetIndexed`) -- layering this reasoning on top would
 * produce two notes competing to explain the same zero, one of them
 * describing a language nuance that's moot when the file was never found
 * in the index at all.
 *
 * `symbolCaveatAlreadyExplained` (#1097): true when the SAME call already
 * set `typeSymbolAttributionIncomplete` for this symbol -- that caveat is
 * strictly more specific (it names the actual symbol and why call-site
 * tracking can't see through a type declaration), so this wider, language-
 * level determination steps aside rather than layering a second,
 * differently-worded explanation of the identical zero onto one response.
 * Before #1097 this function's guard was `symbol || ...`, which skipped the
 * whole determination for EVERY symbol-scoped query unconditionally --
 * exactly the shape of `get_dependents({filepath, symbol})` and every `lien
 * api-delta` check, so a real blind-spot zero on a plain (non-type) symbol
 * query -- e.g. a Java method with genuine same-package callers the import
 * graph can't see -- came back with no caveat at all, even though the
 * identical file's file-level query correctly carried this flag. No
 * equivalent guard is needed against `symbolAttributionDegraded`: that one
 * only ever fires with a nonzero final `dependents.length` (it widens to
 * the file-level dependents list, which requires at least one file to
 * begin with), so the `dependentCount !== 0` check below already excludes
 * it structurally.
 */
function checkDependentAttributionIncomplete(
  filepath: string,
  symbol: string | undefined,
  dependentCount: number,
  targetIndexed: boolean,
  log: (message: string, level?: 'warning') => void,
  symbolCaveatAlreadyExplained: boolean = false,
): true | undefined {
  if (dependentCount !== 0 || !targetIndexed || symbolCaveatAlreadyExplained) return undefined;

  const targetLanguage = detectLanguage(filepath);
  if (targetLanguage === null || !hasDependentAttributionBlindSpot(targetLanguage)) {
    return undefined;
  }

  const symbolSuffix = symbol ? ` (symbol: "${symbol}")` : '';
  log(
    `No import-based dependents found for ${filepath}${symbolSuffix} -- ${targetLanguage} has a ` +
      `known import-invisible same-unit access shape (e.g. C#'s enclosing-namespace access, ` +
      `Java/Kotlin's same-package access, or Swift's whole-module access), so this scan ` +
      `has no signal for a real caller that reaches it without a per-file import (#930, #1005, #1097)`,
    'warning',
  );
  return true;
}

/**
 * #928: only run the fuzzy dependent search against a target that's actually
 * indexed. `allChunksByFile` is keyed by the same `normalizePathCached` used
 * for `normalizedTarget`, so this check is free (no extra I/O) and precise
 * for "does the index have any chunks for this file at all". Skipping the
 * fuzzy search entirely for an unresolvable target — rather than letting it
 * run and possibly latch onto an unrelated real file's import graph through
 * textual coincidence — trades a possible false negative (a real but oddly-
 * shaped match we don't find) for a guaranteed non-fabrication: an
 * unresolvable target always comes back with zero dependents, never someone
 * else's.
 */
function seedIfTargetIndexed<T extends CodeChunk>(
  ctx: ScanContext<T>,
  normalizedTarget: string,
  filepath: string,
): {
  targetIndexed: boolean;
  chunksByFile: Map<string, T[]>;
  reExporterPaths: string[];
} {
  const targetIndexed = ctx.allChunksByFile.has(normalizedTarget);
  if (!targetIndexed) {
    ctx.log(
      `Target not found in index: ${filepath} — returning zero dependents rather than a fuzzy-matched guess`,
      'warning',
    );
    return { targetIndexed, chunksByFile: new Map(), reExporterPaths: [] };
  }
  const { chunksByFile, reExporterPaths } = seedDepth1Dependents(ctx, normalizedTarget);
  return { targetIndexed, chunksByFile, reExporterPaths };
}

/** Depth-1 seed: direct importers plus barrel re-exporters. */
function seedDepth1Dependents<T extends CodeChunk>(
  ctx: ScanContext<T>,
  normalizedTarget: string,
): { chunksByFile: Map<string, T[]>; reExporterPaths: string[] } {
  const dependentChunks = findDependentChunks(
    normalizedTarget,
    ctx.importIndex,
    ctx.normalizePathCached,
  );
  const chunksByFile = groupChunksByFile(dependentChunks, ctx.workspaceRoot);
  const reExporterPaths = resolveTransitiveDependents(ctx, normalizedTarget, chunksByFile);
  return { chunksByFile, reExporterPaths };
}

/**
 * Apply the symbol-vs-depth policy and run BFS if applicable. Symbol queries
 * stay at depth 1 — transitive symbol-renaming chains are out of scope.
 */
function runBfsIfRequested<T extends CodeChunk>(args: {
  ctx: ScanContext<T>;
  chunksByFile: Map<string, T[]>;
  hopsByFile: Map<string, number>;
  normalizedTarget: string;
  symbol: string | undefined;
  depth: number;
  maxNodes: number;
}): { truncated: boolean } {
  const { ctx, chunksByFile, hopsByFile, normalizedTarget, symbol, depth, maxNodes } = args;
  if (symbol && depth > 1) {
    ctx.log(`Note: depth > 1 is ignored for symbol-level queries (symbol=${symbol})`);
    return { truncated: false };
  }
  return expandBfsDependents(ctx, chunksByFile, hopsByFile, normalizedTarget, depth, maxNodes);
}

/** Fill in `hops` on each dependent and sort shallower-first, prod-before-test. */
function stampHopsAndSort(dependents: DependentInfo[], hopsByFile: Map<string, number>): void {
  for (const d of dependents) {
    d.hops = hopsByFile.get(d.filepath) ?? 1;
  }
  dependents.sort((a, b) => {
    const hopDelta = (a.hops ?? 1) - (b.hops ?? 1);
    if (hopDelta !== 0) return hopDelta;
    if (a.isTestFile === b.isTestFile) return 0;
    return a.isTestFile ? 1 : -1;
  });
}

/**
 * BFS outward from depth-1 frontier. Mutates `chunksByFile` and `hopsByFile`
 * with newly discovered files. `truncated` means the walk was cut short by
 * `maxNodes`; it stays false when no BFS runs.
 */
function expandBfsDependents<T extends CodeChunk>(
  ctx: ScanContext<T>,
  chunksByFile: Map<string, T[]>,
  hopsByFile: Map<string, number>,
  normalizedTarget: string,
  depth: number,
  maxNodes: number,
): { truncated: boolean } {
  if (depth <= 1) return { truncated: false };

  let truncated = false;
  let frontier: Set<string> = new Set(chunksByFile.keys());

  for (let level = 2; level <= depth && !truncated && frontier.size > 0; level++) {
    frontier = advanceOneHop({
      ctx,
      chunksByFile,
      hopsByFile,
      normalizedTarget,
      frontier,
      level,
      maxNodes,
      onTruncated: () => {
        truncated = true;
      },
    });
  }

  if (truncated) ctx.log(`BFS stopped at maxNodes=${maxNodes} (dependents truncated)`);
  return { truncated };
}

/**
 * Advance the BFS by one level: for every file in `frontier`, find its
 * dependents and merge any newly-discovered files into `chunksByFile` /
 * `hopsByFile`. Returns the next frontier.
 */
function advanceOneHop<T extends CodeChunk>(args: {
  ctx: ScanContext<T>;
  chunksByFile: Map<string, T[]>;
  hopsByFile: Map<string, number>;
  normalizedTarget: string;
  frontier: Set<string>;
  level: number;
  maxNodes: number;
  onTruncated: () => void;
}): Set<string> {
  const {
    ctx,
    chunksByFile,
    hopsByFile,
    normalizedTarget,
    frontier,
    level,
    maxNodes,
    onTruncated,
  } = args;
  const next = new Set<string>();

  for (const frontierFile of frontier) {
    if (chunksByFile.size >= maxNodes) {
      onTruncated();
      return next;
    }
    const normalizedFrontier = ctx.normalizePathCached(frontierFile);
    if (normalizedFrontier === normalizedTarget) continue;

    const discovered = discoverFrontierDependents(ctx, normalizedFrontier);
    const stoppedEarly = mergeDiscovered({
      discovered,
      chunksByFile,
      hopsByFile,
      normalizedTarget,
      normalizedFrontier,
      normalizePathCached: ctx.normalizePathCached,
      level,
      maxNodes,
      next,
    });
    if (stoppedEarly) {
      onTruncated();
      return next;
    }
  }
  return next;
}

/**
 * Direct importers of `normalizedFrontier` plus its barrel re-exporters,
 * grouped by file. No new scan — reuses `importIndex` / `allChunksByFile`.
 */
function discoverFrontierDependents<T extends CodeChunk>(
  ctx: ScanContext<T>,
  normalizedFrontier: string,
): Map<string, T[]> {
  const dependentChunks = findDependentChunks(
    normalizedFrontier,
    ctx.importIndex,
    ctx.normalizePathCached,
  );
  if (dependentChunks.length === 0) return new Map();
  const grouped = groupChunksByFile(dependentChunks, ctx.workspaceRoot);
  resolveTransitiveDependents(ctx, normalizedFrontier, grouped);
  return grouped;
}

/**
 * Merge discovered files into `chunksByFile` / `hopsByFile` / `next`,
 * skipping the target, the current frontier file, and already-seen files.
 * Returns true if the merge hit the maxNodes cap and stopped early.
 */
function mergeDiscovered<T extends CodeChunk>(args: {
  discovered: Map<string, T[]>;
  chunksByFile: Map<string, T[]>;
  hopsByFile: Map<string, number>;
  normalizedTarget: string;
  normalizedFrontier: string;
  normalizePathCached: (p: string) => string;
  level: number;
  maxNodes: number;
  next: Set<string>;
}): boolean {
  const {
    discovered,
    chunksByFile,
    hopsByFile,
    normalizedTarget,
    normalizedFrontier,
    normalizePathCached,
    level,
    maxNodes,
    next,
  } = args;

  for (const [file, chunks] of discovered.entries()) {
    // `file` uses getCanonicalPath; target/frontier use normalizePath — normalize both.
    const normalizedFile = normalizePathCached(file);
    if (normalizedFile === normalizedTarget) continue;
    if (normalizedFile === normalizedFrontier) continue;
    if (chunksByFile.has(file)) continue;
    if (chunksByFile.size >= maxNodes) return true;
    chunksByFile.set(file, chunks);
    hopsByFile.set(file, level);
    next.add(file);
  }
  return false;
}

/**
 * One distinct (test file, raw import specifier) pair from the import index.
 *
 * Deliberately drops the chunk `ImportIndexEntry` carries: `hasTestImporter`
 * asks a pure existence question, and the match decision
 * (`importMatchesTarget`) reads nothing from a chunk beyond
 * `metadata.file` -- which is `importerFile` here. So many chunks of the same
 * test file that each replicate the file's import list collapse to a single
 * entry, which is where most of the reduction comes from (measured 15x on
 * OrchardCore: 15,339 test import entries -> 1,026 distinct pairs).
 */
interface TestImporterEntry {
  /** Raw (pre-normalization) specifier, as `importMatchesTarget` wants it. */
  rawSpecifier: string;
  /** The importing test file's raw path (the language-detection input). */
  importerFile: string;
}

/**
 * The test-file-only slice of an import index: same keys (normalized import
 * specifiers), entries restricted to test-file importers and deduplicated.
 */
type TestImporterIndex = Map<string, TestImporterEntry[]>;

/**
 * Project an import index down to its test-file importers, once per
 * `findDependents` call (#1075).
 *
 * `countUncoveredProductionDependents` asks "does any test file import this?"
 * once per production dependent. It used to answer that by running a full
 * `findDependentChunks` scan of the WHOLE import index per dependent, which is
 * O(dependents x every indexed import) -- and on a corpus with a high-fan-out
 * target that product is what made a single `get_dependents` call take two
 * minutes: 1,131 dependents x 119k+ entries = ~135M `importMatchesTarget`
 * calls, 95% of a 166s profile. Nothing about the answer needed those 135M
 * questions; the non-test importers were all discarded immediately after being
 * matched.
 *
 * So this is the same build-once/resolve-many split #1073
 * (`buildCSharpTypeReferenceIndex`) and #1071 (`computeDependentCountsFromChunks`)
 * already use: pay one pass over the index, then answer each dependent against
 * a set ~100x smaller. It is a projection, not a different matching dialect --
 * the surviving entries go through the identical `importMatchesTarget`
 * decision, in the identical two-branch (direct bucket, then fuzzy) order.
 *
 * Iterates the already-built `importIndex` rather than the raw chunks on
 * purpose: its keys are the normalized specifiers this index needs anyway, and
 * its entries have already had the build-time #884 whole-module drop applied,
 * so re-deriving either from chunks would be a second implementation of a
 * decision that is already made.
 */
function buildTestImporterIndex<T extends CodeChunk>(
  importIndex: Map<string, ImportIndexEntry<T>[]>,
): TestImporterIndex {
  const testIndex: TestImporterIndex = new Map();
  const isTest = createIsTestFileMemo();

  for (const [normalizedImport, entries] of importIndex.entries()) {
    const bucket = collectTestImporterBucket(entries, isTest);
    if (bucket.length > 0) testIndex.set(normalizedImport, bucket);
  }

  return testIndex;
}

/**
 * The test-file importers of one import-index bucket, deduplicated by
 * (importer file, raw specifier) -- see `TestImporterEntry` for why the chunk
 * itself is dropped. NUL joins the two halves of the dedup key because it is
 * the one byte a file path cannot contain, so no (importer, specifier) pair can
 * collide with a different one by straddling the separator.
 */
function collectTestImporterBucket<T extends CodeChunk>(
  entries: ImportIndexEntry<T>[],
  isTest: (filepath: string) => boolean,
): TestImporterEntry[] {
  const bucket: TestImporterEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const importerFile = entry.chunk.metadata.file;
    if (!isTest(importerFile)) continue;
    const pairKey = `${importerFile}\u0000${entry.rawSpecifier}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    bucket.push({ rawSpecifier: entry.rawSpecifier, importerFile });
  }

  return bucket;
}

/**
 * Memoized `isTestFile`, for one index build. The import index holds an entry
 * per (chunk, specifier), so the same file path is asked about many times over;
 * `isTestFile` is a battery of regexes and its answer per path never changes.
 */
function createIsTestFileMemo(): (filepath: string) => boolean {
  const cache = new Map<string, boolean>();
  return (filepath: string): boolean => {
    const cached = cache.get(filepath);
    if (cached !== undefined) return cached;
    const result = isTestFile(filepath);
    cache.set(filepath, result);
    return result;
  };
}

/**
 * Does any test file import `normalizedTarget`?
 *
 * Mirrors `findDependentChunks`'s two branches exactly, which is what makes
 * this equivalent to the previous "scan every importer, then ask which ones
 * were test files":
 * - A bucket keyed exactly `normalizedTarget` counts unconditionally. Those
 *   keys were built with the same normalizer and already passed the build-time
 *   #884 prune, so `findDependentChunks` never re-guards them either.
 * - Every other bucket's entries go through `importMatchesTarget`, once per
 *   distinct (importer, specifier) pair.
 *
 * Returns on the first hit instead of materializing every importer, since the
 * caller only ever needed the boolean.
 */
function hasTestImporter(
  normalizedTarget: string,
  testIndex: TestImporterIndex,
  normalizePathCached: (path: string) => string,
): boolean {
  const direct = testIndex.get(normalizedTarget);
  if (direct !== undefined && direct.length > 0) return true;

  for (const [normalizedImport, entries] of testIndex.entries()) {
    if (normalizedImport === normalizedTarget) continue;
    // `.some` short-circuits, so this stops at the first matching importer
    // exactly as an early-returning loop would.
    const matched = entries.some(entry =>
      importMatchesTarget(
        entry.rawSpecifier,
        entry.importerFile,
        normalizedTarget,
        normalizePathCached,
      ),
    );
    if (matched) return true;
  }
  return false;
}

/**
 * For each production dependent, check whether any test file imports it.
 * Builds the test-file-only projection of `ctx.importIndex` once (see
 * `buildTestImporterIndex`) and resolves every dependent against that, rather
 * than re-scanning the whole index per dependent.
 */
function countUncoveredProductionDependents<T extends CodeChunk>(
  dependents: DependentInfo[],
  ctx: ScanContext<T>,
): number {
  const productionDependents = dependents.filter(d => !d.isTestFile);
  if (productionDependents.length === 0) return 0;

  const testIndex = buildTestImporterIndex(ctx.importIndex);
  let uncovered = 0;
  for (const d of productionDependents) {
    if (!hasTestImporter(ctx.normalizePathCached(d.filepath), testIndex, ctx.normalizePathCached)) {
      uncovered += 1;
    }
  }
  return uncovered;
}

/**
 * Unpruned reference implementation of the `hasTestImporter` predicate: the
 * whole-import-index scan `countUncoveredProductionDependents` did before
 * #1075, expressed over a raw chunk set.
 *
 * Exists solely as the brute-force oracle the equivalence test checks the
 * fast path against -- the same role `computeDependentCountsBruteForce` plays
 * for `dependent-count-index.ts` (#1071). Production code must never call it:
 * it rebuilds the scan index per query and is O(every indexed import) per
 * question, which is precisely the cost #1075 removed.
 */
export function hasTestImporterBruteForce<T extends CodeChunk>(
  chunks: Iterable<T>,
  filepath: string,
  workspaceRoot: string,
): boolean {
  const normalizePathCached = createPathNormalizer(workspaceRoot);
  const { importIndex } = buildScanIndex(chunks, normalizePathCached);
  const importers = findDependentChunks(
    normalizePathCached(filepath),
    importIndex,
    normalizePathCached,
  );
  return importers.some(chunk => isTestFile(chunk.metadata.file));
}

/**
 * The fast path `hasTestImporterBruteForce` is checked against, over the same
 * raw chunk-set input. Test-facing counterpart only -- `findDependents` builds
 * its scan index once per call and goes straight to `buildTestImporterIndex`.
 */
export function hasTestImporterFromChunks<T extends CodeChunk>(
  chunks: Iterable<T>,
  filepath: string,
  workspaceRoot: string,
): boolean {
  const normalizePathCached = createPathNormalizer(workspaceRoot);
  const { importIndex } = buildScanIndex(chunks, normalizePathCached);
  return hasTestImporter(
    normalizePathCached(filepath),
    buildTestImporterIndex(importIndex),
    normalizePathCached,
  );
}

/**
 * Restrict a file-level chunk map down to exactly the resolved dependent
 * filepaths. Used to join complexity metrics against `dependents` rather
 * than the wider pre-symbol-filter candidate set (see `findDependents`).
 */
function restrictToDependents<T extends CodeChunk>(
  chunksByFile: Map<string, T[]>,
  dependents: DependentInfo[],
): Map<string, T[]> {
  const dependentPaths = new Set(dependents.map(d => d.filepath));
  const restricted = new Map<string, T[]>();
  for (const [filepath, chunks] of chunksByFile.entries()) {
    if (dependentPaths.has(filepath)) {
      restricted.set(filepath, chunks);
    }
  }
  return restricted;
}

/**
 * Find usages of a specific symbol in dependent files.
 *
 * Looks for:
 * 1. Files that import the symbol from the target file or re-exporter paths
 * 2. Chunks within those files that have call sites for the symbol
 *
 * **Known Limitation - Namespace Imports:**
 * Files with namespace imports (e.g., `import * as utils from './module'`) are included
 * in results if they have call sites matching the symbol name. However, call sites are
 * tracked without namespace prefixes (e.g., `utils.foo()` → tracked as `'foo'`), which
 * can cause false positives when the same symbol name exists in multiple namespaced modules.
 * This is rare in practice due to namespace isolation in well-structured codebases.
 */
function findSymbolUsages<T extends CodeChunk>(
  chunksByFile: Map<string, T[]>,
  targetSymbol: string,
  normalizedTarget: string,
  normalizePathCached: (path: string) => string,
  reExporterPaths: string[] = [],
): { dependents: DependentInfo[]; totalUsageCount: number } {
  const dependents: DependentInfo[] = [];
  let totalUsageCount = 0;
  const allTargetPaths = [normalizedTarget, ...reExporterPaths];

  for (const [filepath, chunks] of chunksByFile.entries()) {
    // Check if file imports the symbol from either the target or any re-exporter
    if (!fileImportsSymbolFromAny(chunks, targetSymbol, allTargetPaths, normalizePathCached)) {
      continue;
    }

    const usages = extractSymbolUsagesFromChunks(chunks, targetSymbol);

    dependents.push({
      filepath,
      isTestFile: isTestFile(filepath),
      usages: usages.length > 0 ? usages : undefined,
    });

    totalUsageCount += usages.length;
  }

  return { dependents, totalUsageCount };
}

/**
 * What to call the caller when the calling chunk has no symbol name of its own.
 *
 * A `'block'` chunk is module-level code — top-level statements, a declaration
 * holding no function — so there is no enclosing function to name, and saying
 * so beats `'unknown'`, which reads as "we failed to work it out". Matches the
 * `(module-level)` wording `graph/dependency-graph.ts` (this package, since
 * lifted from `@liendev/review`) and `review`'s own `dependent-context.ts`
 * also use for the same situation — exported so those two sites (and this
 * one) share one implementation instead of three independently-maintained
 * copies of the same ternary (review finding on #1087: the
 * `dependency-graph.ts` copy had fallen out of sync with the other
 * two, still returning `'unknown'` for a module-level caller). Since #1087
 * widened call-site extraction to module-level code this is a common case,
 * not a rare fallback.
 */
export function callerSymbolFor(chunk: CodeChunk): string {
  if (chunk.metadata.symbolName) return chunk.metadata.symbolName;
  return chunk.metadata.type === 'block' ? '(module-level)' : 'unknown';
}

/**
 * Extract all usages of a symbol from a file's chunks.
 */
function extractSymbolUsagesFromChunks<T extends CodeChunk>(
  chunks: T[],
  targetSymbol: string,
): SymbolUsage[] {
  const usages: SymbolUsage[] = [];

  for (const chunk of chunks) {
    const callSites = chunk.metadata.callSites;
    if (!callSites) continue;

    // Split content once per chunk for efficiency (avoid repeated splits)
    const lines = chunk.content.split('\n');

    for (const call of callSites) {
      if (call.symbol === targetSymbol) {
        usages.push({
          callerSymbol: callerSymbolFor(chunk),
          line: call.line,
          snippet: extractSnippet(lines, call.line, chunk.metadata.startLine, targetSymbol),
        });
      }
    }
  }

  return usages;
}

/**
 * Extract a code snippet for a call site with bounds checking.
 * Locates the line via `findChunkLineIndex` (which corrects for a module-level
 * chunk's trimmed content — see its module doc) rather than trusting
 * `callLine - startLine`; if the resulting line is blank, searches nearby lines
 * for context.
 */
function extractSnippet(
  lines: string[],
  callLine: number,
  startLine: number,
  symbolName: string,
): string {
  const placeholder = `${symbolName}(...)`;
  const lineIndex = findChunkLineIndex(lines, callLine, startLine, symbolName);

  if (lineIndex === null) {
    // This can happen when call site line is outside chunk boundaries (edge case)
    // Not necessarily an error - could be chunk boundary misalignment
    return placeholder;
  }

  // Try the direct line first
  const directLine = lines[lineIndex].trim();
  if (directLine) {
    return directLine;
  }

  // If direct line is blank, search for nearby non-blank context
  // Limit search radius to 5 lines to ensure contextual relevance
  const searchRadius = 5;

  // Search backwards first (prefer earlier lines)
  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - searchRadius); i--) {
    const candidate = lines[i].trim();
    if (candidate) {
      return candidate;
    }
  }

  // Search forwards
  for (let i = lineIndex + 1; i < Math.min(lines.length, lineIndex + searchRadius + 1); i++) {
    const candidate = lines[i].trim();
    if (candidate) {
      return candidate;
    }
  }

  return placeholder;
}

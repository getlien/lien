/**
 * Blast-radius computation for PR reviews.
 *
 * Given the set of changed chunks, walks the dependency graph outward to find
 * transitive dependents, overlays test coverage + complexity, and produces a
 * risk-scored report ready for rendering into the agent's initial message.
 */

import type { CodeChunk, RiskLevel, BlastRadiusRisk } from '@liendev/parser';
import { findTestAssociationsFromChunks, computeBlastRadiusRisk } from '@liendev/parser';
import type { DependencyGraph } from './dependency-graph.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlastRadiusSeed {
  filepath: string;
  symbolName: string;
  /** The exporting chunk's symbolType, e.g. 'function' | 'method' | 'class'. */
  symbolType: string;
  /** Complexity of the seed chunk itself, for ranking. */
  complexity: number;
}

export interface BlastRadiusDependent {
  filepath: string;
  symbolName: string;
  /** Distance from the seed: 1 = direct caller, 2 = caller-of-caller, etc. */
  hops: number;
  /** Line in the dependent where the call occurs. */
  callSiteLine: number;
  /** Complexity of the dependent (cognitive preferred, else cyclomatic). Absent when unknown. */
  complexity?: number;
  /** True when a test file imports the dependent's source file. */
  hasTestCoverage: boolean;
}

export interface BlastRadiusEntry {
  seed: BlastRadiusSeed;
  dependents: BlastRadiusDependent[];
  risk: BlastRadiusRisk;
  /** True when BFS truncated before exploring the full reachable set for this seed. */
  truncated: boolean;
}

export interface BlastRadiusReport {
  /** Sorted: highest-risk first, then most-dependent first. */
  entries: BlastRadiusEntry[];
  /** Count of distinct dependents across all entries. */
  totalDistinctDependents: number;
  /** Aggregated risk across all seeds (max level, union of reasoning). */
  globalRisk: BlastRadiusRisk;
  /** True if any entry was truncated. */
  truncated: boolean;
}

export interface ComputeBlastRadiusOptions {
  /** Max hop distance per seed. Default 2. */
  depth?: number;
  /** Max dependents emitted per seed. Default 30. */
  maxNodes?: number;
  /** Max seeds considered. Default 8. */
  maxSeeds?: number;
  /** Complexity threshold above which an uncovered dependent is "high-complexity". Default 15. */
  highComplexityThreshold?: number;
  /** Workspace root for path normalization in test-association lookup. */
  workspaceRoot?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DEPTH = 2;
const DEFAULT_MAX_NODES = 30;
const DEFAULT_MAX_SEEDS = 8;
const DEFAULT_HIGH_COMPLEXITY_THRESHOLD = 15;

const SEED_SYMBOL_TYPES = new Set(['function', 'method', 'class']);

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

// ---------------------------------------------------------------------------
// Seed selection
// ---------------------------------------------------------------------------

function isSeedCandidate(chunk: CodeChunk): boolean {
  const { symbolName, symbolType, exports } = chunk.metadata;
  if (!symbolName || !symbolType) return false;
  if (!SEED_SYMBOL_TYPES.has(symbolType)) return false;

  // Either the file explicitly exports the symbol, or it's a top-level function/class
  // that's a valid target for cross-file calls. Treat "exports contains symbol" as
  // the primary signal; fall back to top-level (no parentClass) for classes/functions.
  const isExported = exports?.includes(symbolName) ?? false;
  if (isExported) return true;

  if (symbolType === 'method') return false; // methods require their class to be exported
  return !chunk.metadata.parentClass;
}

function chunkComplexity(chunk: CodeChunk): number {
  return chunk.metadata.cognitiveComplexity ?? chunk.metadata.complexity ?? 0;
}

function selectSeeds(changedChunks: CodeChunk[], maxSeeds: number): BlastRadiusSeed[] {
  return changedChunks
    .filter(isSeedCandidate)
    .map(chunk => ({
      filepath: chunk.metadata.file,
      symbolName: chunk.metadata.symbolName!,
      symbolType: chunk.metadata.symbolType!,
      complexity: chunkComplexity(chunk),
      isExported: chunk.metadata.exports?.includes(chunk.metadata.symbolName!) ?? false,
    }))
    .sort((a, b) => {
      // Exported first, then higher complexity first.
      if (a.isExported !== b.isExported) return a.isExported ? -1 : 1;
      return b.complexity - a.complexity;
    })
    .slice(0, maxSeeds)
    .map(({ filepath, symbolName, symbolType, complexity }) => ({
      filepath,
      symbolName,
      symbolType,
      complexity,
    }));
}

// ---------------------------------------------------------------------------
// Overlay helpers
// ---------------------------------------------------------------------------

function buildChunkIndex(chunks: CodeChunk[]): Map<string, CodeChunk> {
  const index = new Map<string, CodeChunk>();
  for (const chunk of chunks) {
    const key = `${chunk.metadata.file}::${chunk.metadata.symbolName ?? ''}`;
    // Keep the highest-complexity chunk if multiple chunks share the same key
    // (rare but possible with overloads / partial classes).
    const existing = index.get(key);
    if (!existing || chunkComplexity(chunk) > chunkComplexity(existing)) {
      index.set(key, chunk);
    }
  }
  return index;
}

function computeTestCoverage(
  dependentFiles: Set<string>,
  repoChunks: CodeChunk[],
  workspaceRoot: string | undefined,
): Set<string> {
  if (dependentFiles.size === 0) return new Set();
  const map = findTestAssociationsFromChunks(Array.from(dependentFiles), repoChunks, workspaceRoot);
  const covered = new Set<string>();
  for (const [filepath, tests] of map.entries()) {
    if (tests.length > 0) covered.add(filepath);
  }
  return covered;
}

// ---------------------------------------------------------------------------
// Per-entry enrichment
// ---------------------------------------------------------------------------

interface RawSeedResult {
  seed: BlastRadiusSeed;
  result: ReturnType<DependencyGraph['getCallersTransitive']>;
}

function buildDependent(
  edge: RawSeedResult['result']['callers'][number],
  chunkIndex: Map<string, CodeChunk>,
  coveredFiles: Set<string>,
): BlastRadiusDependent {
  const chunkKey = `${edge.caller.filepath}::${edge.caller.symbolName}`;
  const dependentChunk = chunkIndex.get(chunkKey);
  const complexity = dependentChunk ? chunkComplexity(dependentChunk) : undefined;
  return {
    filepath: edge.caller.filepath,
    symbolName: edge.caller.symbolName,
    hops: edge.hops,
    callSiteLine: edge.callSiteLine,
    complexity: complexity && complexity > 0 ? complexity : undefined,
    hasTestCoverage: coveredFiles.has(edge.caller.filepath),
  };
}

function buildEntry(
  raw: RawSeedResult,
  chunkIndex: Map<string, CodeChunk>,
  coveredFiles: Set<string>,
  highComplexityThreshold: number,
): BlastRadiusEntry {
  const dependents = raw.result.callers.map(edge => buildDependent(edge, chunkIndex, coveredFiles));
  const uncovered = dependents.filter(d => !d.hasTestCoverage);
  const maxDependentComplexity = dependents.reduce((acc, d) => Math.max(acc, d.complexity ?? 0), 0);
  const hasHighComplexityUncovered = uncovered.some(
    d => (d.complexity ?? 0) >= highComplexityThreshold,
  );

  const risk = computeBlastRadiusRisk({
    dependentCount: dependents.length,
    uncoveredDependents: uncovered.length,
    maxDependentComplexity: maxDependentComplexity > 0 ? maxDependentComplexity : undefined,
    hasHighComplexityUncovered,
  });

  return { seed: raw.seed, dependents, risk, truncated: raw.result.truncated };
}

function sortEntries(entries: BlastRadiusEntry[]): void {
  entries.sort((a, b) => {
    const levelDelta = RISK_RANK[b.risk.level] - RISK_RANK[a.risk.level];
    if (levelDelta !== 0) return levelDelta;
    return b.dependents.length - a.dependents.length;
  });
}

// ---------------------------------------------------------------------------
// Global aggregation
// ---------------------------------------------------------------------------

interface GlobalAccumulator {
  seen: Set<string>;
  uncovered: number;
  maxComplexity: number;
  hasHighUncovered: boolean;
}

function accumulateDependent(
  acc: GlobalAccumulator,
  d: BlastRadiusDependent,
  highComplexityThreshold: number,
): void {
  const key = `${d.filepath}::${d.symbolName}`;
  if (acc.seen.has(key)) return;
  acc.seen.add(key);
  if (!d.hasTestCoverage) acc.uncovered += 1;
  if (typeof d.complexity === 'number' && d.complexity > acc.maxComplexity) {
    acc.maxComplexity = d.complexity;
  }
  if (!d.hasTestCoverage && (d.complexity ?? 0) >= highComplexityThreshold) {
    acc.hasHighUncovered = true;
  }
}

function computeGlobalRisk(
  entries: BlastRadiusEntry[],
  highComplexityThreshold: number,
): { risk: BlastRadiusReport['globalRisk']; distinctCount: number } {
  const acc: GlobalAccumulator = {
    seen: new Set(),
    uncovered: 0,
    maxComplexity: 0,
    hasHighUncovered: false,
  };
  for (const entry of entries) {
    for (const d of entry.dependents) {
      accumulateDependent(acc, d, highComplexityThreshold);
    }
  }
  const risk = computeBlastRadiusRisk({
    dependentCount: acc.seen.size,
    uncoveredDependents: acc.uncovered,
    maxDependentComplexity: acc.maxComplexity > 0 ? acc.maxComplexity : undefined,
    hasHighComplexityUncovered: acc.hasHighUncovered,
  });
  return { risk, distinctCount: acc.seen.size };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function computeBlastRadius(
  changedChunks: CodeChunk[],
  graph: DependencyGraph,
  repoChunks: CodeChunk[],
  opts: ComputeBlastRadiusOptions = {},
): BlastRadiusReport {
  const depth = opts.depth ?? DEFAULT_DEPTH;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
  const maxSeeds = opts.maxSeeds ?? DEFAULT_MAX_SEEDS;
  const highComplexityThreshold = opts.highComplexityThreshold ?? DEFAULT_HIGH_COMPLEXITY_THRESHOLD;

  const seeds = selectSeeds(changedChunks, maxSeeds);
  if (seeds.length === 0) return emptyReport();

  const chunkIndex = buildChunkIndex(repoChunks);
  const rawPerSeed: RawSeedResult[] = seeds.map(seed => ({
    seed,
    result: graph.getCallersTransitive(seed.filepath, seed.symbolName, { depth, maxNodes }),
  }));

  const dependentFiles = collectDependentFiles(rawPerSeed);
  const coveredFiles = computeTestCoverage(dependentFiles, repoChunks, opts.workspaceRoot);

  const entries = rawPerSeed.map(raw =>
    buildEntry(raw, chunkIndex, coveredFiles, highComplexityThreshold),
  );
  sortEntries(entries);

  const { risk: globalRisk, distinctCount } = computeGlobalRisk(entries, highComplexityThreshold);

  return {
    entries,
    totalDistinctDependents: distinctCount,
    globalRisk,
    truncated: entries.some(e => e.truncated),
  };
}

function collectDependentFiles(rawPerSeed: RawSeedResult[]): Set<string> {
  const files = new Set<string>();
  for (const { result } of rawPerSeed) {
    for (const edge of result.callers) {
      files.add(edge.caller.filepath);
    }
  }
  return files;
}

function emptyReport(): BlastRadiusReport {
  return {
    entries: [],
    totalDistinctDependents: 0,
    globalRisk: { level: 'low', reasoning: [] },
    truncated: false,
  };
}

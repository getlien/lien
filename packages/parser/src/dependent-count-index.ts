/**
 * Batch reverse-dependency counting: "how many other indexed files import
 * this one", for EVERY file in a chunk set, in one pass.
 *
 * ## Why this exists
 *
 * `findDependents` (dependency-analyzer.ts) is the authoritative per-target
 * reverse-dependency API, and it carries every guard the resolution wave
 * added -- #884 (whole-module imports), #887 (single-file vs. package-directory
 * specifiers), #929 (Python bare-module matching), #1028 (PHP namespace
 * matching), #1021/#1056 (Rust exact-single-file `mod`/crate-root specifiers),
 * plus the C# type-reference (#930/#943) and Go root-package (#1039) recovery
 * tiers. But it resolves ONE target per call and scans the whole import index
 * to do it, so calling it once per file is O(files x unique specifiers) with a
 * per-call floor measured in seconds.
 *
 * `search_code`'s ranking boost needs a count for every file, and needs it
 * cheap. Before #1071 it got that from a private ~40-line resolver that only
 * understood `./foo` and `../bar` specifiers -- so on any language whose
 * imports are dotted namespaces or module URLs (C#, Java, Kotlin, Swift, Go,
 * Rust) EVERY file scored 0, and `applyStructuralBoost` degraded to the exact
 * identity function. This module replaces it: same guarded matching decision
 * as `findDependents` (literally `importMatchesTarget`, not a re-derivation),
 * at batch cost.
 *
 * ## How the batch cost is achieved
 *
 * The naive inversion is a full cross product: every (specifier, file) pair
 * through `importMatchesTarget`. That is exactly what a per-file
 * `findDependents` loop pays, just rearranged.
 *
 * Instead this builds a **candidate index** keyed on a property that is
 * *necessary* for a match, looks up only the candidate targets a specifier
 * could possibly resolve to, and then confirms each candidate with the real
 * `importMatchesTarget`. The final match decision is never approximated --
 * only the set of pairs the decision is *asked about* shrinks.
 *
 * ### The necessary condition, and why it holds
 *
 * Write `segs(x)` for the `/`-separated segments of `x`, `tail(x)` for its
 * last segment. Every branch reachable from `importMatchesTarget(S, f, T)`
 * (with `S` normalized to `nS`) implies:
 *
 *     tailKeys(nS) intersects allKeys(T)   OR   tailKeys(T) intersects allKeys(nS)
 *
 * where `allKeys` = every segment plus each dot-part of each segment, and
 * `tailKeys` = the last segment plus its last dot-part (all lowercased --
 * `matchesPHPNamespace` compares case-insensitively, so the keys must too).
 * Branch by branch:
 *
 * - **Exact match** (`nS === T`): tails are equal. ✔
 * - **`matchesFile` strategy 1** (`T` occurs in `nS` at `/` boundaries):
 *   `segs(T)` is a contiguous run of `segs(nS)`, so `tail(T)` is a segment of
 *   `nS`. ✔ (right-hand disjunct)
 * - **strategy 2** (`nS` occurs in `T` at `/` boundaries): `tail(nS)` is a
 *   segment of `T`. ✔ (left-hand disjunct)
 * - **strategy 3** (the `./`/`../`-stripped `nS` vs `T`, either direction):
 *   containment again; stripping only removes `.`/`..` segments, which are
 *   never a target's segment anyway. ✔
 * - **strategy 4, PHP namespaces**: requires the last components to be equal
 *   case-insensitively. ✔
 * - **strategy 5, Python dotted modules**: all four sub-strategies compare
 *   `moduleAsPath` (= `nS` with dots -> slashes) against `T` by equality,
 *   prefix, suffix, or `/`-anchored interior, so `tail(moduleAsPath)` -- which
 *   is the last dot-part of `nS`, hence in `tailKeys(nS)` -- is a segment of
 *   `T`. The one exception is `matchesWithSourcePrefix`'s right edge, which
 *   also accepts a `.`; that is why `allKeys` includes dot-parts of each
 *   segment rather than whole segments only. ✔
 * - **Rust `mod`/crate-root marker** (`T === nS + '/mod'`): `tail(nS)` is
 *   `T`'s second-to-last segment. ✔
 * - **`isUnresolvableWholeModuleImport`** only ever *rejects*, so pruning
 *   before it is safe (this module drops those specifiers at build time, the
 *   same early drop `indexImportEntry` does).
 *
 * The keys deliberately over-generate (e.g. `allKeys` carries dot-parts on the
 * specifier side too, where only whole segments are strictly required).
 * Over-generating costs a few extra confirmed-by-`importMatchesTarget`
 * candidates; under-generating would silently lose edges, so every deliberate
 * looseness here points the same way. `dependent-count-index.test.ts` pins the
 * property that matters: for a fixture corpus spanning every supported
 * language, the pruned result is IDENTICAL to the brute-force cross product.
 *
 * ## What is deliberately NOT counted
 *
 * - **Re-export/barrel transitivity.** `findDependents` merges dependents
 *   reached through a re-export chain (`buildReExportGraph`), which is a
 *   per-target O(files) scan with no build-once/resolve-many split available.
 *   Direct edges still count the barrel as a dependent of the target and its
 *   consumers as dependents of the barrel, so the graph is intact -- only the
 *   collapsed consumer->target shortcut is missing. That makes this an
 *   UNDERCOUNT, never an overcount, which is the correct failure direction for
 *   a signal that only ever promotes a search result.
 * - **Symbol-level attribution.** File-level only, like
 *   `findDependents(filepath)` with no `symbol`.
 * - **Self-edges.** A file importing itself (`use crate::OwnType`, a
 *   same-directory barrel) is not a dependent of itself.
 *
 * Per #1071's constraint 4: nothing here fabricates a count. A language whose
 * specifiers genuinely do not resolve keeps a 0, and saying so honestly is
 * #1072's job, not this module's.
 */

import type { CodeChunk } from './types.js';
import {
  createPathNormalizer,
  importMatchesTarget,
  isUnresolvableWholeModuleImport,
} from './utils/path-matching.js';
import { detectLanguage } from './ast/languages/registry.js';
import {
  buildCSharpTypeReferenceIndex,
  resolveCSharpTypeReferenceDependents,
} from './csharp-type-reference-signals.js';
import {
  buildGoRootPackageIndex,
  resolveGoRootPackageDependents,
} from './go-root-package-signals.js';
import {
  buildJvmSamePackageIndex,
  resolveJvmSamePackageDependents,
} from './jvm-same-package-signals.js';

/** One distinct (importer file, raw import specifier) pair. */
interface SpecifierEntry {
  /** Raw (pre-normalization) specifier, as `importMatchesTarget` wants it. */
  specifier: string;
  /** The importing file's raw path — `importMatchesTarget` detects its language. */
  importerRaw: string;
  /** Index into `TargetTable.normalized` for the importing file. */
  importerIndex: number;
}

/** The distinct files a specifier can resolve to, plus the key indexes over them. */
interface TargetTable {
  /** Normalized path per target, indexed by target index. */
  normalized: string[];
  /** Raw path per target (the first raw spelling seen), indexed by target index. */
  raw: string[];
  /** Key (from `allKeys`) -> target indexes carrying it. */
  byAllKey: Map<string, number[]>;
  /** Key (from `tailKeys`) -> target indexes carrying it. */
  byTailKey: Map<string, number[]>;
}

/** Split a path into its `/`-separated, non-empty segments. */
function segmentsOf(p: string): string[] {
  return p.split('/').filter(Boolean);
}

/**
 * Every lowercased candidate key a path can be *found by*: each `/`-segment
 * whole, plus each dot-delimited part of each segment. See the module doc for
 * why dot-parts are included on both sides.
 */
function allKeys(p: string): string[] {
  const keys: string[] = [];
  for (const segment of segmentsOf(p)) {
    keys.push(segment.toLowerCase());
    if (segment.includes('.')) {
      for (const part of segment.split('.')) {
        if (part) keys.push(part.toLowerCase());
      }
    }
  }
  return keys;
}

/**
 * The lowercased keys a path is *looked up by*: its last `/`-segment whole,
 * plus that segment's last dot-part (the Python `moduleAsPath` tail, and the
 * dotted-namespace tail for C#/Java/Kotlin). Deliberately NOT every dot-part
 * of the tail: `com.example.service.UserService` must look up `userservice`,
 * not also `com`, whose bucket is every file in a JVM source tree.
 */
function tailKeys(p: string): string[] {
  const segments = segmentsOf(p);
  const tail = segments[segments.length - 1];
  if (!tail) return [];
  const keys = [tail.toLowerCase()];
  if (tail.includes('.')) {
    const parts = tail.split('.').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) keys.push(last.toLowerCase());
  }
  return keys;
}

/** Append `value` to the array at `key`, creating the array on first use. */
function pushKey(index: Map<string, number[]>, key: string, value: number): void {
  const existing = index.get(key);
  if (existing) existing.push(value);
  else index.set(key, [value]);
}

/**
 * Collect the distinct files in `chunks` (keyed on their normalized path, so
 * absolute/relative spellings of one file collapse) and index them by both key
 * flavors. Also returns the normalized-path -> target-index lookup the
 * specifier pass needs to identify self-edges.
 */
function buildTargetTable(
  chunks: Iterable<CodeChunk>,
  normalize: (p: string) => string,
): { table: TargetTable; indexByNormalized: Map<string, number> } {
  const table: TargetTable = {
    normalized: [],
    raw: [],
    byAllKey: new Map(),
    byTailKey: new Map(),
  };
  const indexByNormalized = new Map<string, number>();

  for (const chunk of chunks) {
    const rawFile = chunk.metadata.file;
    if (!rawFile) continue;
    const normalized = normalize(rawFile);
    if (indexByNormalized.has(normalized)) continue;

    const targetIndex = table.normalized.length;
    indexByNormalized.set(normalized, targetIndex);
    table.normalized.push(normalized);
    table.raw.push(rawFile);
    for (const key of new Set(allKeys(normalized))) pushKey(table.byAllKey, key, targetIndex);
    for (const key of new Set(tailKeys(normalized))) pushKey(table.byTailKey, key, targetIndex);
  }

  return { table, indexByNormalized };
}

/**
 * Every distinct (importer, specifier) pair worth resolving. Mirrors
 * `addChunkToImportIndex`: both `metadata.imports` and the keys of
 * `metadata.importedSymbols` are import specifiers, and bare whole-module
 * imports are dropped up front (#884's early drop).
 *
 * Deduplicated per (importer, specifier) because every chunk in a file carries
 * the same file-level `imports` array.
 */
function collectSpecifierEntries(
  chunks: Iterable<CodeChunk>,
  normalize: (p: string) => string,
  indexByNormalized: Map<string, number>,
): SpecifierEntry[] {
  const entries: SpecifierEntry[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const importerRaw = chunk.metadata.file;
    const importerIndex = importerRaw ? indexByNormalized.get(normalize(importerRaw)) : undefined;
    if (!importerRaw || importerIndex === undefined) continue;
    collectChunkSpecifiers(chunk, importerRaw, importerIndex, seen, entries);
  }

  return entries;
}

/** `collectSpecifierEntries`'s per-chunk half: dedupe and append one chunk's specifiers. */
function collectChunkSpecifiers(
  chunk: CodeChunk,
  importerRaw: string,
  importerIndex: number,
  seen: Set<string>,
  entries: SpecifierEntry[],
): void {
  const specifiers = [
    ...(chunk.metadata.imports ?? []),
    ...Object.keys(chunk.metadata.importedSymbols ?? {}),
  ];
  for (const specifier of specifiers) {
    const dedupeKey = `${importerIndex} ${specifier}`;
    if (!specifier || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (isUnresolvableWholeModuleImport(specifier, importerRaw)) continue;
    entries.push({ specifier, importerRaw, importerIndex });
  }
}

/**
 * The candidate target indexes one specifier could match, per the module doc's
 * necessary condition. Both disjuncts are unioned; `importMatchesTarget`
 * decides the rest.
 */
function candidateTargets(normalizedSpecifier: string, table: TargetTable): Set<number> {
  const candidates = new Set<number>();
  for (const key of tailKeys(normalizedSpecifier)) {
    for (const targetIndex of table.byAllKey.get(key) ?? []) candidates.add(targetIndex);
  }
  for (const key of allKeys(normalizedSpecifier)) {
    for (const targetIndex of table.byTailKey.get(key) ?? []) candidates.add(targetIndex);
  }
  return candidates;
}

/**
 * The reverse import graph as sets of importer target-indexes, keyed by the
 * imported target index. Sets (not counters) because one importer file reaching
 * a target through several specifiers is still one dependent.
 */
function buildReverseEdges(
  entries: SpecifierEntry[],
  table: TargetTable,
  normalize: (p: string) => string,
): Map<number, Set<number>> {
  const reverse = new Map<number, Set<number>>();

  for (const entry of entries) {
    const normalizedSpecifier = normalize(entry.specifier);
    for (const targetIndex of candidateTargets(normalizedSpecifier, table)) {
      if (targetIndex === entry.importerIndex) continue; // self-import noise
      if (
        !importMatchesTarget(
          entry.specifier,
          entry.importerRaw,
          table.normalized[targetIndex],
          normalize,
        )
      ) {
        continue;
      }
      let importers = reverse.get(targetIndex);
      if (!importers) {
        importers = new Set();
        reverse.set(targetIndex, importers);
      }
      importers.add(entry.importerIndex);
    }
  }

  return reverse;
}

/**
 * Lazily-built project-wide indexes for the three non-import recovery tiers.
 * Built on first use, so a corpus with no zero-dependent C#/Go/JVM file pays
 * nothing for any of them.
 *
 * Exported so `dependency-analyzer.ts`'s `findDependents` can thread the
 * exact same bag shape through its own `ScanContext` (#1101) -- this is the
 * one shared home for "which of the three recovery indexes has been built
 * so far in the current batch", rather than two structurally-identical
 * interfaces declared separately. The two call sites' caching logic stays
 * separate (`recoverDependentsForFile` below vs. the three
 * `enrichWith*Dependents` functions) since their call shapes genuinely
 * differ; only the bag's TYPE is shared.
 */
export interface RecoveryIndexes {
  csharp?: ReturnType<typeof buildCSharpTypeReferenceIndex>;
  go?: ReturnType<typeof buildGoRootPackageIndex>;
  jvm?: ReturnType<typeof buildJvmSamePackageIndex>;
}

/**
 * Files recovered for `rawFile` by whichever recovery tier its language has, or
 * `[]` for a language with none. All three tiers already ship the
 * build-once/resolve-many split this needs (`CSharpTypeReferenceIndex`,
 * `GoRootPackageIndex`, `JvmSamePackageIndex`), so this reuses their resolvers
 * rather than re-deriving any of the three signals. The `jvm` index is built
 * fresh, lazily, from this call's own `chunks` snapshot -- deliberately NOT
 * `jvm-source-root.ts`'s module-level cache-keyed-by-workspace-root pattern,
 * which goes stale for the life of a long-running `lien serve`; this index is
 * scoped to one `computeDependentCountsFromChunks` call and discarded after.
 */
function recoverDependentsForFile(
  rawFile: string,
  chunks: CodeChunk[],
  workspaceRoot: string,
  indexes: RecoveryIndexes,
): string[] {
  const language = detectLanguage(rawFile);
  if (language === 'csharp') {
    indexes.csharp ??= buildCSharpTypeReferenceIndex(chunks);
    return resolveCSharpTypeReferenceDependents(rawFile, indexes.csharp);
  }
  if (language === 'go') {
    indexes.go ??= buildGoRootPackageIndex(chunks, workspaceRoot);
    return resolveGoRootPackageDependents(rawFile, indexes.go);
  }
  if (language === 'java' || language === 'kotlin') {
    indexes.jvm ??= buildJvmSamePackageIndex(chunks);
    return resolveJvmSamePackageDependents(rawFile, indexes.jvm);
  }
  return [];
}

/**
 * Apply the three non-import recovery tiers `findDependents` applies, under
 * the same precondition it uses: only for a target the import graph found
 * LITERALLY ZERO dependents for -- see `enrichWithCSharpTypeReferenceDependents`
 * (#930/#943), `enrichWithGoRootPackageDependents` (#1039), and
 * `enrichWithJvmSamePackageDependents` (#1005).
 *
 * Mutates `reverse` in place, matching those three functions' own convention.
 */
function applyRecoveryTiers(ctx: {
  table: TargetTable;
  reverse: Map<number, Set<number>>;
  chunks: CodeChunk[];
  workspaceRoot: string;
  indexByNormalized: Map<string, number>;
  normalize: (p: string) => string;
}): void {
  const { table, reverse, chunks, workspaceRoot, indexByNormalized, normalize } = ctx;
  const indexes: RecoveryIndexes = {};

  table.normalized.forEach((_normalized, targetIndex) => {
    if ((reverse.get(targetIndex)?.size ?? 0) > 0) return;
    const recovered = recoverDependentsForFile(
      table.raw[targetIndex],
      chunks,
      workspaceRoot,
      indexes,
    );
    for (const file of recovered) {
      const importerIndex = indexByNormalized.get(normalize(file));
      if (importerIndex !== undefined) recordEdge(reverse, targetIndex, importerIndex);
    }
  });
}

/**
 * Record one (importer -> target) edge, skipping self-edges. A file importing
 * itself is not a dependent of itself -- see the module doc.
 */
function recordEdge(
  reverse: Map<number, Set<number>>,
  targetIndex: number,
  importerIndex: number,
): void {
  if (targetIndex === importerIndex) return;
  let importers = reverse.get(targetIndex);
  if (!importers) {
    importers = new Set();
    reverse.set(targetIndex, importers);
  }
  importers.add(importerIndex);
}

/**
 * Flatten the reverse-edge sets into the public count map.
 *
 * Keyed on the RAW `chunk.metadata.file` string, not the normalized path: the
 * consumer is `search_code`'s ranking path, which holds exactly that string on
 * every row it scores. Keying on raw means the query path does zero
 * normalization work per result -- the whole point of precomputing this. The
 * normalized form stays an internal matching detail.
 *
 * `buildTargetTable` collapses several raw spellings of one file (absolute vs.
 * workspace-relative) onto the first one seen, so a caller holding a different
 * spelling of the same file should normalize both sides itself. Every writer in
 * this repo feeds the exact strings the store holds, so that case does not
 * arise in practice.
 */
function finalizeCounts(
  table: TargetTable,
  reverse: Map<number, Set<number>>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [targetIndex, importers] of reverse) {
    if (importers.size > 0) counts.set(table.raw[targetIndex], importers.size);
  }
  return counts;
}

/**
 * How many DISTINCT other indexed files import each file in `chunks`, keyed on
 * the raw `chunk.metadata.file` string (see `finalizeCounts` for why raw and
 * not normalized).
 *
 * Only files with at least one dependent appear in the map; read a missing key
 * as `0`. See the module doc for what is and is not counted, and for why this
 * is exact with respect to `importMatchesTarget` rather than a second
 * approximation of it.
 *
 * `chunks` must be the FULL project chunk set: both recovery tiers, and every
 * uniqueness check they rest on, are project-wide properties.
 *
 * `options.recoveryTiers: false` suppresses the two non-import recovery tiers,
 * leaving only import-graph edges. No production caller passes it; it exists so
 * the contribution of each half can be measured separately, which is how #1071
 * established that C# gets essentially ALL of its counts from the type-reference
 * tier (`using` statements name namespaces, and nothing resolves a namespace to
 * a file yet — that is #1067's track) while Go/Rust/Python get theirs from
 * import edges. Without a way to separate them, a future perf regression in one
 * tier is indistinguishable from a quality change in the other.
 */
export function computeDependentCountsFromChunks(
  chunks: CodeChunk[],
  workspaceRoot: string,
  options: { recoveryTiers?: boolean } = {},
): Map<string, number> {
  const normalize = createPathNormalizer(workspaceRoot);
  const { table, indexByNormalized } = buildTargetTable(chunks, normalize);
  const entries = collectSpecifierEntries(chunks, normalize, indexByNormalized);
  const reverse = buildReverseEdges(entries, table, normalize);
  if (options.recoveryTiers !== false) {
    applyRecoveryTiers({ table, reverse, chunks, workspaceRoot, indexByNormalized, normalize });
  }
  return finalizeCounts(table, reverse);
}

/**
 * Brute-force reference implementation: every (specifier, file) pair through
 * `importMatchesTarget`, with no candidate pruning at all. Exported for
 * `dependent-count-index.test.ts`, which asserts that the pruned
 * `computeDependentCountsFromChunks` agrees with this exactly on a
 * multi-language fixture corpus -- the property that makes the candidate index
 * a pruning optimization rather than a third matching dialect.
 *
 * Never call this in production: it is precisely the O(files x unique
 * specifiers) cost the candidate index exists to avoid.
 */
export function computeDependentCountsBruteForce(
  chunks: CodeChunk[],
  workspaceRoot: string,
): Map<string, number> {
  const normalize = createPathNormalizer(workspaceRoot);
  const { table, indexByNormalized } = buildTargetTable(chunks, normalize);
  const entries = collectSpecifierEntries(chunks, normalize, indexByNormalized);

  const reverse = new Map<number, Set<number>>();
  for (const entry of entries) {
    table.normalized.forEach((normalizedTarget, targetIndex) => {
      if (importMatchesTarget(entry.specifier, entry.importerRaw, normalizedTarget, normalize)) {
        recordEdge(reverse, targetIndex, entry.importerIndex);
      }
    });
  }
  applyRecoveryTiers({ table, reverse, chunks, workspaceRoot, indexByNormalized, normalize });
  return finalizeCounts(table, reverse);
}

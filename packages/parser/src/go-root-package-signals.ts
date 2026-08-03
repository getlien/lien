/**
 * #1039: recover REAL dependents for a Go module's ROOT package when the
 * import graph finds none, because a Go file outside the root package that
 * references it has no way to spell that reference except the module's own
 * full import path with no further path segment (`import
 * "github.com/go-chi/chi/v5"`) -- Go has no relative-import syntax, and the
 * bare self-import is exactly, and only, that literal string. `go-module.ts`'s
 * `resolveGoModuleImport` deliberately leaves this case unresolved (a
 * no-op -- see its own doc comment for why that's still correct for #867's
 * narrower test-association scope), so nothing in `chunk.metadata.imports`
 * ever names a specific root-package FILE, and every root file (`chi.go`,
 * `mux.go`, `tree.go`, `chain.go`, `context.go` for go-chi/chi) reports zero
 * dependents despite being genuinely, heavily imported by every subpackage
 * (measured: 86 files, 11 total edges, 94.2% orphan rate -- #1004/#1023/#1029
 * chased this to a verdict; #1039 is the root cause).
 *
 * Deliberately NOT fixed by making the generic import-resolution pipeline
 * (`resolveManifestRoot`/`matchesFile`) treat a bare self-import as "the
 * whole root-package directory," the way a Go SUBPACKAGE import already does
 * (`middleware` resolves to every file under `middleware/` via `matchesFile`
 * Strategy 2's interior-hit leniency): a subpackage's directory is scoped to
 * its own subtree, but the module ROOT is frequently the repository root
 * itself, alongside dozens of unrelated root-level files (chi's own root has
 * 5 non-test `.go` files, several exporting 30+ symbols each). Crediting the
 * whole directory there would make every subpackage file that merely imports
 * its own module appear to depend on EVERY root file, regardless of which
 * symbol it actually uses -- exactly the false-hub shape this project has
 * been burned by twice already (#1008's fabricated Rust self-edges, #1056's
 * open Rust `use crate::` 144-file identical-list bug). This module instead
 * recovers the SPECIFIC root file genuinely referenced, via export lookup:
 * which root file actually EXPORTS the symbol a bare-self-importing file's
 * own call sites reference.
 *
 * Mechanism, for one target root file R:
 *   1. R must be a ROOT-LEVEL, non-test Go file -- directly inside the
 *      workspace root (no directory segment), the same location
 *      `resolveGoModulePrefix` already assumes `go.mod` lives (see
 *      `isRootLevelGoFile`).
 *   2. Collect R's own top-level exports (`chunk.metadata.exports`, already
 *      computed by `GoExportExtractor`) that are DISTINCTIVE -- pass both
 *      `isUnambiguousIdentifierShape` (a real camelCase/PascalCase/
 *      underscored shape, not a bare English word) and
 *      `isMultiSegmentIdentifier` (>=2 identifier segments) -- see
 *      `swift-symbol-usage-signals.ts`'s own doc comment for why a
 *      single-segment bare word is exactly the shape most likely to collide
 *      with an unrelated identifier. This is the load-bearing guard for a Go
 *      HTTP router specifically: root files export plenty of single-segment,
 *      extremely common method names (`Use`, `Get`, `Post`, `Route`, `Match`,
 *      `Find`) that any unrelated type in the same corpus could just as
 *      easily define -- `RouteContext`, `NewRouteContext`, `HandleFunc`,
 *      `MethodNotAllowedHandler` are the shape this project actually wants to
 *      credit.
 *   3. A distinctive export name is only trusted when EXACTLY ONE root-level
 *      file declares it project-wide (never guessed at when ambiguous -- e.g.
 *      chi's own `ServeHTTP` is declared by BOTH `chain.go` (on
 *      `ChainHandler`) and `mux.go` (on `Mux`), so it's excluded from every
 *      root file's owned-symbol set).
 *   4. A referencer file D (any OTHER Go file, any directory, production or
 *      test) is recovered as a dependent of R when D's OWN `imports` contain
 *      the literal, unresolved module-prefix string (proof D genuinely
 *      declared an intent to use the root package -- this is NOT a
 *      corpus-wide text scan; only files that already import the root
 *      package are ever considered) AND D's own `callSites` (aggregated
 *      across all of D's chunks) name one of R's uniquely-owned distinctive
 *      exports.
 *
 * Verified against a real clone (go-chi/chi, the corpus that motivated
 * #1004/#1023/#1029/#1039): recovers `context.go` -> 5 real `middleware/*.go`
 * callers of `chi.RouteContext`/`chi.NewRouteContext`, `mux.go` -> real
 * callers of `chi.NewMux`-shaped exports, etc., while two unrelated root
 * files (`context.go`, `chi.go`) return disjoint dependent lists -- see the
 * PR description for the full before/after table and the explicit false-hub
 * check.
 *
 * This is a strictly ADDITIVE, lower-confidence recovery, mirroring
 * `csharp-type-reference-signals.ts`'s discipline exactly: dependents
 * recovered here are tagged `confidence: 'inferred'` (see `DependentInfo` in
 * `dependency-analyzer.ts`) and only attempted when the import graph found
 * LITERALLY ZERO dependents for a file-level (no `symbol`) query -- see
 * `enrichWithGoRootPackageDependents`'s own doc comment there.
 *
 * What this does NOT solve: a call-site symbol match cannot distinguish a
 * genuine root-package reference from an unrelated call that merely shares
 * the same distinctive name (residual risk, same category `swift-symbol-
 * usage-signals.ts`/`csharp-type-reference-signals.ts` both accept and hedge
 * via `confidence: 'inferred'` rather than eliminate); nor does it recover
 * anything for a root file whose ENTIRE exported surface is single-segment
 * (no distinctive name to key off at all) -- an honest miss, never a
 * fabricated hit.
 */

import type { CodeChunk } from './types.js';
import { isTestFile } from './utils/path-matching.js';
import { detectLanguage } from './ast/languages/registry.js';
import { resolveGoModulePrefix } from './go-module.js';
import { isUnambiguousIdentifierShape } from './doc-reference-matching.js';
import { isMultiSegmentIdentifier } from './swift-symbol-usage-signals.js';

/**
 * True iff `file` sits directly inside the workspace root, with no further
 * directory segment -- Go's own ROOT package, as opposed to a subpackage
 * living in a subdirectory. Mirrors the same "go.mod lives at the workspace
 * root" assumption `resolveGoModulePrefix` already makes (it reads
 * `<workspaceRoot>/go.mod` directly, never searching subdirectories).
 *
 * Exported so `findGoRootPackageDependents` can early-return BEFORE building
 * the project-wide index for any non-root target (a subpackage file can
 * never own a recovered dependent via this signal -- see
 * `buildRootExportOwners`, which already filters its OWNER side to
 * root-level files) -- a perf fix (review finding on #1039's PR): without
 * this check here, every zero-dependent Go query paid a full
 * `groupGoChunksByFile` + `buildRootExportOwners` project scan just to be
 * told `[]`, not only root-level queries.
 */
export function isRootLevelGoFile(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  return detectLanguage(normalized) === 'go' && !normalized.includes('/');
}

/** True iff `symbol` is distinctive enough to trust as an export-lookup key -- see the module doc's step 2. */
function isDistinctiveGoRootSymbol(symbol: string): boolean {
  return isUnambiguousIdentifierShape(symbol) && isMultiSegmentIdentifier(symbol);
}

/** Group `chunks` by file, preserving first-seen order. Deliberately unnormalized -- works on `chunk.metadata.file` strings as-is, mirroring `csharp-type-reference-signals.ts`'s own no-normalization discipline. */
function groupGoChunksByFile(chunks: CodeChunk[]): Map<string, CodeChunk[]> {
  const out = new Map<string, CodeChunk[]>();
  for (const chunk of chunks) {
    const list = out.get(chunk.metadata.file);
    if (list) list.push(chunk);
    else out.set(chunk.metadata.file, [chunk]);
  }
  return out;
}

/**
 * Distinctive export name -> its single owning root-level file, project-wide.
 * A name declared by more than one root-level file (e.g. chi's own
 * `ServeHTTP`, declared by both `chain.go` and `mux.go`) is excluded entirely
 * -- see the module doc's step 3.
 */
function buildRootExportOwners(chunksByFile: Map<string, CodeChunk[]>): Map<string, string> {
  const defMap = new Map<string, Set<string>>();

  for (const [file, fileChunks] of chunksByFile) {
    if (!isRootLevelGoFile(file) || isTestFile(file)) continue;
    const exportsForFile = fileChunks.find(c => c.metadata.exports?.length)?.metadata.exports ?? [];
    for (const symbol of exportsForFile) {
      if (!isDistinctiveGoRootSymbol(symbol)) continue;
      const files = defMap.get(symbol) ?? new Set<string>();
      files.add(file);
      defMap.set(symbol, files);
    }
  }

  const owners = new Map<string, string>();
  for (const [symbol, files] of defMap) {
    if (files.size === 1) owners.set(symbol, [...files][0]);
  }
  return owners;
}

/** True iff any of `fileChunks` (all belonging to one file) records the literal, unresolved `modulePrefix` among its own raw imports -- proof that file genuinely declared an intent to use the module's root package. */
function fileImportsBareModuleRoot(fileChunks: CodeChunk[], modulePrefix: string): boolean {
  return fileChunks.some(c => (c.metadata.imports ?? []).includes(modulePrefix));
}

/** Every distinctive symbol referenced anywhere in `fileChunks`' own `callSites` (aggregated across all of that file's chunks -- each chunk only carries the call sites made within its own function/method body). */
function collectCallSiteSymbols(fileChunks: CodeChunk[]): Set<string> {
  const symbols = new Set<string>();
  for (const chunk of fileChunks) {
    for (const call of chunk.metadata.callSites ?? []) {
      symbols.add(call.symbol);
    }
  }
  return symbols;
}

/**
 * Everything `resolveGoRootPackageDependents` needs to resolve any number of
 * target root files against ONE project-wide scan -- built once by
 * `buildGoRootPackageIndex` and reused per target, mirroring
 * `CSharpTypeReferenceIndex`'s "build once, resolve many" discipline.
 */
export interface GoRootPackageIndex {
  chunksByFile: Map<string, CodeChunk[]>;
  owners: Map<string, string>;
  /** `go.mod`'s own declared module prefix, or `undefined` for a non-Go-module workspace (in which case `owners` is always empty and every resolution is a no-op). */
  modulePrefix: string | undefined;
}

/**
 * Build the project-wide index `resolveGoRootPackageDependents` needs from
 * `chunks` once. `chunks` should be the FULL project chunk set -- both
 * root-export uniqueness and the module prefix are project-wide properties,
 * not scoped to any one target file.
 */
export function buildGoRootPackageIndex(
  chunks: CodeChunk[],
  workspaceRoot: string,
): GoRootPackageIndex {
  const modulePrefix = resolveGoModulePrefix(workspaceRoot);
  const chunksByFile = groupGoChunksByFile(chunks);
  const owners = modulePrefix ? buildRootExportOwners(chunksByFile) : new Map<string, string>();
  return { chunksByFile, owners, modulePrefix };
}

/**
 * Find Go files (any directory, production or test) that reference one of
 * `targetFile`'s uniquely-owned, distinctive root-package exports -- via a
 * genuine bare self-import of the module root PLUS a matching call-site
 * symbol -- against an already-built `index` (see `buildGoRootPackageIndex`).
 * Excludes `targetFile` itself. Returns a sorted, deduplicated list of
 * filepaths -- empty when `targetFile` isn't a root-level Go file, owns no
 * distinctive export, or genuinely has no referencers in the index.
 *
 * `targetFile` must be the exact `chunk.metadata.file` string used by
 * `targetFile`'s own chunks within the chunks `index` was built from -- this
 * function does no path normalization of its own, mirroring
 * `resolveCSharpTypeReferenceDependents`'s same discipline.
 */
export function resolveGoRootPackageDependents(
  targetFile: string,
  index: GoRootPackageIndex,
): string[] {
  const { chunksByFile, owners, modulePrefix } = index;
  if (!modulePrefix) return [];

  const ownedSymbols = [...owners.entries()]
    .filter(([, file]) => file === targetFile)
    .map(([symbol]) => symbol);
  if (ownedSymbols.length === 0) return [];

  const found: string[] = [];
  for (const [file, fileChunks] of chunksByFile) {
    if (file === targetFile) continue;
    if (detectLanguage(file) !== 'go') continue;
    if (!fileImportsBareModuleRoot(fileChunks, modulePrefix)) continue;

    const callSiteSymbols = collectCallSiteSymbols(fileChunks);
    if (ownedSymbols.some(s => callSiteSymbols.has(s))) found.push(file);
  }
  return found.sort();
}

/**
 * Single-target convenience wrapper around `buildGoRootPackageIndex` +
 * `resolveGoRootPackageDependents`, for callers resolving just ONE target
 * file (`get_dependents`'s file-level recovery, #1039). Callers resolving
 * MANY target files against the same chunk set should build the index once
 * themselves instead of calling this in a loop -- see `GoRootPackageIndex`'s
 * doc comment.
 *
 * Short-circuits BEFORE `buildGoRootPackageIndex`'s project-wide scan for any
 * non-Go OR non-root-level target -- a subpackage file can never own a
 * recovered dependent via this signal (`buildRootExportOwners` only ever
 * populates owners for root-level files), so there is no reason to pay a
 * full `groupGoChunksByFile` + `buildRootExportOwners` scan just to
 * rediscover that and return `[]`. This is the guard
 * `enrichWithGoRootPackageDependents` (`dependency-analyzer.ts`) documents
 * itself as relying on to skip the corpus-wide index rebuild for a
 * non-root-level query.
 */
export function findGoRootPackageDependents(
  targetFile: string,
  chunks: CodeChunk[],
  workspaceRoot: string,
): string[] {
  if (detectLanguage(targetFile) !== 'go' || !isRootLevelGoFile(targetFile)) return [];
  return resolveGoRootPackageDependents(targetFile, buildGoRootPackageIndex(chunks, workspaceRoot));
}

/**
 * Shared path matching utilities for dependency analysis.
 *
 * These functions handle path normalization and matching logic used by
 * the get_dependents tool to find reverse dependencies.
 */

import * as path from 'node:path';

import {
  getSupportedExtensions,
  detectLanguage,
  hasWholeModuleImports,
  hasSingleFileImports,
  hasNamespaceStyleImports,
} from '../ast/languages/registry.js';
import { hasRustModMarker, stripRustModMarker } from './rust-mod-marker.js';

/**
 * Escape special regex characters in a string.
 * This ensures extensions like "c++" don't break the regex pattern.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the extension-stripping regex from the language registry.
 * Cached after first call.
 */
let extensionRegex: RegExp | null = null;

function getExtensionRegex(): RegExp {
  if (!extensionRegex) {
    const extPattern = getSupportedExtensions().map(escapeRegex).join('|');
    extensionRegex = new RegExp(`\\.(${extPattern})$`);
  }
  return extensionRegex;
}

/**
 * Normalizes a file path for comparison.
 *
 * - Removes quotes and trims whitespace
 * - Converts backslashes to forward slashes
 * - Strips file extensions for all AST-supported languages
 * - Converts absolute paths to relative (if within workspace root)
 *
 * @param path - The path to normalize
 * @param workspaceRoot - The workspace root directory (normalized with forward slashes)
 * @returns Normalized path
 */
export function normalizePath(path: string, workspaceRoot: string): string {
  // Strip the #1021 Rust-mod marker (see `rust-mod-marker.ts`) first, before
  // any other processing, so every caller that normalizes a raw specifier --
  // including the two `isExactDirectImport` helpers (test-associations.ts,
  // get_files_context's handler) that compare `normalize(imp) ===
  // normalizedTarget` directly rather than routing through
  // `importMatchesTarget` -- gets a clean, comparable value with no changes
  // needed at those call sites. A no-op for every non-Rust-mod path (the
  // marker is a Private-Use-Area code point no real specifier starts with).
  let normalized = (hasRustModMarker(path) ? stripRustModMarker(path) : path)
    .replace(/['"]/g, '')
    .trim()
    .replace(/\\/g, '/');

  // Normalize extensions: strip all AST-supported language extensions
  // This handles TypeScript's ESM requirement of .js imports for .ts files
  // Also handles PHP files where namespaces don't include extensions
  // Also handles Python files where module imports don't include extensions
  normalized = normalized.replace(getExtensionRegex(), '');

  // Normalize to relative path if it starts with workspace root
  if (normalized.startsWith(workspaceRoot + '/')) {
    normalized = normalized.substring(workspaceRoot.length + 1);
  }

  return normalized;
}

/**
 * Creates a cached `normalizePath` wrapper, to avoid repeating the same string
 * work for a path (or import specifier) seen many times in one analysis pass.
 *
 * Lives here rather than in `dependency-analyzer.ts` (its original home) so the
 * batch reverse-dependency pass in `dependent-count-index.ts` shares the exact
 * same normalizer construction as `analyzeDependencies`/`findDependents` --
 * `importMatchesTarget` takes the caller's normalizer as a parameter, and two
 * call sites building it differently is precisely how a "same decision,
 * implemented at N sites" divergence starts.
 *
 * @param workspaceRoot - The workspace root directory for path normalization
 * @returns A function that normalizes and caches file paths
 */
export function createPathNormalizer(workspaceRoot: string): (path: string) => string {
  const cache = new Map<string, string>();
  return (p: string): string => {
    const cached = cache.get(p);
    if (cached !== undefined) return cached;
    const normalized = normalizePath(p, workspaceRoot);
    cache.set(p, normalized);
    return normalized;
  };
}

/**
 * Checks if a pattern matches at path component boundaries.
 *
 * Ensures matches occur at proper path boundaries (/) to avoid false positives like:
 * - "logger" matching "logger-utils" ❌
 * - "src/logger" matching "src/logger-service" ❌
 *
 * @param str - The string to search in
 * @param pattern - The pattern to search for
 * @returns True if pattern matches at a boundary
 */
export function matchesAtBoundary(str: string, pattern: string): boolean {
  const index = str.indexOf(pattern);
  if (index === -1) return false;

  // Check character before match (must be start or path separator)
  const charBefore = index > 0 ? str[index - 1] : '/';
  if (charBefore !== '/' && index !== 0) return false;

  // Check character after match (must be end or path separator)
  // Extensions are already stripped during normalization, so we only need to check for '/' as a valid path separator
  const endIndex = index + pattern.length;
  if (endIndex === str.length) return true;
  const charAfter = str[endIndex];
  return charAfter === '/';
}

/**
 * Like `matchesAtBoundary`, but additionally requires a bare (non-relative)
 * `pattern` to represent the *whole* relationship rather than a coincidental
 * partial one:
 *
 * - For a single-segment (slash-free) `pattern`, the match must always
 *   reach the end of `str`. An interior hit means `str` continues into an
 *   unrelated subtree beyond the identifier, e.g. a bare `require 'sinatra'`
 *   matching every file under `lib/sinatra/` rather than just the gem's own
 *   entry point (`lib/sinatra.rb`). At most `maxLeadingSegments` directory
 *   segments may additionally precede the match. The two `matchesFile` call
 *   sites need different values here because a bare identifier plays a
 *   different role in each direction:
 *   - Strategy 2 passes 1, allowing the established "source directory
 *     prefix" convention (a bare *import* like `auth` resolving to
 *     `src/auth.rs`) — a real, confirmed pattern (see the Rust tests above).
 *   - Strategy 1 passes 0 (i.e. no match beyond the exact-match check
 *     already done in `matchesFile`), because there's no confirmed
 *     legitimate case for a bare *target* (a short top-level file's own
 *     basename) matching merely the tail of a longer, qualified import —
 *     that shape is exactly the Go bug: a manifest-resolved import like
 *     `internal/fs` (already module-prefix-stripped by #867) must not
 *     tail-match an unrelated top-level `fs` target just because one leading
 *     segment happens to precede it.
 *   Both directions still reject a bare `import Combine` (system framework)
 *   matching `Source/Features/Combine.swift` (2 leading segments, over
 *   either threshold).
 * - For a MULTI-segment `pattern`, whether an interior hit (an unrelated
 *   subtree continuing beyond the match) is rejected depends on
 *   `requireExactTailForMultiSegment`, because the two currently-supported
 *   languages that reach this branch disagree about what a multi-segment
 *   bare specifier names:
 *   - Ruby: `require 'rack/protection'` loads exactly ONE file
 *     (`rack/protection.rb`) — a sibling `rack/protection/base.rb` is a
 *     separate module, not a member (#887). Callers for Ruby-shaped
 *     importers pass `true`, rejecting the interior-hit ("child file")
 *     case the same way the single-segment branch always has.
 *   - Go: `import "mymodule/internal/fs"` (normalized to the bare
 *     `internal/fs` after #877's module-prefix stripping) names a PACKAGE —
 *     every `.go` file inside that directory is a legitimate member, so an
 *     interior hit (`internal/fs/fs.go`) must still match. Callers for
 *     Go-shaped importers (and the default, permissive value) pass `false`.
 *   `maxLeadingSegments` is never applied to a multi-segment pattern in
 *   either case: it already carries its own internal structure (e.g.
 *   `rack/protection`'s own slash), so it needs no additional "how deep is
 *   the importer nested" scrutiny.
 *
 * Used only for `matchesFile`'s strategies 1/2, which compare the raw
 * import/target strings as given. A cleaned `./`/`../` relative import
 * (strategy 3, below) is deliberately exempt: its leading relative marker is
 * already proof the specifier names a real project file rather than an
 * ambiguous external package/module/framework, so it doesn't need this extra
 * scrutiny -- and unlike a bare package name, it carries no information about
 * how deep the importer's own directory happens to be nested.
 */
function matchesAtBoundaryPrecise(
  str: string,
  pattern: string,
  maxLeadingSegments: number,
  requireExactTailForMultiSegment: boolean,
): boolean {
  const index = str.indexOf(pattern);
  if (index === -1) return false;

  const charBefore = index > 0 ? str[index - 1] : '/';
  if (charBefore !== '/' && index !== 0) return false;

  const endIndex = index + pattern.length;
  const atEnd = endIndex === str.length;
  if (!atEnd && str[endIndex] !== '/') return false;

  if (!pattern.includes('/')) {
    return matchesSingleSegmentTail(str, index, atEnd, maxLeadingSegments);
  }
  // Multi-segment: an interior hit (`!atEnd`, e.g. a "child file" under the
  // pattern's own directory) is only rejected for single-file-import
  // languages (Ruby) -- see the doc comment above and
  // `requireExactTailForMultiSegment`'s callers.
  return atEnd || !requireExactTailForMultiSegment;
}

/**
 * Single-segment-only tail of `matchesAtBoundaryPrecise`: the match must
 * reach the end of `str`, and at most `maxLeadingSegments` directory
 * segments may precede it. Split out to keep the parent function's
 * cognitive complexity down.
 */
function matchesSingleSegmentTail(
  str: string,
  index: number,
  atEnd: boolean,
  maxLeadingSegments: number,
): boolean {
  if (!atEnd) return false;
  const prefix = str.substring(0, index);
  const prefixSlashes = (prefix.match(/\//g) || []).length;
  return prefixSlashes <= maxLeadingSegments;
}

/**
 * The four per-importer-file language decisions `importMatchesTarget` needs,
 * resolved together. Each is a pure function of the importer's file extension
 * and the static language registry, so the whole record can be memoized per
 * file path (see `importerLanguageSemantics`).
 */
interface ImporterLanguageSemantics {
  /** #884 — `LanguageDefinition.wholeModuleImports` (Swift). */
  wholeModuleImports: boolean;
  /** #887 — `LanguageDefinition.singleFileImports` (Ruby). */
  singleFileImports: boolean;
  /** #929 — Python's dotted-module semantics (`matchesFile` strategy 5). */
  pythonModules: boolean;
  /** #1028 — `LanguageDefinition.namespaceStyleImports` (PHP). */
  namespaceStyleImports: boolean;
}

/** The answer for any path whose extension no registered language claims. */
const NON_AST_SEMANTICS: ImporterLanguageSemantics = {
  wholeModuleImports: false,
  singleFileImports: false,
  pythonModules: false,
  namespaceStyleImports: false,
};

/**
 * Memoized `importerFile` -> language semantics, and why this cache is
 * load-bearing rather than a micro-optimization (#1075).
 *
 * `importMatchesTarget` needs four language decisions about the importing
 * file, and every one of them starts with `detectLanguage(importerFile)` --
 * i.e. `node:path`'s `extname` plus a `slice`/`toLowerCase`/`Map.get` -- for
 * the SAME path string, four times per (import, target) pair. A single
 * `findDependents` call on a large corpus asks that question millions of
 * times over a set of paths bounded by the corpus size, so the derivation
 * was measured (CPU profile, OrchardCore, 6,356 files) at 42% of the call's
 * entire wall time: `detectLanguage` 32.5% self, `extname` alone 10.2%.
 *
 * Correctness is not at stake: `detectLanguage` and the three
 * `LanguageDefinition` flag getters read a registry that is frozen at module
 * load (`registry.ts` builds `extensionMap` once and throws on duplicates),
 * so the record is a pure function of the path string. Memoizing it can only
 * change how long the identical answer takes to produce.
 *
 * Bounded by an outright `clear()` at `MAX_IMPORTER_SEMANTICS_CACHE` rather
 * than an LRU: `lien serve` is long-lived and the key space is "every path
 * string ever passed in," so an unbounded map is a slow leak. A flat clear
 * keeps the eviction O(1) with no per-hit bookkeeping, and the only cost of
 * dropping the whole cache is re-deriving entries that are individually
 * cheap -- there is no correctness cliff at the boundary, unlike an LRU whose
 * value is in retaining the hot set.
 */
const MAX_IMPORTER_SEMANTICS_CACHE = 20_000;
const importerSemanticsCache = new Map<string, ImporterLanguageSemantics>();

function importerLanguageSemantics(importerFile: string): ImporterLanguageSemantics {
  const cached = importerSemanticsCache.get(importerFile);
  if (cached !== undefined) return cached;

  const language = detectLanguage(importerFile);
  const semantics: ImporterLanguageSemantics =
    language === null
      ? NON_AST_SEMANTICS
      : {
          wholeModuleImports: hasWholeModuleImports(language),
          singleFileImports: hasSingleFileImports(language),
          pythonModules: language === 'python',
          namespaceStyleImports: hasNamespaceStyleImports(language),
        };

  if (importerSemanticsCache.size >= MAX_IMPORTER_SEMANTICS_CACHE) {
    importerSemanticsCache.clear();
  }
  importerSemanticsCache.set(importerFile, semantics);
  return semantics;
}

/**
 * Drop the memoized importer-language records. Exported for tests that need
 * to prove a cold cache and a warm cache give the same answer; production
 * code never needs it (the registry the cache derives from is immutable).
 */
export function clearImporterSemanticsCache(): void {
  importerSemanticsCache.clear();
}

/**
 * True when `importSpecifier` is a bare (slash-free) import from a file whose
 * language sets `LanguageDefinition.wholeModuleImports` (Swift today — see
 * `hasWholeModuleImports`'s doc comment for #869's structural background).
 *
 * `matchesFile` is deliberately language-agnostic: it only ever sees raw
 * import/target strings, never a language tag. But for a whole-module-import
 * language, every extracted import IS the bare module name (`SwiftImport
 * Extractor` never emits a per-file specifier), so the *only* way such an
 * import can ever "win" a `matchesFile` comparison is through strategy 2's
 * one-leading-segment leniency (`auth` -> `src/auth.rs`) firing purely
 * because a target file's basename happens to coincide with the module's own
 * name (`Source/Alamofire.swift` vs. `import Alamofire`) -- the exact #884
 * false-hub shape, one leading segment inside the window #868/#883
 * deliberately preserve for the legitimate Rust-style convention.
 *
 * Match-side callers (does this import resolve to this target?) should go
 * through `importMatchesTarget` below, which applies this guard before
 * calling `matchesFile` so the two can never drift apart (#886). Build-side
 * callers with no target in scope (`buildImportIndex`,
 * `indexImportEntry`/`addChunkToImportIndex`) have nothing for
 * `importMatchesTarget` to compare against, so they keep calling this
 * predicate directly to decide whether an (import, chunk) pair is worth
 * indexing at all -- the honest outcome when it's true is #869's "not
 * determinable" signal, never a match. This is intentionally the only place
 * that combines path-matching with language data; `matchesAtBoundaryPrecise`'s
 * general guard stays untouched and keeps serving every non-whole-module
 * language (Rust, Go, Ruby, ...) exactly as before.
 *
 * @param importSpecifier - The raw (pre-normalization) import specifier
 * @param importerFile - File path of the chunk doing the importing
 */
export function isUnresolvableWholeModuleImport(
  importSpecifier: string,
  importerFile: string,
): boolean {
  if (importSpecifier.includes('/')) return false;
  return importerLanguageSemantics(importerFile).wholeModuleImports;
}

/**
 * Determines if an import path matches a target file path.
 *
 * Handles various matching strategies:
 * 1. Exact match
 * 2. Target path appears in import (at boundaries)
 * 3. Import path appears in target (at boundaries)
 * 4. Relative imports (./logger vs src/utils/logger)
 * 5. PHP namespace imports (App\Models\User vs app/Models/User.php)
 * 6. Python module imports (django.http → django/http/__init__.py or django/http/*.py)
 *
 * `matchesFile` itself stays language-agnostic (see `isUnresolvableWholeModuleImport`'s
 * doc comment) — it never inspects `importerFile` or detects a language. But
 * strategies 1/2's multi-segment boundary check has one genuine language-
 * dependent fork (#887): does a bare multi-segment specifier name a single
 * file (Ruby) or a package directory whose files are all members (Go)? A
 * language-agnostic caller can't know, so it's threaded in as an explicit
 * parameter rather than decided here — see `requireExactTailForMultiSegment`
 * and `importMatchesTarget`, the only caller that derives it from the
 * importer's language. Every other caller passes the default (`false`,
 * permissive/Go-safe), preserving this function's pre-#887 behavior exactly.
 *
 * Strategy 5 has its own, narrower language fork (#929): `matchesPythonModule`'s
 * bare-specifier branch treats a resolved single-segment specifier as a
 * Python package import, matching every file nested anywhere underneath it
 * (`matchesParentPythonPackage`'s unbounded `startsWith`, no depth cap at
 * all -- unlike every other strategy here, which anchors both edges of the
 * match). That is a real Python semantic, but `matchesFile` used to run it
 * unconditionally for every language, and a resolved bare specifier can
 * coincidentally look exactly like a Python identifier in any language --
 * confirmed on a real TypeScript repo (hono), where a test's own package-root
 * barrel import (`import { Hono } from '../..'`, resolved to the bare
 * specifier `src`) satisfied `matchesParentPythonPackage('src', 'src/utils/
 * jwt/jws')` for every single file under `src/`, fabricating "this test
 * covers everything" for a bare barrel import with no real relationship to
 * the target. See `allowPythonModuleMatching` and `importMatchesTarget`,
 * the only caller that derives it from the importer's language. Every other
 * caller passes the default (`true`), preserving this function's pre-#929
 * behavior exactly -- this is deliberately scoped to `importMatchesTarget`'s
 * match-side callers, mirroring #887's precedent, not to `matchesFile`'s
 * remaining direct callers (existing Python fixtures, `buildReExportGraph`'s
 * self-skip check -- see `importMatchesTarget`'s doc comment for why
 * `findDependentChunks`'s fuzzy loop no longer belongs on this list as of
 * #994 Phase 3).
 *
 * Strategy 4 has the identical per-language shape (#1028): `matchesPHPNamespace`
 * is a real semantic for PHP's case-insensitive, directory-mirroring PSR-4
 * namespaces, but `matchesFile` used to run it unconditionally for every
 * language too. Its bare-single-component branch's case-insensitivity (added
 * by #883 for an unrelated Swift fix) let a Rust bare `use crate::{Error}`
 * specifier (the import extractor's "first wins" grouped-use handling)
 * case-insensitively self-match `src/error.rs` on a real `dtolnay/anyhow`
 * clone -- confirmed for three files (`chain.rs`/`context.rs`/`error.rs`),
 * each via a self-referential bare `use crate::<OwnType>;` (grouped or not --
 * only `chain.rs`'s is `pub(crate)` and ungrouped; `error.rs`/`context.rs`
 * are plain grouped `use crate::{...}`) naming its own type. See
 * `allowNamespaceMatching` and `importMatchesTarget`, the only
 * caller that derives it from the importer's language via
 * `hasNamespaceMatchingSemantics`. Every other caller passes the default
 * (`true`), preserving this function's pre-#1028 behavior exactly, mirroring
 * `allowPythonModuleMatching`'s own scoping precedent immediately above.
 *
 * @param normalizedImport - Normalized import path
 * @param normalizedTarget - Normalized target file path
 * @param requireExactTailForMultiSegment - When true, a multi-segment bare
 *   pattern must reach the end of the compared string (Ruby's single-file
 *   `require` semantics); when false (the default), a multi-segment bare
 *   pattern may also match a "child" continuing past it (Go's package-
 *   directory semantics, and the safe default for every other language).
 * @param allowPythonModuleMatching - When false, Strategy 5 (Python module
 *   matching) is skipped entirely. Defaults to `true` (this function's
 *   pre-#929 behavior); `importMatchesTarget` passes `false` for any
 *   non-Python importer -- see the doc comment above.
 * @param allowNamespaceMatching - When false, Strategy 4 (PHP namespace
 *   matching) is skipped entirely. Defaults to `true` (this function's
 *   pre-#1028 behavior); `importMatchesTarget` passes `false` for any
 *   importer whose language doesn't set `namespaceStyleImports` -- see the
 *   doc comment above.
 * @returns True if the import matches the target file
 */
export function matchesFile(
  normalizedImport: string,
  normalizedTarget: string,
  requireExactTailForMultiSegment = false,
  allowPythonModuleMatching = true,
  allowNamespaceMatching = true,
): boolean {
  // Exact match
  if (normalizedImport === normalizedTarget) return true;

  // Strategy 1: Check if target path appears in import at path boundaries.
  // maxLeadingSegments: 0 -- see matchesAtBoundaryPrecise's doc comment.
  // `pattern` here is the TARGET (a concrete file reference), never a raw
  // import specifier -- the "does a bare multi-segment specifier name a
  // file or a directory" question `requireExactTailForMultiSegment` answers
  // doesn't apply to this position, so this call always passes `false`
  // regardless of the caller's language, matching this strategy's
  // pre-#887 behavior unconditionally.
  if (matchesAtBoundaryPrecise(normalizedImport, normalizedTarget, 0, false)) {
    return true;
  }

  // Strategy 2: Check if import path appears in target (for longer target paths).
  // maxLeadingSegments: 1 -- see matchesAtBoundaryPrecise's doc comment.
  if (
    matchesAtBoundaryPrecise(normalizedTarget, normalizedImport, 1, requireExactTailForMultiSegment)
  ) {
    return true;
  }

  // Strategy 3: Handle relative imports (./logger vs src/utils/logger)
  // Remove leading ./ and ../ from import. Only meaningful -- and only uses
  // the unrestricted matchesAtBoundary -- when a leading relative marker was
  // actually stripped; that marker is what proves the specifier names a real
  // project file rather than an ambiguous external package/module/framework
  // (see matchesAtBoundaryPrecise's doc comment). Without one, cleanedImport
  // is identical to normalizedImport, and strategies 1/2 above already tried
  // (and rejected) that exact pair with the appropriate scrutiny -- rerunning
  // it here with the looser matcher would silently undo that guard.
  const cleanedImport = normalizedImport.replace(/^(\.\.?\/)+/, '');
  if (cleanedImport !== normalizedImport) {
    if (
      matchesAtBoundary(cleanedImport, normalizedTarget) ||
      matchesAtBoundary(normalizedTarget, cleanedImport)
    ) {
      return true;
    }
  }

  // Strategy 4: PHP namespace matching
  // PHP imports use namespaces like "App\Models\User" which should match "app/Models/User.php"
  if (allowNamespaceMatching && matchesPHPNamespace(normalizedImport, normalizedTarget)) {
    return true;
  }

  // Strategy 5: Python module matching
  // Python imports use dotted paths like "django.http" which should match "django/http/response.py"
  if (allowPythonModuleMatching && matchesPythonModule(normalizedImport, normalizedTarget)) {
    return true;
  }

  return false;
}

/**
 * Rust exact-single-file resolution semantics: the specifier names EXACTLY
 * one of two files -- itself (exact match) or `<specifier>/mod.rs` (the sole
 * directory-module alternative Rust's file-to-module convention allows) --
 * never a grandchild, an unrelated sibling, or (for the #1021 `mod x;`
 * producer specifically) the declaring file itself. Two producers currently
 * mark a specifier for this treatment -- see `rust-mod-marker.ts`'s doc
 * comment: a `mod x;` declaration (#1021, `rustModOwningDirectory` in
 * `../ast/languages/rust.ts`) and a bare crate-root import resolved via
 * crate-root export lookup (#1056, `resolveRustCrateRootExport` in
 * `../rust-crate-exports.ts`).
 *
 * Deliberately bypasses every `matchesFile` strategy: those exist to resolve
 * AMBIGUOUS bare/relative specifiers, but a marked specifier is already a
 * fully resolved, single-file path with no remaining ambiguity for a
 * boundary-matching heuristic to add. That's exactly what let `matchesFile`
 * fabricate edges to any file continuing past the specifier -- Go
 * package-directory semantics wrongly applied to a Rust `mod` (#1021), in
 * BOTH directions: Strategy 2's `requireExactTailForMultiSegment` leniency
 * let `src/thing` (from `mod thing;`) match every file under `src/thing/`,
 * not just `src/thing/mod.rs`; and Strategy 1 -- hardcoded to the same
 * leniency regardless of caller/language, since its `pattern` position is
 * normally a concrete target file, never a package name -- let a LEAF
 * file's own `mod helpers;` specifier (`src/engine/helpers`, longer than
 * the file's own path) match back against `src/engine` itself, fabricating
 * a self-edge. The #1056 producer guards against the same class of bug for
 * a bare crate-root import (`use crate_name::Symbol;`): resolving it to the
 * crate's bare directory (rather than the one file that actually declares
 * `Symbol`) let it match every file the crate contains.
 *
 * Only called for specifiers carrying the marker (see `rust-mod-marker.ts`)
 * -- i.e. never for `use crate::...`/`self::`/`super::` specifiers, which
 * keep resolving through `matchesFile` exactly as before.
 */
function matchesRustModSpecifier(normalizedImport: string, normalizedTarget: string): boolean {
  return normalizedImport === normalizedTarget || normalizedTarget === `${normalizedImport}/mod`;
}

/**
 * The single guarded import-matching decision: does `importSpecifier` (as
 * written in `importerFile`) resolve to `normalizedTarget`?
 *
 * Couples five guards to `matchesFile` so neither can drift apart from a
 * match-side call site again:
 * - The #884 whole-module guard (`isUnresolvableWholeModuleImport`) --
 *   `matchesFile` is language-agnostic and cannot know the importer's
 *   language, so this MUST run on the RAW specifier first. Spelled inline
 *   here as `semantics.wholeModuleImports && !importSpecifier.includes('/')`
 *   rather than as a call to that predicate, purely so the shared
 *   `importerLanguageSemantics` lookup is done once for all four guards
 *   (#1075); the two conjuncts are both pure, so testing the language flag
 *   before the slash is the same decision in the other order, and
 *   `isUnresolvableWholeModuleImport` remains the single definition every
 *   OTHER call site (`buildImportIndex`, `indexImportEntry`,
 *   `test-associations.ts`, `get-files-context.ts`) uses.
 * - The #887 single-file-vs-package-directory distinction
 *   (`requireExactTailForMultiSegment`) -- derived from the importer's
 *   language via `hasSingleFileImports`, since that's the only information
 *   that can disambiguate a bare multi-segment specifier like `rack/protection`
 *   (Ruby: names one file) from `internal/fs` (Go: names a package directory
 *   whose files are all members). This is the ONE call site with both an
 *   importer file *and* a target to compare against, so it's the only place
 *   this derivation happens.
 * - The #929 Python-bare-module guard (`allowPythonModuleMatching`) --
 *   `matchesFile`'s Strategy 5 is a real Python semantic, but a false hub for
 *   any other language whose resolved bare specifier coincidentally matches
 *   a Python identifier shape (see `matchesFile`'s doc comment for the real
 *   hono/TypeScript repro). Derived from the importer's language the same
 *   way as the #887 guard, at this same call site.
 * - The #1028 PHP-namespace guard (`allowNamespaceMatching`) --
 *   `matchesFile`'s Strategy 4 is a real PHP PSR-4 semantic, but a false hub
 *   for any other language whose resolved bare/qualified specifier
 *   case-insensitively coincides with a target's basename (see `matchesFile`'s
 *   doc comment for the real `dtolnay/anyhow` Rust self-edge repro). Derived
 *   from the importer's language via `hasNamespaceMatchingSemantics`, the
 *   same way as the #887/#929 guards, at this same call site.
 * - The #1021/#1056 Rust exact-single-file guard (`hasRustModMarker`) --
 *   unlike the other four, this is derived from the SPECIFIER, not the
 *   importer's language: a single Rust file can have both a `mod x;` or a
 *   bare crate-root import (each needing `matchesRustModSpecifier`'s strict
 *   semantics) and a `use crate::y;` (needing `matchesFile`'s existing
 *   leniency) among its own imports, so a per-language flag can't
 *   disambiguate between two entries in the same file's import list the way
 *   it can for #887/#929/#1028. When present, this guard short-circuits
 *   entirely -- `matchesFile` never runs at all for a marked specifier.
 *
 * Every match-side reverse-dependency call path that used to open-code
 * `!isUnresolvableWholeModuleImport(imp, f) && matchesFile(normalize(imp), t)`
 * now goes through here instead (#886). Three call paths in
 * `dependency-analyzer.ts` used to be the exception, and are no longer (#994
 * Phase 3):
 *
 * - The two build-side sites that index imports with no target in scope
 *   (`buildImportIndex`, `indexImportEntry`/`addChunkToImportIndex`) still
 *   call `isUnresolvableWholeModuleImport` directly at build time (that part
 *   hasn't changed -- it's an early-drop optimization, and there's still no
 *   target to compare against yet). What changed is what they store: each
 *   index entry now keeps the raw (pre-normalization) specifier alongside its
 *   chunk (`ImportIndexEntry`), instead of discarding it once the bucket key
 *   is computed.
 * - `findDependentChunks`'s fuzzy loop (`addFuzzyMatchChunks`) used to have
 *   nothing but a normalized specifier and a bare chunk list to work with, so
 *   it reconstructed the #887/#929 guards itself via two extra `matchesFile`
 *   calls per bucket. With `rawSpecifier` preserved on every entry, it now
 *   calls `importMatchesTarget` directly, per entry -- the same primitive,
 *   the same guards, no reconstruction.
 *
 * `buildReExportGraph` is unchanged and still not routed through here, for a
 * different reason than the other three: it never reads the import index at
 * all. Its own re-export detection (`fileIsReExporter` ->
 * `findReExportedSymbolsForFile` -> `collectImportedSymbolsFromSource`)
 * already calls `importMatchesTarget` (that was already true before #994).
 * The one raw `matchesFile` call left in `buildReExportGraph` itself is a
 * same-normalizer FILE-vs-FILE identity check (skip the target file when
 * scanning candidates), not an import-vs-file match -- there is no
 * `importSpecifier` in that comparison for this primitive to guard, so it
 * was never a candidate for routing through it in the first place.
 *
 * @param importSpecifier - The raw (pre-normalization) import specifier, or
 *   an `importedSymbols` key (same shape).
 * @param importerFile - File path of the chunk doing the importing (needed
 *   for all three guards' language detection).
 * @param normalizedTarget - The already-normalized target path to compare
 *   against.
 * @param normalize - The caller's own cached `normalizePath` wrapper.
 */
export function importMatchesTarget(
  importSpecifier: string,
  importerFile: string,
  normalizedTarget: string,
  normalize: (p: string) => string,
): boolean {
  // One memoized lookup for all four language decisions, rather than the four
  // separate `detectLanguage` derivations the individual predicates below each
  // do -- see `importerLanguageSemantics` for why that mattered (#1075).
  const semantics = importerLanguageSemantics(importerFile);
  if (semantics.wholeModuleImports && !importSpecifier.includes('/')) return false;
  if (hasRustModMarker(importSpecifier)) {
    return matchesRustModSpecifier(
      normalize(stripRustModMarker(importSpecifier)),
      normalizedTarget,
    );
  }
  return matchesFile(
    normalize(importSpecifier),
    normalizedTarget,
    semantics.singleFileImports,
    semantics.pythonModules,
    semantics.namespaceStyleImports,
  );
}

/**
 * True when `importerFile`'s language sets `LanguageDefinition.singleFileImports`
 * (Ruby today) -- see that flag's doc comment for the Ruby-vs-Go distinction
 * this drives. Until #994 Phase 3, this was also called directly by
 * `findDependentChunks`'s own per-chunk #887 reconstruction (see git history
 * on `addFuzzyMatchChunks`), specifically so the two computations couldn't
 * drift apart. `findDependentChunks` now routes through `importMatchesTarget`
 * like every other match-side call site, so `importMatchesTarget` is this
 * function's only caller -- there is no longer a second computation to keep
 * in sync with.
 */
export function hasSingleFileImportSemantics(importerFile: string): boolean {
  return importerLanguageSemantics(importerFile).singleFileImports;
}

/**
 * True when `importerFile`'s language is Python -- the only language
 * `matchesFile`'s Strategy 5 (`matchesPythonModule`) is a confirmed real
 * semantic for (#929). Unlike `hasSingleFileImportSemantics` above, this
 * isn't backed by a `LanguageDefinition` flag: `matchesPythonModule` is
 * Python-specific by construction (dotted-module parsing, `__init__.py`
 * handling), not a generic per-language toggle other languages could
 * legitimately opt into, so a direct language-identity check is the honest
 * representation. Shared by `importMatchesTarget`'s `allowPythonModuleMatching`
 * argument -- see `matchesFile`'s doc comment for the false-hub this guards
 * against.
 */
export function hasPythonModuleSemantics(importerFile: string): boolean {
  return importerLanguageSemantics(importerFile).pythonModules;
}

/**
 * True when `importerFile`'s language sets `LanguageDefinition.namespaceStyleImports`
 * (PHP today) -- see that flag's doc comment for the case-insensitive
 * PSR-4-vs-Rust distinction this drives (#1028). Unlike `hasPythonModuleSemantics`
 * above, this IS backed by a `LanguageDefinition` flag, mirroring
 * `hasSingleFileImportSemantics`: `matchesPHPNamespace`'s case-insensitive,
 * directory-mirroring semantic is a genuine per-language toggle another
 * language's own namespace convention could legitimately opt into later,
 * unlike Python's dotted-module parsing. Shared by `importMatchesTarget`'s
 * `allowNamespaceMatching` argument -- see `matchesFile`'s doc comment for
 * the false-hub (a Rust bare `use crate::{Error}` self-matching
 * `src/error.rs`) this guards against.
 */
export function hasNamespaceMatchingSemantics(importerFile: string): boolean {
  return importerLanguageSemantics(importerFile).namespaceStyleImports;
}

/**
 * Check if target exactly matches the module path (handles __init__.py)
 */
function matchesDirectPythonModule(moduleAsPath: string, targetWithoutPy: string): boolean {
  return (
    targetWithoutPy === moduleAsPath ||
    targetWithoutPy === moduleAsPath + '/__init__' ||
    targetWithoutPy.replace(/\/__init__$/, '') === moduleAsPath
  );
}

/**
 * Check if target is a child of the module package
 */
function matchesParentPythonPackage(moduleAsPath: string, targetWithoutPy: string): boolean {
  return targetWithoutPy.startsWith(moduleAsPath + '/');
}

/**
 * Check if module path appears as a suffix in the target path
 */
function matchesSuffixPythonModule(moduleAsPath: string, targetWithoutPy: string): boolean {
  return (
    targetWithoutPy.endsWith('/' + moduleAsPath) ||
    targetWithoutPy.endsWith('/' + moduleAsPath + '/__init__')
  );
}

/**
 * Check if module appears after a single source directory prefix
 *
 * Anchors BOTH edges of the candidate, mirroring `matchesAtBoundaryPrecise`'s
 * discipline:
 * - Left (pre-existing): at most one leading directory segment, at a `/`
 *   boundary.
 * - Right (#918): `indexOf` only guarantees `moduleAsPath` occurs somewhere
 *   in `targetWithoutPy`, never that it ends there. Without a right-edge
 *   check, a candidate like `com/example/Utils` matches as a bare textual
 *   prefix of an unrelated sibling `com/example/UtilsHelper` -- the same
 *   class of bug #868/#883 fixed on the left edge, just on the right. The
 *   candidate must now reach the end of the string, a path separator, or an
 *   extension boundary (`.`) -- the last of these is defense-in-depth for
 *   any caller that reaches this function before `normalizePath`'s generic
 *   extension strip has run; every current call path already strips
 *   extensions upstream.
 */
function matchesWithSourcePrefix(moduleAsPath: string, targetWithoutPy: string): boolean {
  const moduleIndex = targetWithoutPy.indexOf(moduleAsPath);
  if (moduleIndex < 0) return false;

  const prefix = targetWithoutPy.substring(0, moduleIndex);
  const prefixSlashes = (prefix.match(/\//g) || []).length;

  // Prefix should be empty or a single directory (e.g., "src/")
  // The check for prefix === '' || prefix.endsWith('/') ensures we're at a directory boundary:
  // - If prefix is empty, moduleIndex is 0 (start of string)
  // - If prefix ends with '/', then it's a valid directory separator
  if (prefixSlashes > 1 || (prefix !== '' && !prefix.endsWith('/'))) return false;

  const endIndex = moduleIndex + moduleAsPath.length;
  if (endIndex === targetWithoutPy.length) return true;
  const charAfter = targetWithoutPy[endIndex];
  return charAfter === '/' || charAfter === '.';
}

/**
 * Checks if a Python dotted (or bare, #901) module path matches a file path.
 *
 * Python imports use dotted paths like "django.http" which should match:
 * - django/http/__init__.py (package)
 * - django/http/response.py (module within package)
 * - django/http.py (direct module, less common)
 *
 * A bare, dot-free specifier (`import flask`) matches the same way against
 * its package's own `__init__.py` and children (`flask/__init__.py`,
 * `flask/app.py`, ...) — see #901. A src-layout project's `src/` root is
 * resolved separately, upstream, before this function ever runs (see
 * `../python-src-layout.ts`); this function only ever sees the already-
 * resolved specifier.
 *
 * @param importPath - The import path (may contain dots, or be a bare word)
 * @param targetPath - The normalized file path
 * @returns True if the Python module matches the file path
 */
function matchesPythonModule(importPath: string, targetPath: string): boolean {
  // Only apply to Python-style module identifiers: a bare word (django) or a
  // dotted path (django.http.response). Excludes file paths (contain /) and
  // relative imports (start with .) -- both are resolved to real paths
  // upstream (see `resolveRelativeImport`/`resolvePythonSrcLayoutImport`)
  // before reaching here, so they never need this dotted-specific matcher.
  if (!/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(importPath)) {
    return false;
  }

  // Convert dotted path to slash path: django.http → django/http
  const moduleAsPath = importPath.replace(/\./g, '/');

  // Strip .py extension from target for comparison
  const targetWithoutPy = targetPath.replace(/\.py$/, '');

  if (!importPath.includes('.')) {
    // Bare (single-segment) specifier: only the two position-anchored
    // strategies apply. The other two are each risky in their own way for a
    // short bare word: `matchesSuffixPythonModule` is properly boundary-
    // checked (its `endsWith('/' + moduleAsPath)` requires a leading `/` and
    // anchors to the end of the string) but places NO cap on how many
    // directories may precede that match, so "flask" could match a
    // same-named package nested arbitrarily deep elsewhere in the repo.
    // `matchesWithSourcePrefix` caps the leading side (at most one directory)
    // and, since #918, anchors the right edge too (end-of-string, `/`, or an
    // extension boundary) -- so the "flask" spuriously-matching-"flaskext"
    // textual-prefix hazard this comment used to describe no longer applies
    // to it. It still stays out of this branch: `matchesSuffixPythonModule`
    // alone is reason enough (no left-side cap at all, so a bare word could
    // match a same-named package nested arbitrarily deep), and #883's
    // precedent is to not widen leniency for a short bare identifier without
    // a confirmed real-world case. Both non-anchored strategies are safe for
    // a multi-segment dotted path (low collision odds) but excluded here.
    // Mirrors the established precedent of scoping extra leniency away from
    // bare identifiers (see `matchesAtBoundaryPrecise`'s `maxLeadingSegments`
    // and `matchesPHPNamespace`'s bare-importPath guard, both above) -- do
    // not widen this without a confirmed real-world bare-package case, per
    // #883.
    return (
      matchesDirectPythonModule(moduleAsPath, targetWithoutPy) ||
      matchesParentPythonPackage(moduleAsPath, targetWithoutPy)
    );
  }

  // Try matching strategies in order of specificity
  return (
    matchesDirectPythonModule(moduleAsPath, targetWithoutPy) ||
    matchesParentPythonPackage(moduleAsPath, targetWithoutPy) ||
    matchesSuffixPythonModule(moduleAsPath, targetWithoutPy) ||
    matchesWithSourcePrefix(moduleAsPath, targetWithoutPy)
  );
}

/**
 * Checks if paths match using case-insensitive component matching.
 *
 * This handles PHP namespace imports where:
 * - App/Models/User should match app/Models/User (case difference in first component)
 * - Domain/Services/Auth should match web/Domain/Services/Auth (prefix in target)
 *
 * Also useful for case-insensitive file systems.
 *
 * Only ever reached for a PHP importer as of #1028 (see `allowNamespaceMatching`
 * on `matchesFile` and `hasNamespaceMatchingSemantics`) -- this function's own
 * case-insensitivity is exactly what made it unsafe to run unconditionally for
 * every language: a Rust bare `use crate::{Error}` specifier case-insensitively
 * self-matched `src/error.rs` on a real `dtolnay/anyhow` clone, a false
 * positive Strategy 2's equivalent (case-SENSITIVE) one-leading-segment
 * leniency never produces.
 *
 * A single-component (bare) importPath is the same ambiguous case
 * `matchesAtBoundaryPrecise` (above) guards for `matchesFile`'s strategies
 * 1/2: on its own it doesn't name a specific file, so matching it against the
 * tail of an arbitrarily deep targetPath needs the same "at most one leading
 * directory" limit -- otherwise a bare `import Combine` (system framework)
 * would match `Source/Features/Combine.swift` purely because the basenames
 * coincide, exactly like the multi-segment case this function otherwise
 * guards against. (That specific Swift shape is now additionally excluded
 * by the #1028 gate above, since Swift doesn't set `namespaceStyleImports`
 * either -- but the guard stays, since this function is still reachable
 * directly by `matchesFile`'s other callers, which default
 * `allowNamespaceMatching` to `true`.)
 *
 * @param importPath - The normalized import path
 * @param targetPath - The normalized file path
 * @returns True if paths match case-insensitively at component boundaries
 */
function matchesPHPNamespace(importPath: string, targetPath: string): boolean {
  // Split into path components
  const importComponents = importPath.split('/').filter(Boolean);
  const targetComponents = targetPath.split('/').filter(Boolean);

  // Need at least one component to match
  if (importComponents.length === 0 || targetComponents.length === 0) {
    return false;
  }

  // Match from the end, case-insensitively
  // This handles prefixes like "web/app" matching "App"
  let matched = 0;
  for (let i = 1; i <= importComponents.length && i <= targetComponents.length; i++) {
    const impComp = importComponents[importComponents.length - i].toLowerCase();
    const targetComp = targetComponents[targetComponents.length - i].toLowerCase();

    if (impComp === targetComp) {
      matched++;
    } else {
      break;
    }
  }

  // All import components must match (from the end).
  // This ensures App/Models/User matches web/app/Models/User but not app/Services/User.
  if (matched !== importComponents.length) return false;

  // A bare (single-component) import additionally needs the same "at most
  // one leading directory" evidence as matchesAtBoundaryPrecise's
  // bare-identifier guard -- see the doc comment above.
  return importComponents.length > 1 || targetComponents.length <= 2;
}

/**
 * Matches a relative import specifier: `./x`, `../x`, or the bare, slash-free
 * `.`/`..` themselves (anchored so a longer dotted specifier like `.module`
 * or `..pkg.thing` — an un-converted Python absolute-looking import, #904's
 * doc comment below — never qualifies).
 */
const RELATIVE_IMPORT_PATTERN = /^\.\.?(\/|$)/;

/**
 * Resolve a relative import specifier against its importer's file path.
 *
 * Acts on specifiers matching `RELATIVE_IMPORT_PATTERN`: `./`/`../`-prefixed,
 * or the bare `.`/`..` themselves (#935) — Node/TS module resolution treats a
 * bare `.` as "this directory" and a bare `..` as "the parent directory"
 * exactly like their slash-suffixed forms (`import { x } from '.'` in a
 * same-directory barrel re-export test is the confirmed real-world shape: a
 * genuine self-import that used to be stored as the literal, never-matching
 * string `"."`). Package specifiers (e.g. `@liendev/core`, `lodash`), dotted
 * Python-style *absolute* imports, and absolute paths pass through unchanged.
 * Since #904, Python's leading-dot *relative* imports (`.foo`, `..pkg`) DO
 * reach this function too — `PythonImportExtractor` converts them to this
 * same `./`/`../`-prefixed shape at extraction time (see
 * `ast/languages/python.ts`'s `convertPythonRelativeImport`) before
 * `resolveImportSpecifier` calls this, so the bare-dot case added here never
 * actually fires for Python; it exists for languages (JS/TS today) whose
 * extractor stores the raw source literal as-is.
 *
 * Returns the resolved path in the same form as `importerFile` — relative when
 * `importerFile` is relative, absolute when absolute. Any trailing slash is
 * stripped: a bare `./`/`.` or `../`/`..` specifier (Python's `from . import X`
 * / `from .. import X`, converted with an empty remainder — see
 * `convertPythonRelativeImport` — or JS/TS's own bare `'.'`/`'..'`) resolves
 * to the importer's own directory (or its parent) with nothing joined after
 * it, and `path.posix.normalize`/`join` leave that directory's trailing slash
 * intact, which would otherwise never boundary-match a target path (those
 * never carry one). The caller's downstream normalization (`normalizePath`)
 * is what ultimately strips extensions and the workspace-root prefix, so no
 * other work is needed here.
 *
 * @param importerFile - File path of the chunk doing the importing
 * @param specifier - The raw import specifier from source code
 * @returns Resolved path for relative specifiers; the original string otherwise
 */
export function resolveRelativeImport(importerFile: string, specifier: string): string {
  if (!RELATIVE_IMPORT_PATTERN.test(specifier)) {
    return specifier;
  }
  const importerDir = path.posix.dirname(importerFile.replace(/\\/g, '/'));
  return path.posix.normalize(path.posix.join(importerDir, specifier)).replace(/\/+$/, '');
}

/**
 * Resolve a bare workspace package specifier (`@scope/pkg`, `pkg`) to that
 * package's workspace-relative source entry file, when `workspacePackages`
 * has an entry for it. See `resolveWorkspacePackageEntries` in
 * `../workspace-packages.ts` for how the map is built.
 *
 * Only exact bare-specifier matches resolve — deep imports into a package's
 * subpath (`@scope/pkg/subpath`) pass through unchanged (see that module's
 * doc comment for why this is the deliberate v1 scope). Specifiers with no
 * matching workspace package (external npm deps, or an empty/absent map for
 * non-monorepo projects) also pass through unchanged, so this is a no-op
 * everywhere it doesn't apply.
 *
 * @param specifier - The raw (or already relative-resolved) import specifier
 * @param workspacePackages - Map of package name -> workspace-relative entry file
 * @returns The resolved entry file path, or `specifier` unchanged
 */
export function resolveWorkspaceImport(
  specifier: string,
  workspacePackages: ReadonlyMap<string, string>,
): string {
  if (workspacePackages.size === 0) return specifier;
  return workspacePackages.get(specifier) ?? specifier;
}

/**
 * Gets a canonical path representation (relative to workspace, with extension).
 *
 * @param filepath - The file path to canonicalize
 * @param workspaceRoot - The workspace root directory (normalized with forward slashes)
 * @returns Canonical path
 */
export function getCanonicalPath(filepath: string, workspaceRoot: string): string {
  let canonical = filepath.replace(/\\/g, '/');
  if (canonical.startsWith(workspaceRoot + '/')) {
    canonical = canonical.substring(workspaceRoot.length + 1);
  }
  return canonical;
}

/**
 * Determines if a file is a test file based on naming conventions.
 *
 * Uses precise regex patterns to avoid false positives:
 * - Files with .test. or .spec. extensions (e.g., foo.test.ts, bar.spec.js)
 * - Files with _test. or _spec. suffixes (e.g., user_spec.rb, math_test.go)
 * - Files in test/, tests/, spec/, specs/, or __tests__/ directories
 *
 * Avoids false positives like:
 * - contest.ts (contains ".test." but isn't a test)
 * - latest/config.ts (contains "/test/" but isn't a test)
 * - mytest.ts (no `_` boundary before "test")
 *
 * The directory-segment check is case-insensitive (#925): a capitalized
 * `Tests/` directory is mainstream outside the JS/TS/Ruby/Go ecosystems that
 * motivated the original lowercase-only pattern -- symfony/console (and the
 * wider Symfony ecosystem) uses `Tests/` as its one and only test directory,
 * with no lowercase `tests/` anywhere in the repo, so a case-sensitive check
 * excluded literally every PHP test file in it from test-chunk scanning
 * before import-matching ever ran. This is safe to broaden for every
 * language: the check still requires an EXACT path segment (bounded by `/`
 * or the string start/end on both sides), so `Latest/`, `Contest/`, and
 * `Testing/` still correctly fail regardless of case -- only a segment that
 * IS exactly `test`/`tests`/`spec`/`specs`/`__tests__` (any casing) matches.
 *
 * Swift uses different conventions (XCTest `FooTests.swift` files and a
 * Swift Package Manager `Tests/` directory). Those checks are scoped to
 * `.swift` paths so behavior for other languages is unchanged.
 *
 * .NET/xUnit/NUnit/MSTest use a `Tests` suffix glued onto a longer
 * identifier rather than a delimited `test`/`spec` segment: project
 * directories like `UnitTests/`, `IntegrationTests/`, `AutoMapper.DI.Tests/`
 * and files like `ScopeTests.cs`, `ConfigurationFeatureTest.cs`. Those checks
 * are scoped to `.cs` paths and are case-sensitive (`Tests`/`Test`, capital
 * T) so `Latest.cs`/`Contest.cs` and a `latest/`-style directory are not
 * misclassified, and no other language's behavior moves.
 *
 * @param filepath - The file path to check
 * @returns True if the file is a test file
 */
export function isTestFile(filepath: string): boolean {
  return (
    /\.(test|spec)\.[^/]+$/.test(filepath) ||
    /_(test|spec)\.[^/]+$/.test(filepath) ||
    /(^|[/\\])(test|tests|spec|specs|__tests__)[/\\]/i.test(filepath) ||
    (/\.swift$/.test(filepath) &&
      (/Tests?\.swift$/.test(filepath) || /(^|[/\\])Tests?[/\\]/.test(filepath))) ||
    (/\.cs$/.test(filepath) &&
      (/Tests?\.cs$/.test(filepath) || /(^|[/\\])[^/\\]*Tests[/\\]/.test(filepath)))
  );
}

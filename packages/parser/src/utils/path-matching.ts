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
} from '../ast/languages/registry.js';

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
  let normalized = path.replace(/['"]/g, '').trim().replace(/\\/g, '/');

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
  const language = detectLanguage(importerFile);
  return language !== null && hasWholeModuleImports(language);
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
 * @param normalizedImport - Normalized import path
 * @param normalizedTarget - Normalized target file path
 * @param requireExactTailForMultiSegment - When true, a multi-segment bare
 *   pattern must reach the end of the compared string (Ruby's single-file
 *   `require` semantics); when false (the default), a multi-segment bare
 *   pattern may also match a "child" continuing past it (Go's package-
 *   directory semantics, and the safe default for every other language).
 * @returns True if the import matches the target file
 */
export function matchesFile(
  normalizedImport: string,
  normalizedTarget: string,
  requireExactTailForMultiSegment = false,
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
  if (matchesPHPNamespace(normalizedImport, normalizedTarget)) {
    return true;
  }

  // Strategy 5: Python module matching
  // Python imports use dotted paths like "django.http" which should match "django/http/response.py"
  if (matchesPythonModule(normalizedImport, normalizedTarget)) {
    return true;
  }

  return false;
}

/**
 * The single guarded import-matching decision: does `importSpecifier` (as
 * written in `importerFile`) resolve to `normalizedTarget`?
 *
 * Couples two guards to `matchesFile` so neither can drift apart from a
 * match-side call site again:
 * - The #884 whole-module guard (`isUnresolvableWholeModuleImport`) --
 *   `matchesFile` is language-agnostic and cannot know the importer's
 *   language, so this MUST run on the RAW specifier first.
 * - The #887 single-file-vs-package-directory distinction
 *   (`requireExactTailForMultiSegment`) -- derived from the importer's
 *   language via `hasSingleFileImports`, since that's the only information
 *   that can disambiguate a bare multi-segment specifier like `rack/protection`
 *   (Ruby: names one file) from `internal/fs` (Go: names a package directory
 *   whose files are all members). This is the ONE call site with both an
 *   importer file *and* a target to compare against, so it's the only place
 *   this derivation happens.
 *
 * Every match-side reverse-dependency call path that used to open-code
 * `!isUnresolvableWholeModuleImport(imp, f) && matchesFile(normalize(imp), t)`
 * now goes through here instead (#886); the two build-side sites that index
 * imports with no target in scope (`buildImportIndex`,
 * `indexImportEntry`/`addChunkToImportIndex`) still call
 * `isUnresolvableWholeModuleImport` directly, and `findDependentChunks`'s
 * fuzzy loop and `buildReExportGraph` stay on raw `matchesFile` -- see #886's
 * design comment for why those four are not routed through this primitive,
 * and `findDependentChunks`'s own doc comment for how it independently
 * derives the #887 distinction per-chunk (it has no single importer file).
 *
 * @param importSpecifier - The raw (pre-normalization) import specifier, or
 *   an `importedSymbols` key (same shape).
 * @param importerFile - File path of the chunk doing the importing (needed
 *   for both guards' language detection).
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
  if (isUnresolvableWholeModuleImport(importSpecifier, importerFile)) return false;
  return matchesFile(
    normalize(importSpecifier),
    normalizedTarget,
    hasSingleFileImportSemantics(importerFile),
  );
}

/**
 * True when `importerFile`'s language sets `LanguageDefinition.singleFileImports`
 * (Ruby today) -- see that flag's doc comment for the Ruby-vs-Go distinction
 * this drives. Shared by `importMatchesTarget` and `findDependentChunks`'s
 * per-chunk #887 check so the two can't compute it differently.
 */
export function hasSingleFileImportSemantics(importerFile: string): boolean {
  const language = detectLanguage(importerFile);
  return language !== null && hasSingleFileImports(language);
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
 * A single-component (bare) importPath is the same ambiguous case
 * `matchesAtBoundaryPrecise` (above) guards for `matchesFile`'s strategies
 * 1/2: on its own it doesn't name a specific file, so matching it against the
 * tail of an arbitrarily deep targetPath needs the same "at most one leading
 * directory" limit -- otherwise a bare `import Combine` (system framework)
 * would match `Source/Features/Combine.swift` purely because the basenames
 * coincide, exactly like the multi-segment case this function otherwise
 * guards against.
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
 * Resolve a relative import specifier against its importer's file path.
 *
 * Only acts on specifiers starting with `./` or `../`. Package specifiers
 * (e.g. `@liendev/core`, `lodash`), dotted Python-style *absolute* imports,
 * and absolute paths pass through unchanged. Since #904, Python's leading-dot
 * *relative* imports (`.foo`, `..pkg`) DO reach this function too —
 * `PythonImportExtractor` converts them to this same `./`/`../`-prefixed
 * shape at extraction time (see `ast/languages/python.ts`'s
 * `convertPythonRelativeImport`) before `resolveImportSpecifier` calls this.
 *
 * Returns the resolved path in the same form as `importerFile` — relative when
 * `importerFile` is relative, absolute when absolute. Any trailing slash is
 * stripped: a bare `./` or `../` specifier (Python's `from . import X` /
 * `from .. import X`, converted with an empty remainder — see
 * `convertPythonRelativeImport`) resolves to the importer's own directory
 * with nothing joined after it, and `path.posix.normalize`/`join` leave that
 * directory's trailing slash intact, which would otherwise never
 * boundary-match a target path (those never carry one). The caller's
 * downstream normalization (`normalizePath`) is what ultimately strips
 * extensions and the workspace-root prefix, so no other work is needed here.
 *
 * @param importerFile - File path of the chunk doing the importing
 * @param specifier - The raw import specifier from source code
 * @returns Resolved path for relative specifiers; the original string otherwise
 */
export function resolveRelativeImport(importerFile: string, specifier: string): string {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
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
    /(^|[/\\])(test|tests|spec|specs|__tests__)[/\\]/.test(filepath) ||
    (/\.swift$/.test(filepath) &&
      (/Tests?\.swift$/.test(filepath) || /(^|[/\\])Tests?[/\\]/.test(filepath))) ||
    (/\.cs$/.test(filepath) &&
      (/Tests?\.cs$/.test(filepath) || /(^|[/\\])[^/\\]*Tests[/\\]/.test(filepath)))
  );
}

/**
 * Portable test association discovery from in-memory chunks.
 * Finds test files that import given source files by analyzing chunk metadata.
 */

import {
  isTestFile,
  normalizePath,
  importMatchesTarget,
  isUnresolvableWholeModuleImport,
  getCanonicalPath,
} from './utils/path-matching.js';
import {
  detectLanguage,
  hasSameDirectoryTestConvention,
  hasSamePackageTestConvention,
  hasEnclosingNamespaceAccess,
} from './ast/languages/registry.js';
import {
  buildGoTestDirIndex,
  pairGoBasenameTest,
  type GoTestCandidate,
  type GoTestDirIndex,
} from './go-same-directory-tests.js';
import {
  toJavaTestCandidate,
  buildJavaTestDirIndex,
  pairJavaBasenameTest,
  type JavaTestCandidate,
  type JavaTestDirIndex,
} from './java-same-package-tests.js';
import {
  buildCSharpTypeReferenceIndex,
  resolveCSharpTypeReferenceDependents,
  type CSharpTypeReferenceIndex,
} from './csharp-type-reference-signals.js';
import {
  buildJvmSamePackageIndex,
  resolveJvmSamePackageDependents,
  type JvmSamePackageIndex,
} from './jvm-same-package-signals.js';
import type { CodeChunk } from './types.js';

/**
 * True when `filepath`'s language sets `sameDirectoryTestConvention` (Go
 * today, #902) -- the per-file convenience wrapper `pairGoBasenameTest`'s
 * callers need, mirroring `isUnresolvableWholeModuleImport`'s
 * `detectLanguage` + registry-predicate shape in path-matching.ts.
 */
function hasGoSameDirectoryConvention(filepath: string): boolean {
  const language = detectLanguage(filepath);
  return language !== null && hasSameDirectoryTestConvention(language);
}

/**
 * True when `filepath`'s language sets `samePackageTestConvention` (Java
 * today, #925) -- mirrors `hasGoSameDirectoryConvention` immediately above.
 */
function hasJavaSamePackageConvention(filepath: string): boolean {
  const language = detectLanguage(filepath);
  return language !== null && hasSamePackageTestConvention(language);
}

/**
 * True when `filepath`'s language sets `enclosingNamespaceAccess` (C#
 * today, #930/#1040) -- mirrors `hasGoSameDirectoryConvention` /
 * `hasJavaSamePackageConvention` above.
 */
function hasCSharpEnclosingNamespaceConvention(filepath: string): boolean {
  const language = detectLanguage(filepath);
  return language !== null && hasEnclosingNamespaceAccess(language);
}

/**
 * #1005 Phase 2, Item 2: true only for Kotlin, deliberately NOT a
 * registry-flag predicate like the three helpers above. Java already owns
 * `samePackageTestConvention` (`hasJavaSamePackageConvention`) and its own
 * PATH-derived mechanism (`java-same-package-tests.ts`, keyed on the
 * `src/<sourceSet>/java/` Standard Directory Layout marker, which is
 * Kotlin-blind by construction -- see `jvm-same-package-signals.test.ts`'s
 * "cross-check" describe block). This is a SEPARATE, CONTENT-derived
 * mechanism (Phase 1's `package` declaration scan) for Kotlin specifically:
 * measurement during the plan review found a Kotlin-targeted path-regex
 * extension of Java's mechanism contributes little beyond what this
 * content-derived tier alone already finds, and never fires at all on
 * heavily-multiplatform-Kotlin layouts -- so Kotlin gets ONLY this
 * mechanism, not a second one layered on top.
 */
function isKotlinFile(filepath: string): boolean {
  return detectLanguage(filepath) === 'kotlin';
}

/**
 * Test files among `testChunks` whose imports resolve to `normalizedTarget`,
 * exact literal matches first (#929). A test whose own import specifier
 * resolves to exactly `normalizedTarget` -- a genuine, unambiguous direct
 * reference -- is strictly better evidence than one that only matched via
 * `matchesFile`'s fuzzier boundary/PHP/Python strategies, but both used to
 * come back in the same undifferentiated bag, ordered only by chunk-scan
 * order. Downstream display (`lien annotate`'s `formatTests`) truncates to
 * the first `MAX_TESTS_LISTED` entries, so an exact direct importer that
 * happened to sort last was silently dropped from what an agent actually
 * reads -- the real hono/jws.ts repro (#929) had `jwt.test.ts`'s own direct
 * `./jws` import buried behind several other real, but less specific,
 * matches purely due to scan order. Partitioning first (rather than
 * re-deriving which `matchesFile` strategy fired, which would mean
 * threading a new return shape through `importMatchesTarget`) keeps this
 * change local to the one function that assembles the display order.
 *
 * The "exact" bucket still needs the #884 whole-module guard applied
 * directly (it never calls `matchesFile`/`importMatchesTarget`, so nothing
 * else applies it): a whole-module-import language (Swift) only ever emits
 * the bare module name as its "import", so a target file whose basename
 * happens to equal that name -- the classic #884 Alamofire shape -- would
 * otherwise satisfy the literal `normalize(imp) === normalizedTarget` check
 * and jump the queue into the trusted `exact` bucket, ahead of a real
 * direct importer. See `isUnresolvableWholeModuleImport`'s doc comment.
 */
/**
 * True when `imp` (as written in `importerFile`) is a literal, exact
 * reference to `normalizedTarget` -- the #929 direct-importer signal -- and
 * is not merely a whole-module-import language's bare module name that
 * happens to coincide with it (the #884 Alamofire shape). This check never
 * calls `matchesFile`/`importMatchesTarget`, so the #884 whole-module guard
 * has to be applied here directly, independently of the fuzzy path below.
 * Extracted so `collectImportMatchedTests`'s own loop body doesn't grow
 * another nested condition per guard.
 */
function isExactDirectImport(
  imp: string,
  importerFile: string,
  normalizedTarget: string,
  normalize: (p: string) => string,
): boolean {
  return !isUnresolvableWholeModuleImport(imp, importerFile) && normalize(imp) === normalizedTarget;
}

function collectImportMatchedTests(
  testChunks: CodeChunk[],
  normalizedTarget: string,
  normalize: (p: string) => string,
): string[] {
  const exact: string[] = [];
  const fuzzy: string[] = [];
  for (const chunk of testChunks) {
    const imports = chunk.metadata.imports || [];
    const isExactMatch = imports.some(imp =>
      isExactDirectImport(imp, chunk.metadata.file, normalizedTarget, normalize),
    );
    // importMatchesTarget applies the #884 whole-module guard before
    // matchesFile -- see its doc comment in path-matching.ts (#886).
    const isFuzzyMatch = imports.some(imp =>
      importMatchesTarget(imp, chunk.metadata.file, normalizedTarget, normalize),
    );
    if (isExactMatch) {
      exact.push(chunk.metadata.file);
    } else if (isFuzzyMatch) {
      fuzzy.push(chunk.metadata.file);
    }
  }
  return [...exact, ...fuzzy];
}

/**
 * #902 tier 1: same-directory basename-paired Go test(s) for `filepath`, or
 * `[]` for any non-Go target (or a Go target with no basename pair). See
 * `go-same-directory-tests.ts`'s module doc for why this needs no hedging.
 */
function collectGoBasenameTests(
  filepath: string,
  normalizedTarget: string,
  goTestDirIndex: GoTestDirIndex,
): string[] {
  return hasGoSameDirectoryConvention(filepath)
    ? pairGoBasenameTest(normalizedTarget, goTestDirIndex)
    : [];
}

/**
 * #925 tier 1: same-package basename-paired Java test(s) for `filepath`, or
 * `[]` for any non-Java target (or a Java target with no basename pair).
 * Mirrors `collectGoBasenameTests` immediately above.
 */
function collectJavaBasenameTests(
  filepath: string,
  normalizedTarget: string,
  javaTestDirIndex: JavaTestDirIndex,
): string[] {
  return hasJavaSamePackageConvention(filepath)
    ? pairJavaBasenameTest(normalizedTarget, javaTestDirIndex)
    : [];
}

/**
 * #1040: C#'s enclosing-namespace test convention has no basename pairing to
 * fall back on (unlike Go/Java, a C# test class's file name routinely bears
 * no relation to the specific type(s) it covers -- e.g. MediatR's
 * `PipelineTests.cs` tests `IPipelineBehavior`/`IRequestHandler`, declared in
 * files with neither name). Instead, this reuses
 * `resolveCSharpTypeReferenceDependents` -- the SAME namespace-scoped
 * signal `get_dependents`'s file-level recovery already relies on (#930,
 * `csharp-type-reference-signals.ts`) -- filtered down to the test-file
 * subset of `filepath`'s recovered dependents. Both of that signal's tiers
 * already refuse to guess on ambiguity (global-uniqueness for tier 1,
 * namespace-enclosure + shadowing for tier 2), so this is folded directly
 * into the returned association set here, the same "real recovery, not just
 * an honesty label" treatment Go/Java's own tier 1 gets above -- unlike
 * `annotate-cmd.ts`'s OWN, separate, last-resort-only use of this same
 * function (kept distinct there because it only fires when this module's
 * import-based `tests` came back empty).
 */
function collectCSharpNamespaceTests(
  filepath: string,
  csharpIndex: CSharpTypeReferenceIndex,
): string[] {
  return hasCSharpEnclosingNamespaceConvention(filepath)
    ? resolveCSharpTypeReferenceDependents(filepath, csharpIndex).filter(isTestFile)
    : [];
}

/**
 * `getCanonicalPath(rawFile, workspaceRoot)` -> `rawFile`, for every JVM
 * (Java+Kotlin) file `jvmIndex` knows about -- built once and reused for
 * every target file below, mirroring `buildJvmSamePackageIndex` itself
 * being built once.
 *
 * `resolveJvmSamePackageDependents` requires `targetFile` to be the EXACT
 * `chunk.metadata.file` string used when `jvmIndex` was built (see that
 * function's doc comment). `findTestAssociationsFromChunks` is reached with
 * several different path forms from different callers (some
 * workspace-relative with an explicit `rootDir`, at least one --
 * `insights/chunk-complexity.ts` -- with NO root passed at all, defaulting
 * to `process.cwd()`), so comparing a caller's raw `filepath`
 * against the raw index directly risks a silent `[]` on any form mismatch --
 * exactly the "clean-looking zero" this repo's index-state-honesty policy
 * forbids. `collectCSharpNamespaceTests` immediately above has exactly this
 * latent gap (no canonicalization at all against `csharpIndex`); deliberately
 * NOT copied forward here. Canonicalizing via `getCanonicalPath` on BOTH the
 * index-build side (this map) and the query side
 * (`collectKotlinSamePackageTests`) closes it for the new tier, while
 * `resolveJvmSamePackageDependents`'s OWN raw-form output (and therefore
 * this module's whole `testFiles` Set convention, which every other tier
 * here already returns in raw `chunk.metadata.file` form) stays unchanged --
 * `jvmIndex` itself is still built from the untouched, raw `chunks` array.
 */
function buildRawJvmFileByCanonical(
  jvmIndex: JvmSamePackageIndex,
  workspaceRoot: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawFile of jvmIndex.chunksByFile.keys()) {
    out.set(getCanonicalPath(rawFile, workspaceRoot), rawFile);
  }
  return out;
}

/**
 * #1005 Phase 2, Item 2: Kotlin's same-package test convention -- like
 * Java's (#925) and C#'s (#1040), a Kotlin test class commonly lives in the
 * same package as its subject with no import connecting them at all.
 * Deliberately reuses Phase 1's FILE-LEVEL `resolveJvmSamePackageDependents`
 * (#1100) -- NOT #1005 Phase 2 Item 1's per-type
 * `resolveJvmSamePackageDependentsForType` -- because "which tests exercise
 * this file" is inherently a file-level question, and this module's
 * consumer (`hasTestCoverage` in `@liendev/review`'s `blast-radius.ts`,
 * file-keyed) needs a file-level answer, not a type-scoped one.
 *
 * See `buildRawJvmFileByCanonical`'s doc comment for why `filepath` is
 * canonicalized before ever touching `jvmIndex`, rather than compared
 * directly the way `collectCSharpNamespaceTests` does.
 */
function collectKotlinSamePackageTests(
  filepath: string,
  jvmIndex: JvmSamePackageIndex,
  rawJvmFileByCanonical: ReadonlyMap<string, string>,
  workspaceRoot: string,
): string[] {
  if (!isKotlinFile(filepath)) return [];
  const rawFile = rawJvmFileByCanonical.get(getCanonicalPath(filepath, workspaceRoot));
  if (!rawFile) return [];
  return resolveJvmSamePackageDependents(rawFile, jvmIndex).filter(isTestFile);
}

/**
 * #902: Go's dominant same-package test convention emits no import statement
 * at all, so `collectImportMatchedTests` is structurally blind to it. Builds
 * a directory index of same-directory-test-convention (Go) test chunks --
 * tier 1 only (basename pairing); tier 2 (package-level fallback) is a
 * `lien annotate`-only honesty fallback, see annotate-cmd.ts. Extracted from
 * `findTestAssociationsFromChunks` to keep that function's own complexity
 * from growing with each additional per-language tier-1 convention.
 */
function buildGoTestDirIndexFrom(
  testChunks: CodeChunk[],
  normalize: (p: string) => string,
): GoTestDirIndex {
  const candidates: GoTestCandidate[] = testChunks
    .filter(chunk => hasGoSameDirectoryConvention(chunk.metadata.file))
    .map(chunk => ({ file: chunk.metadata.file, normalized: normalize(chunk.metadata.file) }));
  return buildGoTestDirIndex(candidates);
}

/**
 * #925: same story as `buildGoTestDirIndexFrom` above, but for Java's
 * same-PACKAGE (not same-directory) convention -- see
 * java-same-package-tests.ts's module doc.
 */
function buildJavaTestDirIndexFrom(
  testChunks: CodeChunk[],
  normalize: (p: string) => string,
): JavaTestDirIndex {
  const candidates: JavaTestCandidate[] = testChunks
    .filter(chunk => hasJavaSamePackageConvention(chunk.metadata.file))
    .map(chunk => toJavaTestCandidate(chunk.metadata.file, normalize))
    .filter((c): c is JavaTestCandidate => c !== null);
  return buildJavaTestDirIndex(candidates);
}

/**
 * Find test files that import the given source files.
 * Works entirely from in-memory chunks — no VectorDB or filesystem needed.
 *
 * @param filepaths - Source file paths to find tests for
 * @param chunks - All indexed chunks (test + source files)
 * @param workspaceRoot - Workspace root for path normalization (defaults to cwd)
 * @returns Map of source filepath → array of test file paths that import it
 */
export function findTestAssociationsFromChunks(
  filepaths: string[],
  chunks: CodeChunk[],
  workspaceRoot: string = process.cwd(),
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  // Build a path normalization cache for performance
  const cache = new Map<string, string>();
  const normalize = (p: string): string => {
    if (cache.has(p)) return cache.get(p)!;
    const normalized = normalizePath(p, workspaceRoot);
    cache.set(p, normalized);
    return normalized;
  };

  // Pre-filter to only test chunks for performance
  const testChunks = chunks.filter(chunk => isTestFile(chunk.metadata.file));

  // Directory/package indexes for the no-import same-{directory,package}
  // test conventions (#902 Go, #925 Java) -- built once, reused for every
  // target file below. Tier 1 only (basename pairing); each language's
  // tier 2 (package-level fallback) is a `lien annotate`-only honesty
  // fallback, see annotate-cmd.ts.
  const goTestDirIndex = buildGoTestDirIndexFrom(testChunks, normalize);
  const javaTestDirIndex = buildJavaTestDirIndexFrom(testChunks, normalize);
  // #1040: C#'s enclosing-namespace test-association index, built once
  // (project-wide, not just `testChunks` -- tier 1's global-uniqueness gate
  // needs every declaration) and reused for every target file below, same
  // "build once" discipline as the two indexes above.
  const csharpIndex = buildCSharpTypeReferenceIndex(chunks);
  // #1005 Phase 2, Item 2: Kotlin's same-package test-association index,
  // same "build once, project-wide" discipline -- see
  // `buildRawJvmFileByCanonical`'s doc comment for why the canonical-path
  // lookup is a SEPARATE map built alongside it, not folded into
  // `JvmSamePackageIndex` itself.
  const jvmIndex = buildJvmSamePackageIndex(chunks);
  const rawJvmFileByCanonical = buildRawJvmFileByCanonical(jvmIndex, workspaceRoot);

  for (const filepath of filepaths) {
    const normalizedTarget = normalize(filepath);
    const testFiles = new Set<string>([
      ...collectImportMatchedTests(testChunks, normalizedTarget, normalize),
      ...collectGoBasenameTests(filepath, normalizedTarget, goTestDirIndex),
      ...collectJavaBasenameTests(filepath, normalizedTarget, javaTestDirIndex),
      ...collectCSharpNamespaceTests(filepath, csharpIndex),
      ...collectKotlinSamePackageTests(filepath, jvmIndex, rawJvmFileByCanonical, workspaceRoot),
    ]);

    if (testFiles.size > 0) {
      result.set(filepath, Array.from(testFiles));
    }
  }

  return result;
}

/**
 * Java's dominant unit-test convention places a test class in the SAME
 * package as its subject, with no `import` statement connecting them at all
 * -- Java, like Go, grants unqualified access to every other type in the
 * same package (#925). Unlike Go, this is NOT bounded to a single directory:
 * a real Gradle/Maven multi-module build routinely puts the test class in a
 * *different* module's source root that happens to declare the identical
 * package.
 *
 * Measured against a real square/retrofit clone: ALL 101 of its test files
 * share a package with their subject but live in a different module's
 * `src/<sourceSet>/java/` tree entirely -- e.g.
 * `retrofit-adapters/guava/src/test/java/retrofit2/adapter/guava/
 * GuavaCallAdapterFactoryTest.java` (package `retrofit2.adapter.guava`, zero
 * import for `GuavaCallAdapterFactory`) tests `retrofit-adapters/guava/
 * src/main/java/retrofit2/adapter/guava/GuavaCallAdapterFactory.java` --
 * same package, different directory. `chunk.metadata.imports` carries zero
 * signal for this, Java's own dominant unit-test shape, exactly the same
 * structural gap #902 named for Go.
 *
 * This module needs no `package` clause parsing to recover the signal.
 * Every real Java build tool (Maven, Gradle, and every IDE that reads
 * either) enforces the Standard Directory Layout: a source file always
 * lives at `.../src/<sourceSet>/java/<package/path>/ClassName.java`, where
 * `<sourceSet>` is `main`, `test`, `androidTest`, or similar. Stripping that
 * fixed, well-known marker recovers the package-relative path
 * deterministically -- pure filepath-string reasoning, exactly like Go's
 * "same directory" is, just keyed on the path *after* the source-root
 * marker instead of the literal directory. A file that doesn't follow this
 * layout simply doesn't participate (see `javaPackageRelativePath`'s null
 * return) rather than falling back to a guess.
 *
 * Same two-tier discipline as Go's #902 (`go-same-directory-tests.ts`):
 *
 *  - Tier 1, `pairJavaBasenameTest`: `Foo.java` <-> `FooTest.java`, same
 *    package-relative directory, exact stem match. As trustworthy as a real
 *    import match -- no hedging -- so callers fold this directly into their
 *    existing test-association set (see `test-associations.ts` and
 *    `get-files-context.ts`).
 *  - Tier 2, `findJavaPackageLevelTests`: every test file sharing the
 *    target's package-relative directory, used ONLY as a last resort when
 *    tier 1 finds nothing for that specific file. Real, non-fabricated
 *    same-package signal, but coarser -- callers must present it distinctly
 *    (see `annotate-cmd.ts`'s honesty label), never with tier 1's
 *    unqualified confidence.
 */

import * as path from 'node:path';

/** Maven/Gradle Standard Directory Layout's fixed `src/<sourceSet>/java/` marker. */
const SOURCE_ROOT_PATTERN = /(?:^|\/)src\/[^/]+\/java\/(.+)$/;

/**
 * Strip the `src/<sourceSet>/java/` prefix, returning the package-relative
 * path (directory + basename, extension already stripped by the caller's
 * own normalization -- mirrors `pairGoBasenameTest`'s `normalizedTarget`
 * contract). Returns null for a path that doesn't follow the convention;
 * callers must treat that as "does not participate", never as a fallback
 * to guess from.
 */
export function javaPackageRelativePath(normalizedPath: string): string | null {
  const match = SOURCE_ROOT_PATTERN.exec(normalizedPath);
  return match ? match[1] : null;
}

/**
 * A candidate Java test file, carrying both the form to add to a result set
 * (`file`) and its package-relative path (directory + basename) to compare
 * against -- mirrors `GoTestCandidate`'s `file`/`normalized` split.
 */
export interface JavaTestCandidate {
  /** The path to report back to the caller (e.g. `chunk.metadata.file`). */
  file: string;
  /** Package-relative path (post `src/<sourceSet>/java/` strip, extension-stripped). */
  packageRelative: string;
}

/** Package-relative directory -> every same-package-test-convention candidate in it. */
export type JavaTestDirIndex = ReadonlyMap<string, readonly JavaTestCandidate[]>;

/**
 * Build a `JavaTestCandidate` from a (potential) test chunk's file, or
 * `null` when it doesn't follow the Standard Directory Layout (see
 * `javaPackageRelativePath`). Shared by every caller that builds a
 * `JavaTestDirIndex` from indexed chunks (`test-associations.ts`,
 * `get-files-context.ts`, `annotate-cmd.ts`) so the "does this path
 * participate" check can't drift between them.
 */
export function toJavaTestCandidate(
  file: string,
  normalize: (path: string) => string,
): JavaTestCandidate | null {
  const packageRelative = javaPackageRelativePath(normalize(file));
  return packageRelative === null ? null : { file, packageRelative };
}

/**
 * Build a package-relative-directory index from a list of candidate Java
 * test files. Callers build this once per scan (not per target file) and
 * reuse it -- mirrors `buildGoTestDirIndex`.
 */
export function buildJavaTestDirIndex(candidates: readonly JavaTestCandidate[]): JavaTestDirIndex {
  const index = new Map<string, JavaTestCandidate[]>();
  for (const candidate of candidates) {
    const dir = path.posix.dirname(candidate.packageRelative);
    const existing = index.get(dir);
    if (existing) {
      existing.push(candidate);
    } else {
      index.set(dir, [candidate]);
    }
  }
  return index;
}

/**
 * Multiple chunks (methods) commonly exist for one physical test file, so a
 * candidate list built straight from chunks can carry the same `file`
 * several times over. Both tiers below return a deduplicated list regardless
 * of caller behavior. Mirrors `go-same-directory-tests.ts`'s `dedupeFiles`.
 */
function dedupeFiles(files: string[]): string[] {
  return Array.from(new Set(files));
}

/**
 * Tier 1: the test file(s) sharing `normalizedTarget`'s package-relative
 * directory whose basename is exactly `<target-basename>Test` (Java's
 * `Foo.java` <-> `FooTest.java` convention). Returns the candidates' `file`
 * form, ready to add straight into a caller's test-association set.
 *
 * `normalizedTarget` must already be extension-stripped and workspace-
 * relative (same contract as `pairGoBasenameTest`). Returns `[]` for a
 * target that doesn't follow the Standard Directory Layout.
 *
 * No self-match guard is needed: the required candidate basename is
 * `normalizedTarget`'s own basename with a non-empty `Test` literal
 * appended, which can never equal `normalizedTarget`'s own basename again --
 * mirrors `pairGoBasenameTest`'s reasoning exactly.
 */
export function pairJavaBasenameTest(
  normalizedTarget: string,
  dirIndex: JavaTestDirIndex,
): string[] {
  const relative = javaPackageRelativePath(normalizedTarget);
  if (relative === null) return [];

  const dir = path.posix.dirname(relative);
  const expectedBasename = `${path.posix.basename(relative)}Test`;
  const candidates = dirIndex.get(dir);
  if (!candidates) return [];
  return dedupeFiles(
    candidates
      .filter(candidate => path.posix.basename(candidate.packageRelative) === expectedBasename)
      .map(candidate => candidate.file),
  );
}

/**
 * Tier 2, fallback only: every same-package-test-convention test file
 * sharing `normalizedTarget`'s package-relative directory, regardless of
 * basename, EXCLUDING `normalizedTarget` itself. Without that exclusion,
 * calling this on a test file directly would list the file as covered by
 * itself. Callers must only consult this when tier 1
 * (`pairJavaBasenameTest`) finds nothing for the same target, and must
 * present the result distinctly from a direct match -- mirrors
 * `findGoPackageLevelTests`'s discipline exactly.
 */
export function findJavaPackageLevelTests(
  normalizedTarget: string,
  dirIndex: JavaTestDirIndex,
): string[] {
  const relative = javaPackageRelativePath(normalizedTarget);
  if (relative === null) return [];

  const dir = path.posix.dirname(relative);
  const candidates = dirIndex.get(dir);
  if (!candidates) return [];
  return dedupeFiles(
    candidates
      .filter(candidate => candidate.packageRelative !== relative)
      .map(candidate => candidate.file),
  );
}

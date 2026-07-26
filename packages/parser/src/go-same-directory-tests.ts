/**
 * Go's dominant same-package test convention (#902): a `_test.go` file in
 * `package foo` tests `package foo`'s other files in the same directory with
 * NO import statement connecting them at all — Go forbids a package from
 * importing itself, so `chunk.metadata.imports` carries zero signal for this,
 * the language's own dominant unit-test shape (measured at 94.4% of a real
 * codebase's `_test.go` files basename-pairing with a same-named sibling;
 * 100% same-directory). Import-based matching (`matchesFile`,
 * `importMatchesTarget`) is structurally blind to it, by construction of the
 * language — not a matching bug.
 *
 * This module needs no AST/package-clause parsing to recover the signal: Go's
 * compiler already enforces one package per directory (the sole exception —
 * a `_test.go` file declaring an external `package foo_test` — still sits in
 * the same directory, so it's covered the same way; see #902's design for why
 * this needs no disambiguation). "Same directory" is therefore itself
 * reliable, deterministic evidence — this is pure filepath-string reasoning,
 * exactly like `isTestFile` already is.
 *
 * Two tiers, most to least precise (per #902's design, evidenced against a
 * real `cli/cli` clone — basename pairing alone recovers 73.5% of the
 * previously-dark files there, package-level fallback the remaining 26.5%):
 *
 *  - Tier 1, `pairGoBasenameTest`: `foo.go` <-> `foo_test.go`, same directory,
 *    exact stem match. As trustworthy as a real import match — no hedging —
 *    so callers fold this directly into their existing test-association set
 *    (see `test-associations.ts` and `get-files-context.ts`).
 *  - Tier 2, `findGoPackageLevelTests`: every `_test.go` file in the target's
 *    directory, used ONLY as a last resort when tier 1 finds nothing for that
 *    specific file. Real, non-fabricated same-package signal, but coarser —
 *    callers must present it distinctly (see `annotate-cmd.ts`'s honesty
 *    label), never with tier 1's unqualified confidence.
 *
 * Both tiers are bounded to the same directory by construction — the worst
 * either can produce is "attributed to the wrong file in the same package,"
 * never the cross-directory textual collisions #868/#883 guard against.
 */

import * as path from 'node:path';

/**
 * A candidate Go test file, carrying both the form to add to a result set
 * (`file`, whatever raw/canonical form the caller's other test-file paths
 * use) and the form to compare directories/basenames on (`normalized` —
 * already extension-stripped and workspace-relative, via the caller's own
 * `normalizePath`/`normalize` cache, so this module never has to know about
 * normalization itself).
 */
export interface GoTestCandidate {
  /** The path to report back to the caller (e.g. `chunk.metadata.file`). */
  file: string;
  /** Extension-stripped, workspace-relative form, for directory/basename comparison. */
  normalized: string;
}

/** Directory -> every same-directory-test-convention test candidate in it. */
export type GoTestDirIndex = ReadonlyMap<string, readonly GoTestCandidate[]>;

/**
 * Build a directory index from a list of candidate Go test files. Callers
 * build this once per scan (not per target file) and reuse it — mirrors the
 * existing `testChunks` pre-filter pattern in `findTestAssociationsFromChunks`.
 */
export function buildGoTestDirIndex(candidates: readonly GoTestCandidate[]): GoTestDirIndex {
  const index = new Map<string, GoTestCandidate[]>();
  for (const candidate of candidates) {
    const dir = path.posix.dirname(candidate.normalized);
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
 * Multiple chunks (functions/blocks) commonly exist for one physical test
 * file, so a candidate list built straight from chunks can carry the same
 * `file` several times over. Both tiers below return a deduplicated list
 * regardless of caller behavior, so a single test file is never reported
 * twice in one file's association/fallback list.
 */
function dedupeFiles(files: string[]): string[] {
  return Array.from(new Set(files));
}

/**
 * Tier 1: the test file(s) in `normalizedTarget`'s own directory whose
 * basename is exactly `<target-basename>_test` (Go's `foo.go` <->
 * `foo_test.go` convention). Returns the candidates' `file` form (not
 * `normalized`), ready to add straight into a caller's test-association set.
 *
 * `normalizedTarget` must already be extension-stripped (Go's own
 * `foo_test.go` normalizes to `.../foo_test`, so the expected suffix is a
 * plain `_test`, not `_test.go`).
 *
 * No self-match guard is needed here (unlike `findGoPackageLevelTests`
 * below): the required candidate basename is `normalizedTarget`'s own
 * basename with a non-empty `_test` literal appended, which can never equal
 * `normalizedTarget`'s own basename again -- so a target can never satisfy
 * its own match condition, even when the target is itself a `_test.go` file
 * (its basename would need to double-suffix to `..._test_test` to match).
 */
export function pairGoBasenameTest(normalizedTarget: string, dirIndex: GoTestDirIndex): string[] {
  const dir = path.posix.dirname(normalizedTarget);
  const expectedBasename = `${path.posix.basename(normalizedTarget)}_test`;
  const candidates = dirIndex.get(dir);
  if (!candidates) return [];
  return dedupeFiles(
    candidates
      .filter(candidate => path.posix.basename(candidate.normalized) === expectedBasename)
      .map(candidate => candidate.file),
  );
}

/**
 * Tier 2, fallback only: every same-directory-test-convention test file in
 * `normalizedTarget`'s own directory, regardless of basename, EXCLUDING
 * `normalizedTarget` itself. Without that exclusion, calling this on a
 * `_test.go` file directly (e.g. `lien annotate some_test.go`) would list
 * the file as covered by itself, since a `_test.go` target is itself a
 * candidate in its own directory's index. Callers must only consult this
 * when tier 1 (`pairGoBasenameTest`) finds nothing for the same target, and
 * must present the result distinctly from a direct match — see
 * `annotate-cmd.ts`'s honesty label for the one place this is wired in.
 */
export function findGoPackageLevelTests(
  normalizedTarget: string,
  dirIndex: GoTestDirIndex,
): string[] {
  const dir = path.posix.dirname(normalizedTarget);
  const candidates = dirIndex.get(dir);
  if (!candidates) return [];
  return dedupeFiles(
    candidates
      .filter(candidate => candidate.normalized !== normalizedTarget)
      .map(candidate => candidate.file),
  );
}

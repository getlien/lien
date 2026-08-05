/**
 * Marker for a Rust import specifier that's already been resolved to EXACTLY
 * one file -- never a directory whose children should also match -- so it
 * needs `matchesRustModSpecifier`'s (`path-matching.ts`) stricter exact-or-
 * `/mod`-suffix matching instead of `matchesFile`'s ordinary interior-hit-
 * tolerant (package-directory-style) leniency. Two current producers:
 *
 * - A `mod x;` (or `pub mod x;`) declaration -- `../ast/languages/rust.ts`'s
 *   `extractModImportPath` (#1021). Resolves to EXACTLY one of `x.rs` /
 *   `x/mod.rs`; it can never legally refer to a grandchild file, a sibling
 *   under an unrelated name, or its own declaring file.
 * - A bare crate-root import (`use crate_name::Symbol;`, no submodule path)
 *   resolved via crate-root export lookup -- `../rust-crate-exports.ts`'s
 *   `resolveRustCrateRootExport` (#1056). Names the ONE file (typically
 *   `lib.rs`) that the lookup determined actually declares `Symbol`; the
 *   same "not a directory" guarantee applies, just reached via a different
 *   mechanism (reading the crate's own root file rather than parsing a `mod`
 *   declaration).
 *
 * Why this distinction has to exist: every OTHER Rust `use` specifier
 * (`use crate::...`, `self::`/`super::`, all produced by
 * `convertRustModulePath`'s crate/self/super-prefix stripping) doesn't carry
 * that same guarantee -- after its prefix is stripped it's crate-root-
 * relative (missing the real `src/`-style directory prefix -- see
 * `matchesAtBoundaryPrecise`'s `maxLeadingSegments` leniency for that
 * convention), and for several `use` shapes (`use crate::thing::sibling::
 * Thing;`) `extractImportPath`'s raw "imports" list variant keeps the
 * imported item's own name glued onto the module path (`thing/sibling/
 * Thing`) rather than isolating the module path alone. Those specifiers
 * therefore still need `matchesFile`'s existing leniency to resolve at all;
 * only a specifier ALREADY narrowed to one file by one of the two producers
 * above gets the stricter treatment.
 *
 * Why a string marker rather than a richer per-import data shape:
 * `chunk.metadata.imports` is a flat `string[]` (see `dependency-analyzer.ts`'s
 * `ImportIndexEntry`, and `chunk.metadata.importedSymbols`'s keys, which reuse
 * the identical string), with no room for a second field to carry this
 * distinction alongside each specifier -- and every match-side consumer
 * (`buildImportIndex`/`findDependentChunks`, `test-associations.ts`,
 * `get_files_context`'s handler, this package's own `graph/dependency-graph.ts`)
 * reads that array as a plain list of strings, with no per-entry metadata
 * slot. Widening that shared shape for one language's one import form would
 * ripple through the scanner, the SQLite row mapping, and every one of those
 * consumers -- exactly the repo-wide blast radius `path-matching.ts`'s own
 * conservatism (it's imported by every supported language) argues against.
 * Tagging the specifier string itself confines the change to its producers
 * (`extractModImportPath` and `resolveRustCrateRootExport`, both via
 * `markRustModSpecifier`) and its one consumer (`path-matching.ts`, via
 * `hasRustModMarker`/`stripRustModMarker`).
 *
 * Why this is safe to embed directly in the string: the marker is a single
 * Private-Use-Area code point, never producible by any real source file's
 * import syntax in any currently-supported language, so `hasRustModMarker`
 * cannot misfire on a coincidentally-matching literal specifier from another
 * language. It's also safe to round-trip through `JSON.stringify` and SQLite
 * TEXT storage (`row-mapping.ts` persists `chunk.metadata.imports` verbatim)
 * -- unlike a NUL byte, which some C-string-based storage/tooling can
 * truncate on.
 *
 * `normalizePath` (in `path-matching.ts`) strips the marker unconditionally
 * as its very first step, so every existing consumer that calls `normalize()`
 * on a raw specifier -- including the two `isExactDirectImport` helpers in
 * `test-associations.ts` and `get_files_context`'s handler, which compare
 * `normalize(imp) === normalizedTarget` directly rather than routing through
 * `importMatchesTarget` -- gets a clean, comparable value for free, with no
 * changes needed at those call sites.
 *
 * This module deliberately has NO imports of its own: `rust.ts` and
 * `rust-crate-exports.ts` both need `markRustModSpecifier`, and
 * `path-matching.ts` needs the other two. Routing either direction through
 * the other file would create an import cycle -- `registry.ts` already
 * imports `rust.ts` to register `rustDefinition`, and `path-matching.ts`
 * already imports `registry.ts`, so `rust.ts` importing directly from
 * `path-matching.ts` would close the loop (`rust.ts` -> `path-matching.ts` ->
 * `registry.ts` -> `rust.ts`), and `path-matching.ts` importing directly from
 * `rust.ts` would break its own "generic, language-agnostic" architecture
 * (every other per-language fact it consumes is threaded through
 * `registry.ts`'s abstractions, never a specific language file). A
 * standalone module with no dependencies sidesteps both problems.
 */
// Spelled via fromCharCode, not embedded as a literal character in a string
// -- a raw Private-Use-Area code point renders as an invisible glyph in most
// editors/diff tools, so the numeric form keeps the source legible.
const RUST_MOD_SPECIFIER_MARKER = String.fromCharCode(0xe000);

/** Prefix `specifier` (a Rust import resolved to exactly one file) with the marker. */
export function markRustModSpecifier(specifier: string): string {
  return RUST_MOD_SPECIFIER_MARKER + specifier;
}

/** True when `specifier` was produced by `markRustModSpecifier`. */
export function hasRustModMarker(specifier: string): boolean {
  return specifier.startsWith(RUST_MOD_SPECIFIER_MARKER);
}

/** Remove the marker `markRustModSpecifier` added. No-op if it isn't present. */
export function stripRustModMarker(specifier: string): string {
  return hasRustModMarker(specifier)
    ? specifier.slice(RUST_MOD_SPECIFIER_MARKER.length)
    : specifier;
}

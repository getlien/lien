/**
 * Marker distinguishing a Rust `mod x;` (or `pub mod x;`)-DERIVED import
 * specifier -- produced only by `../ast/languages/rust.ts`'s
 * `extractModImportPath` -- from every other Rust import (`use crate::...`,
 * `self::`/`super::`, all produced by `convertRustModulePath`) (#1021).
 *
 * Why this distinction has to exist: a `mod x;` declaration resolves to
 * EXACTLY one of `x.rs` / `x/mod.rs` -- it can never legally refer to a
 * grandchild file, a sibling under an unrelated name, or its own declaring
 * file. A `use` path doesn't carry that guarantee: after its `crate::`/
 * `self::`/`super::` prefix is stripped it's crate-root-relative (missing the
 * real `src/`-style directory prefix -- see `matchesAtBoundaryPrecise`'s
 * `maxLeadingSegments` leniency for that convention), and for several `use`
 * shapes (`use crate::thing::sibling::Thing;`) `extractImportPath`'s raw
 * "imports" list variant keeps the imported item's own name glued onto the
 * module path (`thing/sibling/Thing`) rather than isolating the module path
 * alone. `use` specifiers -- ordinary or `self::`/`super::`-relative alike --
 * therefore still need `matchesFile`'s existing interior-hit-tolerant
 * (package-directory-style) matching to resolve at all; only `mod`-derived
 * specifiers get the stricter treatment (`matchesRustModSpecifier` in
 * `path-matching.ts`).
 *
 * Why a string marker rather than a richer per-import data shape:
 * `chunk.metadata.imports` is a flat `string[]` (see `dependency-analyzer.ts`'s
 * `ImportIndexEntry`, and `chunk.metadata.importedSymbols`'s keys, which reuse
 * the identical string), with no room for a second field to carry this
 * distinction alongside each specifier -- and every match-side consumer
 * (`buildImportIndex`/`findDependentChunks`, `test-associations.ts`,
 * `get_files_context`'s handler, `packages/review`'s `dependency-graph.ts`)
 * reads that array as a plain list of strings, with no per-entry metadata
 * slot. Widening that shared shape for one language's one import form would
 * ripple through the scanner, the SQLite row mapping, and every one of those
 * consumers -- exactly the repo-wide blast radius `path-matching.ts`'s own
 * conservatism (it's imported by every supported language) argues against.
 * Tagging the specifier string itself confines the change to its producer
 * (`extractModImportPath`, via `markRustModSpecifier`) and its one consumer
 * (`path-matching.ts`, via `hasRustModMarker`/`stripRustModMarker`).
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
 * This module deliberately has NO imports of its own: `rust.ts` needs
 * `markRustModSpecifier`, and `path-matching.ts` needs the other two.
 * Routing either direction through the other file would create an import
 * cycle -- `registry.ts` already imports `rust.ts` to register
 * `rustDefinition`, and `path-matching.ts` already imports `registry.ts`, so
 * `rust.ts` importing directly from `path-matching.ts` would close the loop
 * (`rust.ts` -> `path-matching.ts` -> `registry.ts` -> `rust.ts`), and
 * `path-matching.ts` importing directly from `rust.ts` would break its own
 * "generic, language-agnostic" architecture (every other per-language fact it
 * consumes is threaded through `registry.ts`'s abstractions, never a specific
 * language file). A standalone module with no dependencies sidesteps both
 * problems.
 */
// Spelled via fromCharCode, not embedded as a literal character in a string
// -- a raw Private-Use-Area code point renders as an invisible glyph in most
// editors/diff tools, so the numeric form keeps the source legible.
const RUST_MOD_SPECIFIER_MARKER = String.fromCharCode(0xe000);

/** Prefix `specifier` (a `mod`-derived resolved path) with the marker. */
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

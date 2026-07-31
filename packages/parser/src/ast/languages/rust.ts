import type { SymbolInfo, SyntaxNode } from '../types.js';
import type { LanguageDefinition } from './types.js';
import type { LanguageTraverser, DeclarationFunctionInfo } from '../traversers/types.js';
import type {
  LanguageExportExtractor,
  LanguageImportExtractor,
  LanguageSymbolExtractor,
} from '../extractors/types.js';
import { toImportPathsArray, toImportSymbolsArray } from '../extractors/types.js';
import {
  extractSignature,
  extractParameters,
  extractReturnType,
  clampSignatureLength,
  collapseWhitespace,
} from '../extractors/symbol-helpers.js';
import { calculateComplexity } from '../complexity/index.js';
import { resolveRustCrateImport } from '../../rust-crate-map.js';

// =============================================================================
// TRAVERSER
// =============================================================================

/**
 * Rust AST traverser
 *
 * Handles Rust AST node types and traversal patterns.
 * Rust is similar to Python in that functions are always declared with `fn`:
 * - No variable declarations with functions (unlike JS const x = || {})
 * - `impl` blocks and `trait` blocks act as containers (like classes)
 * - Closures exist but are not top-level declarations
 */
export class RustTraverser implements LanguageTraverser {
  targetNodeTypes = ['function_item', 'function_signature_item'];

  containerTypes = ['impl_item', 'trait_item'];

  declarationTypes: string[] = [];

  functionTypes = ['closure_expression'];

  shouldExtractChildren(node: SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(_node: SyntaxNode): boolean {
    return false;
  }

  getContainerBody(node: SyntaxNode): SyntaxNode | null {
    if (node.type === 'impl_item' || node.type === 'trait_item') {
      return node.childForFieldName('body');
    }
    return null;
  }

  shouldTraverseChildren(node: SyntaxNode): boolean {
    return (
      node.type === 'source_file' || node.type === 'declaration_list' || node.type === 'mod_item'
    );
  }

  findParentContainerName(node: SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'impl_item') {
        const typeNode = current.childForFieldName('type');
        return typeNode?.text;
      }
      if (current.type === 'trait_item') {
        const nameNode = current.childForFieldName('name');
        return nameNode?.text;
      }
      current = current.parent;
    }
    return undefined;
  }

  findFunctionInDeclaration(_node: SyntaxNode): DeclarationFunctionInfo {
    return {
      hasFunction: false,
      functionNode: null,
    };
  }
}

// =============================================================================
// EXPORT EXTRACTOR
// =============================================================================

/**
 * Rust export extractor
 *
 * Rust uses `pub` visibility to mark items as exported. Items with a
 * `visibility_modifier` child (e.g., `pub`, `pub(crate)`) are considered exports.
 *
 * Exportable items:
 * - pub fn helper() {}
 * - pub struct User {}
 * - pub enum Status {}
 * - pub trait Serialize {}
 * - pub type Alias = ...
 * - pub const VALUE: ... = ...
 * - pub static GLOBAL: ... = ...
 * - pub mod submodule;
 * - pub use other::Thing;  (re-exports)
 */
export class RustExportExtractor implements LanguageExportExtractor {
  private readonly exportableTypes = new Set([
    'function_item',
    'struct_item',
    'enum_item',
    'trait_item',
    'type_item',
    'const_item',
    'static_item',
    'mod_item',
  ]);

  extractExports(rootNode: SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();

    const addExport = (name: string) => {
      if (name && !seen.has(name)) {
        seen.add(name);
        exports.push(name);
      }
    };

    rootNode.namedChildren
      .filter(child => this.hasVisibilityModifier(child))
      .forEach(child => this.extractExportName(child, addExport));

    return exports;
  }

  private extractExportName(node: SyntaxNode, addExport: (name: string) => void): void {
    if (node.type === 'use_declaration') {
      const argument = node.childForFieldName('argument');
      if (argument) {
        const names = this.extractUseExportNames(argument);
        names.forEach(addExport);
      }
      return;
    }

    if (this.exportableTypes.has(node.type)) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addExport(nameNode.text);
    }
  }

  private hasVisibilityModifier(node: SyntaxNode): boolean {
    return node.children.some(child => child.type === 'visibility_modifier');
  }

  /**
   * Extract exported names from a use declaration argument.
   * Handles both simple patterns and list patterns:
   * - `pub use crate::auth::AuthService;` -> ["AuthService"]
   * - `pub use crate::auth::{AuthService, AuthError};` -> ["AuthService", "AuthError"]
   */
  private extractUseExportNames(node: SyntaxNode): string[] {
    if (node.type === 'scoped_identifier') {
      const nameNode = node.childForFieldName('name');
      return nameNode ? [nameNode.text] : [];
    }
    if (node.type === 'identifier') {
      return [node.text];
    }
    if (node.type === 'scoped_use_list') {
      // Find the use_list child and extract symbols
      const useList = node.namedChildren.find(child => child.type === 'use_list');
      if (useList) return extractUseListSymbols(useList);
    }
    return [];
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/**
 * Whether `importerFile`'s basename identifies it as a Rust module-root file
 * (`mod.rs`, or the crate-root files `lib.rs`/`main.rs`) rather than a "leaf"
 * file. Rust's file-to-module convention gives these two shapes DIFFERENT
 * containing-directory semantics — see `resolveRustRelativeModulePath`'s doc
 * comment for why that distinction matters for `self::`/`super::`.
 */
function isRustModuleRootFile(importerFile: string): boolean {
  const base = importerFile.slice(importerFile.lastIndexOf('/') + 1);
  return base === 'mod.rs' || base === 'lib.rs' || base === 'main.rs';
}

/**
 * Directory portion of a forward-slash path. A tiny hand-rolled stand-in for
 * `path.posix.dirname` — importing `node:path` here would collide with this
 * file's own frequently-used `path` parameter name (the raw `use` path
 * string), so a one-line local helper is clearer than an aliased import.
 */
function dirnameOf(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '' : p.slice(0, idx);
}

/** Join a directory (possibly empty, meaning repo root) with a path segment. */
function joinFromDir(dir: string, rest: string): string {
  return dir ? `${dir}/${rest}` : rest;
}

/**
 * Basename of a forward-slash path with its `.rs` extension removed --
 * e.g. `src/foo.rs` -> `foo`. Used only for Rust's leaf-file submodule
 * directory convention (see `rustModOwningDirectory`).
 */
function basenameNoExt(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1);
  return base.replace(/\.rs$/, '');
}

/**
 * The (extensionless) directory a FILE-BACKED `mod_item` (`mod x;`, no body)
 * resolves its sibling module against — Rust's file-to-module convention
 * (#1000). This returns the directory only; `extractModImportPath` joins
 * the mod's own name onto it and returns THAT unresolved-extension
 * specifier as-is — it never appends `.rs`, and it doesn't need to choose
 * between the `x.rs` and `x/mod.rs` on-disk conventions. Downstream
 * matching (`matchesFile`) normalizes both the specifier and every
 * candidate target path by stripping extensions before comparing, so the
 * extensionless specifier exact-matches whichever convention the sibling
 * module actually uses on disk:
 *
 * - A module-root file (`mod.rs`/`lib.rs`/`main.rs`) owns its OWN directory:
 *   `src/main.rs`'s `mod reporter;` -> directory `src`, giving the resolved
 *   specifier `src/reporter` (which normalizes-matches `src/reporter.rs` or
 *   `src/reporter/mod.rs` on disk).
 * - A "leaf" file (any other name, e.g. `src/foo.rs`) owns a SUBDIRECTORY
 *   named after itself: `src/foo.rs`'s `mod bar;` -> directory `src/foo`,
 *   giving `src/foo/bar` — the same 2018+-edition file-plus-sibling-
 *   directory split already documented on `resolveRustRelativeModulePath`
 *   for `self::`/`super::`, but resolved precisely here rather than
 *   approximated.
 * - Each INLINE ancestor `mod` block (`mod outer { mod inner; }` — itself
 *   not file-backed, see `isInlineModDeclaration`) folds its own name in as
 *   a further directory segment, since Rust's directory-ownership rule
 *   treats inline nesting exactly like a subdirectory.
 */
function rustModOwningDirectory(importerFile: string, modNode: SyntaxNode): string {
  const normalizedImporter = importerFile.replace(/\\/g, '/');
  const fileDir = isRustModuleRootFile(normalizedImporter)
    ? dirnameOf(normalizedImporter)
    : joinFromDir(dirnameOf(normalizedImporter), basenameNoExt(normalizedImporter));

  return collectInlineAncestorModNames(modNode).reduce(joinFromDir, fileDir);
}

/**
 * Names of every INLINE `mod_item` ancestor (outermost first) enclosing
 * `node` within the SAME file — i.e. `mod_item`s with a `body`, which
 * `RustTraverser.shouldTraverseChildren` already treats as pass-through
 * containers for symbol extraction. A file-backed ancestor (no body) can't
 * occur here: its content lives in a different file entirely, parsed as its
 * own chunk, so this never walks across a file boundary.
 */
function collectInlineAncestorModNames(node: SyntaxNode): string[] {
  const names: string[] = [];
  let current = node.parent;
  while (current) {
    if (current.type === 'mod_item') {
      const nameNode = current.childForFieldName('name');
      if (nameNode) names.unshift(nameNode.text);
    }
    current = current.parent;
  }
  return names;
}

/**
 * Whether a `mod_item` node declares an inline module body (`mod x { ... }`)
 * rather than a file-backed declaration (`mod x;`). An inline module is a
 * namespace, not an import — it has no separate file and must NOT produce a
 * dependency edge (see `extractModImportPath`'s doc comment, #1000).
 */
function isInlineModDeclaration(node: SyntaxNode): boolean {
  return node.childForFieldName('body') !== null;
}

/**
 * `#[path = "..."]` overrides the default sibling-file lookup for a single
 * `mod_item`. tree-sitter-rust attaches attributes as PRECEDING SIBLINGS of
 * the item they annotate (not children of it), so this walks backward
 * through the contiguous run of `attribute_item`s immediately before
 * `modNode` — there can be more than one (`#[cfg(test)] #[path = "..."]
 * mod x;`) — looking for one shaped like `path = "<value>"`. Returns null
 * (falls through to the default sibling-file convention) if none is found;
 * this is the "at least don't crash on it" floor #1000 asks for, not full
 * attribute-macro support.
 */
function findPathAttributeOverride(modNode: SyntaxNode): string | null {
  const parent = modNode.parent;
  if (!parent) return null;
  const siblings = parent.namedChildren;
  const index = siblings.indexOf(modNode);
  if (index === -1) return null;

  for (const sibling of siblings.slice(0, index).reverse()) {
    if (sibling.type !== 'attribute_item') break;
    const override = extractPathAttributeValue(sibling);
    if (override) return override;
  }
  return null;
}

/** The `"<value>"` of a single `attribute_item` shaped like `#[path = "..."]`, or null. */
function extractPathAttributeValue(attributeItem: SyntaxNode): string | null {
  const attribute = attributeItem.namedChildren.find(child => child.type === 'attribute');
  if (!attribute) return null;
  if (attribute.namedChildren[0]?.text !== 'path') return null;

  const valueNode = attribute.childForFieldName('value');
  const stringContent = valueNode?.namedChildren.find(child => child.type === 'string_content');
  return stringContent?.text ?? null;
}

/**
 * Resolve a FILE-BACKED `mod_item` (`mod x;`, no body) to the
 * directory-anchored, extensionless module path it declares (e.g.
 * `src/reporter` for `src/main.rs`'s `mod reporter;` — see
 * `rustModOwningDirectory`'s doc comment for exactly what that specifier
 * does and doesn't resolve to on disk).
 *
 * The trap this deliberately avoids (#1000, closed against #928/#884): an
 * UNANCHORED bare specifier like `reporter` (no directory prefix at all)
 * requires downstream fuzzy bare-module matching to guess which file it
 * means, which is exactly the language-blind fabrication #928 was closed to
 * prevent. A Rust `mod x;` is NOT ambiguous like that — it's a declaration
 * that resolves deterministically to one specific sibling module relative
 * to the declaring file — so this anchors it to that module's real
 * directory up front (`rustModOwningDirectory` + `#[path]` override) and
 * returns the result directly, the same way
 * `resolveRustRelativeModulePath` already resolves `self::`/`super::`
 * precisely instead of leaving them for the generic bare-word matcher.
 *
 * Returns null for an inline module (has a body — no separate file, no
 * edge) or when there's no `importerFile` to resolve against.
 */
function extractModImportPath(node: SyntaxNode, importerFile?: string): string | null {
  if (isInlineModDeclaration(node) || !importerFile) return null;

  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const pathOverride = findPathAttributeOverride(node);
  if (pathOverride) {
    const normalizedImporter = importerFile.replace(/\\/g, '/');
    return joinFromDir(dirnameOf(normalizedImporter), pathOverride.replace(/\.rs$/, ''));
  }

  return joinFromDir(rustModOwningDirectory(importerFile, node), nameNode.text);
}

/**
 * Resolve a `self::`/`super::`-relative Rust module path against the
 * importing file's own location (#928).
 *
 * Before this, `self::`/`super::` were stripped down to a directory-less (or
 * merely `../`-prefixed) string with no knowledge of the importer's real
 * location — `matchesFile`'s generic bare-identifier leniency (designed for
 * the legitimate `crate::auth` -> `src/auth.rs` convention) then had to guess,
 * and could coincidentally match a same-named file anywhere else with a
 * single leading directory (e.g. a Rust benchmark `benches/copy.rs` fuzzy-
 * matching an unrelated sibling module reached via `self::copy`). Resolving
 * to the real path up front means the generic matcher never sees an
 * ambiguous bare word for these two keywords at all.
 *
 * Rust's file-to-module mapping means `self::`/`super::` resolve differently
 * depending on whether `importerFile` is itself a module-root file
 * (`mod.rs`/`lib.rs`/`main.rs`, representing its OWN containing directory) or
 * a "leaf" file (e.g. `copy_bidirectional.rs`, representing a module nested
 * one level INSIDE its containing directory):
 *
 * - `self::X` from a module-root file -> `<its directory>/X` (a sibling
 *   inside the same directory the mod.rs/lib.rs/main.rs itself lives in).
 * - `super::X` from a module-root file -> `<parent of its directory>/X` —
 *   its enclosing module lives one directory up.
 * - `super::X` from a leaf file -> `<its directory>/X` — a leaf file's own
 *   containing directory already IS its parent module's location (exactly
 *   what `self::` from THAT parent's own mod.rs would resolve to), so no
 *   directory traversal is needed.
 * - `self::X` from a leaf file names a genuine CHILD of the leaf file's own
 *   module, which on disk lives one directory *deeper* (a subdirectory named
 *   after the leaf file, Rust's 2018+-edition file-plus-sibling-directory
 *   split) — a real but rare shape this function does not model precisely;
 *   it falls back to the same directory as an approximation. That's still
 *   strictly more precise (same-directory scope) than the pre-#928 behavior
 *   (any matching bare word anywhere in the repo), so this is a safe
 *   approximation even when it isn't exact.
 *
 * @param importerFile - Workspace-relative path of the file containing the
 *   `use` declaration.
 * @param keyword - Which relative keyword produced `rest`.
 * @param rest - The path following `self::`/`super::`, already `::`-to-`/`
 *   converted (e.g. `copy` or `copy/CopyBuffer`).
 */
function resolveRustRelativeModulePath(
  importerFile: string,
  keyword: 'self' | 'super',
  rest: string,
): string {
  const normalizedImporter = importerFile.replace(/\\/g, '/');
  const importerDir = dirnameOf(normalizedImporter);
  const moduleDir =
    keyword === 'super' && isRustModuleRootFile(normalizedImporter)
      ? dirnameOf(importerDir)
      : importerDir;
  return joinFromDir(moduleDir, rest);
}

/**
 * Convert a Rust module path to a relative file path.
 *
 * - `crate::auth::middleware` -> `auth/middleware`
 * - `self::config` -> `config` (or, with `importerFile`, resolved precisely
 *   against the importer's own directory — see `resolveRustRelativeModulePath`)
 * - `super::utils` -> `../utils` (ditto)
 * - `std::io` -> null (external crate, skip)
 * - `tokio_util::codec::Framed` -> `tokio-util/src/codec/Framed`, but ONLY
 *   when `rustCrateMap` identifies `tokio_util` as a known workspace member
 *   crate (#903) — otherwise falls through to the same "external crate,
 *   skip" outcome as before this fix, so a project with no manifest-declared
 *   crate map (or a genuinely external crates.io dependency) sees zero
 *   behavior change. See `../../rust-crate-map.ts` for how the map is built
 *   and matched.
 *
 * @param path - The raw `use` path (never itself a bare `crate`/`self`/`super`
 *   keyword — see `isBareRootToken`'s callers, which combine that case with
 *   the following segment before calling this function).
 * @param rustCrateMap - Map of workspace crate name (underscore form) ->
 *   crate `src/` dir. Undefined/empty for every project without a resolvable
 *   Cargo workspace/package manifest.
 * @param importerFile - Workspace-relative path of the file containing this
 *   `use` declaration (#928). When provided, `self::`/`super::` resolve
 *   precisely via `resolveRustRelativeModulePath` instead of the old
 *   directory-less/pseudo-relative string. Omitted callers (and any caller
 *   predating #928) keep the exact previous behavior.
 */
function convertRustModulePath(
  path: string,
  rustCrateMap?: ReadonlyMap<string, string>,
  importerFile?: string,
): string | null {
  // Remove leading `crate::`, `self::`, or `super::`
  if (path.startsWith('crate::')) {
    return path.slice('crate::'.length).replace(/::/g, '/');
  }
  if (path.startsWith('self::')) {
    const rest = path.slice('self::'.length).replace(/::/g, '/');
    return importerFile ? resolveRustRelativeModulePath(importerFile, 'self', rest) : rest;
  }
  if (path.startsWith('super::')) {
    const rest = path.slice('super::'.length).replace(/::/g, '/');
    return importerFile ? resolveRustRelativeModulePath(importerFile, 'super', rest) : '../' + rest;
  }
  // Not crate/self/super-relative — resolve against a known workspace crate
  // (#903), or treat as a genuinely external crate (skip) when it isn't one.
  return resolveRustCrateImport(path, rustCrateMap);
}

/**
 * tree-sitter-rust gives the bare `crate`/`self`/`super` path-root keywords
 * their own named node types (equal to the keyword text) rather than folding
 * them into a `scoped_identifier`. `convertRustModulePath` only recognizes
 * these keywords as `crate::`/`self::`/`super::` *prefixes* (it string-matches
 * on the `::`), so a bare root — with nothing textually following it — never
 * matches and is misread as an external crate.
 */
const BARE_ROOT_TYPES = new Set(['crate', 'self', 'super']);

function isBareRootToken(node: SyntaxNode): boolean {
  return BARE_ROOT_TYPES.has(node.type);
}

/**
 * The first `use_list` item's own path, prefixed with the bare root's text —
 * e.g. for `use crate::{auth::AuthService, config::Settings}`, the root is
 * `crate` and the first item is `auth::AuthService`, giving `crate::auth`.
 * For a flat item with no further path (`use crate::{Foo, Bar}`), gives
 * `crate::Foo`.
 */
function firstBareRootItemPath(pathNode: SyntaxNode, useList: SyntaxNode): string | null {
  const firstItem = useList.namedChildren[0];
  if (!firstItem) return null;
  if (firstItem.type === 'identifier') return `${pathNode.text}::${firstItem.text}`;
  if (firstItem.type === 'scoped_identifier') {
    const itemPath = firstItem.childForFieldName('path')?.text;
    return itemPath ? `${pathNode.text}::${itemPath}` : null;
  }
  return null;
}

/**
 * Extract the module path prefix from a scoped use argument.
 * For `crate::auth::AuthService`, returns `crate::auth`.
 * For `crate::auth::{A, B}`, returns `crate::auth`.
 *
 * When the shared root is a BARE `crate`/`self`/`super` keyword with no
 * further `::` segment (`use crate::{auth::AuthService, config::Settings};`),
 * there's no prefix for `convertRustModulePath` to strip and the group's
 * items point at genuinely different modules. Falls back to
 * `GoImportExtractor`'s "first wins" precedent for its own multi-target
 * grouped imports (see `import_spec_list` handling in go.ts) rather than
 * dropping the whole declaration — full multi-target support needs a
 * broader change, since `extractImportPath` returns one path per node (see
 * the "grouped imports" tracking issue).
 */
function extractScopePath(node: SyntaxNode): string | null {
  const pathNode = node.childForFieldName('path');
  if (!pathNode) return null;
  if (!isBareRootToken(pathNode)) return pathNode.text;

  const useList = node.namedChildren.find(child => child.type === 'use_list');
  return useList ? firstBareRootItemPath(pathNode, useList) : null;
}

/**
 * Extract the symbol name from a use_as_clause node.
 * Prefers the alias if present, otherwise takes the last identifier.
 */
function extractUseAsClauseSymbol(node: SyntaxNode): string | null {
  const alias = node.childForFieldName('alias');
  if (alias) return alias.text;

  // Fallback: take the last identifier
  const identifiers = node.namedChildren.filter(child => child.type === 'identifier');
  return identifiers.length > 0 ? identifiers[identifiers.length - 1].text : null;
}

/**
 * Extract the symbol name from a single use_list item.
 */
function extractUseListItemSymbol(item: SyntaxNode): string | null {
  switch (item.type) {
    case 'identifier':
      return item.text;
    case 'scoped_identifier':
      return item.childForFieldName('name')?.text ?? null;
    case 'use_as_clause':
      return extractUseAsClauseSymbol(item);
    case 'use_wildcard':
      return '*';
    default:
      return null;
  }
}

/**
 * Extract imported symbol names from a use_list node.
 * Handles: identifier, scoped_identifier, use_as_clause, use_wildcard
 */
function extractUseListSymbols(useList: SyntaxNode): string[] {
  return useList.namedChildren
    .map(item => extractUseListItemSymbol(item))
    .filter((symbol): symbol is string => symbol !== null);
}

/**
 * Rust import extractor
 *
 * Handles all `use` declarations (not just `pub use`) — every `use` creates
 * a dependency — AND file-backed `mod` declarations (`mod x;`/`pub mod x;`,
 * #1000): the idiomatic Rust pattern of `mod x;` at the crate root plus
 * qualified calls (`x::func()`) with no `use` at all otherwise produces no
 * edge whatsoever. See `extractModImportPath` for how a `mod` declaration is
 * resolved to a directory-anchored, extensionless module path rather than
 * an ambiguous bare specifier. An INLINE `mod x { ... }` (has a body) is a namespace, not an
 * import, and correctly produces no edge for itself — see
 * `isInlineModDeclaration`.
 *
 * Examples:
 * - `use crate::auth::AuthService;`
 * - `use crate::auth::{AuthService, AuthError};`
 * - `use crate::auth::Service as Auth;`
 * - `use crate::models::*;`
 * - `use std::io::Read;` (external - skipped)
 * - `use super::utils::helper;`
 * - `mod reporter;` -> `<owning dir>/reporter` (#1000)
 * - `pub mod reporter;` -> same as above; visibility doesn't affect whether
 *   the sibling file is a real dependency
 * - `mod tests { ... }` -> no edge (inline, no separate file)
 */
export class RustImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['use_declaration', 'mod_item'];

  extractImportPath(
    node: SyntaxNode,
    rustCrateMap?: ReadonlyMap<string, string>,
    importerFile?: string,
  ): string | null {
    if (node.type === 'mod_item') return extractModImportPath(node, importerFile);

    const argument = node.childForFieldName('argument');
    if (!argument) return null;

    const fullPath = this.resolveFullPath(argument);
    return fullPath ? convertRustModulePath(fullPath, rustCrateMap, importerFile) : null;
  }

  extractImportPaths(
    node: SyntaxNode,
    rustCrateMap?: ReadonlyMap<string, string>,
    importerFile?: string,
  ): string[] {
    return toImportPathsArray(this.extractImportPath(node, rustCrateMap, importerFile));
  }

  processImportSymbols(
    node: SyntaxNode,
    rustCrateMap?: ReadonlyMap<string, string>,
    importerFile?: string,
  ): { importPath: string; symbols: string[] } | null {
    if (node.type === 'mod_item') {
      // A `mod x;` brings the whole module namespace into scope (consumers
      // then use qualified `x::func()` calls) rather than naming specific
      // symbols, the same "whole module" shape as `use crate::models::*;` —
      // see `processUseWildcard` below.
      const importPath = extractModImportPath(node, importerFile);
      return importPath ? { importPath, symbols: ['*'] } : null;
    }

    const argument = node.childForFieldName('argument');
    if (!argument) return null;

    return this.processUseArgument(argument, rustCrateMap, importerFile);
  }

  processImportSymbolsList(
    node: SyntaxNode,
    rustCrateMap?: ReadonlyMap<string, string>,
    importerFile?: string,
  ): Array<{ importPath: string; symbols: string[] }> {
    return toImportSymbolsArray(this.processImportSymbols(node, rustCrateMap, importerFile));
  }

  private processUseArgument(
    node: SyntaxNode,
    rustCrateMap?: ReadonlyMap<string, string>,
    importerFile?: string,
  ): { importPath: string; symbols: string[] } | null {
    // Simple: `use crate::auth::AuthService;`
    if (node.type === 'scoped_identifier') {
      return this.processScopedIdentifier(node, rustCrateMap, importerFile);
    }

    // List: `use crate::auth::{AuthService, AuthError};`
    if (node.type === 'scoped_use_list') {
      return this.processScopedUseList(node, rustCrateMap, importerFile);
    }

    // Alias: `use crate::auth::Service as Auth;`
    if (node.type === 'use_as_clause') {
      return this.processUseAsClause(node, rustCrateMap, importerFile);
    }

    // Wildcard: `use crate::models::*;`
    if (node.type === 'use_wildcard') {
      return this.processUseWildcard(node, rustCrateMap, importerFile);
    }

    // Direct identifier (rare): `use SomeItem;`
    if (node.type === 'identifier') {
      return null; // External or ambient, skip
    }

    return null;
  }

  private processScopedIdentifier(
    node: SyntaxNode,
    rustCrateMap?: ReadonlyMap<string, string>,
    importerFile?: string,
  ): { importPath: string; symbols: string[] } | null {
    const pathNode = node.childForFieldName('path');
    const nameNode = node.childForFieldName('name');
    if (!pathNode || !nameNode) return null;

    // `use crate::config;` / `use self::config;` / `use super::config;` — a
    // single segment directly off a BARE root has no further module prefix
    // for convertRustModulePath's `crate::`/`self::`/`super::` string-match to
    // strip (see `isBareRootToken`). The referenced module IS the imported
    // name itself, so combine root + name before converting (mirrors what
    // `resolveFullPath`/`extractImportPath` already derive from the whole
    // node's text for this same statement).
    const modulePath = isBareRootToken(pathNode)
      ? convertRustModulePath(`${pathNode.text}::${nameNode.text}`, rustCrateMap, importerFile)
      : convertRustModulePath(pathNode.text, rustCrateMap, importerFile);
    if (!modulePath) return null;

    return { importPath: modulePath, symbols: [nameNode.text] };
  }

  private processScopedUseList(
    node: SyntaxNode,
    rustCrateMap?: ReadonlyMap<string, string>,
    importerFile?: string,
  ): { importPath: string; symbols: string[] } | null {
    const scopePath = extractScopePath(node);
    if (!scopePath) return null;

    const modulePath = convertRustModulePath(scopePath, rustCrateMap, importerFile);
    if (!modulePath) return null;

    const useList = node.namedChildren.find(child => child.type === 'use_list');
    if (!useList) return null;

    // Bare-root groups (`use crate::{auth::AuthService, config::Settings}`)
    // only resolved `modulePath` from the FIRST item (see `extractScopePath`),
    // so — mirroring `extractImportPath` — only that first item's own symbol
    // is returned here, not the whole use_list, to avoid misattributing later
    // items (e.g. `Settings`) to the wrong module (`auth`, not `config`).
    const pathNode = node.childForFieldName('path');
    if (pathNode && isBareRootToken(pathNode)) {
      const firstItem = useList.namedChildren[0];
      const firstSymbol = firstItem ? extractUseListItemSymbol(firstItem) : null;
      return firstSymbol ? { importPath: modulePath, symbols: [firstSymbol] } : null;
    }

    const symbols = extractUseListSymbols(useList);
    return symbols.length > 0 ? { importPath: modulePath, symbols } : null;
  }

  private processUseAsClause(
    node: SyntaxNode,
    rustCrateMap?: ReadonlyMap<string, string>,
    importerFile?: string,
  ): { importPath: string; symbols: string[] } | null {
    // `use crate::auth::Service as Auth;`
    // The first child is the path (scoped_identifier), alias field has the alias
    const aliasNode = node.childForFieldName('alias');
    const pathChild = node.namedChildren.find(child => child.type === 'scoped_identifier');
    if (!pathChild) return null;

    const scopePathNode = pathChild.childForFieldName('path');
    if (!scopePathNode) return null;

    const modulePath = convertRustModulePath(scopePathNode.text, rustCrateMap, importerFile);
    if (!modulePath) return null;

    const symbol = aliasNode?.text || pathChild.childForFieldName('name')?.text;
    if (!symbol) return null;

    return { importPath: modulePath, symbols: [symbol] };
  }

  private processUseWildcard(
    node: SyntaxNode,
    rustCrateMap?: ReadonlyMap<string, string>,
    importerFile?: string,
  ): { importPath: string; symbols: string[] } | null {
    // `use crate::models::*;` -> AST is:
    //   use_wildcard
    //     scoped_identifier (crate::models)
    //     *
    // Find the scoped_identifier child to get the path
    const scopedId = node.namedChildren.find(child => child.type === 'scoped_identifier');
    if (!scopedId) return null;

    const modulePath = convertRustModulePath(scopedId.text, rustCrateMap, importerFile);
    if (!modulePath) return null;
    return { importPath: modulePath, symbols: ['*'] };
  }

  /**
   * Resolve the full path of a use argument for the imports list.
   * Returns the full `crate::...` path or similar.
   */
  private resolveFullPath(node: SyntaxNode): string | null {
    if (node.type === 'scoped_identifier') {
      return node.text;
    }
    if (node.type === 'scoped_use_list') {
      return extractScopePath(node);
    }
    if (node.type === 'use_as_clause') {
      // Find the scoped_identifier inside
      const scopedId = node.namedChildren.find(child => child.type === 'scoped_identifier');
      return scopedId?.text ?? null;
    }
    if (node.type === 'use_wildcard') {
      // use_wildcard contains a scoped_identifier child, not a 'path' field
      const scopedId = node.namedChildren.find(child => child.type === 'scoped_identifier');
      return scopedId?.text ?? null;
    }
    return null;
  }
}

// =============================================================================
// SYMBOL EXTRACTOR
// =============================================================================

/**
 * Rust symbol extractor
 *
 * Handles:
 * - function_item (fn foo() {})
 * - function_signature_item (fn foo(); in traits)
 * - impl_item (impl Foo {}) - treated as class equivalent
 * - trait_item (trait Foo {}) - treated as interface equivalent
 *
 * Call sites: call_expression (foo()), macro_invocation (println!())
 */
export class RustSymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = [
    'function_item',
    'function_signature_item',
    'impl_item',
    'trait_item',
  ];

  extractSymbol(node: SyntaxNode, content: string, parentClass?: string): SymbolInfo | null {
    switch (node.type) {
      case 'function_item':
      case 'function_signature_item':
        return this.extractFunctionInfo(node, content, parentClass);
      case 'impl_item':
        return this.extractImplInfo(node);
      case 'trait_item':
        return this.extractTraitInfo(node);
      default:
        return null;
    }
  }

  extractCallSite(node: SyntaxNode): { symbol: string; line: number; key: string } | null {
    const line = node.startPosition.row + 1;

    // call_expression: foo(), obj.method()
    if (node.type === 'call_expression') {
      const funcNode = node.childForFieldName('function');
      if (!funcNode) return null;

      if (funcNode.type === 'identifier') {
        return { symbol: funcNode.text, line, key: `${funcNode.text}:${line}` };
      }

      // field_expression: obj.method()
      if (funcNode.type === 'field_expression') {
        const fieldNode = funcNode.childForFieldName('field');
        if (fieldNode?.type === 'field_identifier') {
          return { symbol: fieldNode.text, line, key: `${fieldNode.text}:${line}` };
        }
      }

      // scoped_identifier: module::function(), Type::method()
      if (funcNode.type === 'scoped_identifier') {
        const nameNode = funcNode.childForFieldName('name');
        if (nameNode) {
          return { symbol: nameNode.text, line, key: `${nameNode.text}:${line}` };
        }
      }

      return null;
    }

    // macro_invocation: println!(), vec![]
    if (node.type === 'macro_invocation') {
      const macroNode = node.childForFieldName('macro');
      if (macroNode?.type === 'identifier') {
        const symbol = `${macroNode.text}!`;
        return { symbol, line, key: `${symbol}:${line}` };
      }
    }

    return null;
  }

  private extractFunctionInfo(
    node: SyntaxNode,
    content: string,
    parentClass?: string,
  ): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: parentClass ? 'method' : 'function',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: extractSignature(node, content),
      parameters: extractParameters(node, content),
      returnType: extractReturnType(node, content),
      complexity: calculateComplexity(node),
    };
  }

  /**
   * `impl<T> Trait for Type<T>` — the trait being implemented (if any) is
   * arguably the single most useful fact about an impl block (which
   * behavior it provides), and the generic parameters distinguish a
   * blanket/generic impl from a concrete one; `signature` used to report
   * neither, just `impl Type`. `type`, `trait`, and `type_parameters` are
   * all registered fields on `impl_item`. Deliberately excludes the
   * trailing `where_clause` (an unnamed child, not a field) — same
   * out-of-scope call as C#'s generic constraints. Each piece is passed
   * through `collapseWhitespace` in case it spans multiple physical lines.
   */
  private extractImplInfo(node: SyntaxNode): SymbolInfo | null {
    const typeNode = node.childForFieldName('type');
    if (!typeNode) return null;

    const typeParams = collapseWhitespace(node.childForFieldName('type_parameters')?.text);
    const traitNode = node.childForFieldName('trait');
    const typeText = collapseWhitespace(typeNode.text);
    const signature = traitNode
      ? `impl${typeParams} ${collapseWhitespace(traitNode.text)} for ${typeText}`
      : `impl${typeParams} ${typeText}`;

    return {
      name: typeNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: clampSignatureLength(signature),
    };
  }

  /**
   * `trait Foo<T>: Bar + Baz` — `bounds` (supertraits) and `type_parameters`
   * are both registered fields on `trait_item`; `bounds.text` already
   * includes its leading `:` (e.g. `": Bar + Baz"`). Each piece is passed
   * through `collapseWhitespace` in case it spans multiple physical lines.
   */
  private extractTraitInfo(node: SyntaxNode): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const typeParams = collapseWhitespace(node.childForFieldName('type_parameters')?.text);
    // `bounds.text` already includes its leading ": " (e.g. ": Bar + Baz"),
    // so no extra space is added here — matches Rust style (`Foo<T>: Bar`),
    // unlike C#/Kotlin, which conventionally put a space before the colon.
    const bounds = collapseWhitespace(node.childForFieldName('bounds')?.text);

    return {
      name: nameNode.text,
      type: 'interface',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: clampSignatureLength(`trait ${nameNode.text}${typeParams}${bounds}`),
    };
  }
}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const rustDefinition: LanguageDefinition = {
  id: 'rust',
  extensions: ['rs'],
  traverser: new RustTraverser(),
  exportExtractor: new RustExportExtractor(),
  importExtractor: new RustImportExtractor(),
  symbolExtractor: new RustSymbolExtractor(),

  complexity: {
    decisionPoints: [
      'if_expression',
      'match_expression',
      'while_expression',
      'for_expression',
      'loop_expression',
      'match_arm',
      'binary_expression',
    ],
    nestingTypes: [
      'if_expression',
      'for_expression',
      'while_expression',
      'loop_expression',
      'match_expression',
    ],
    nonNestingTypes: ['else_clause', 'match_arm'],
    lambdaTypes: ['closure_expression'],
    operatorSymbols: new Set([
      '+',
      '-',
      '*',
      '/',
      '%',
      '==',
      '!=',
      '<',
      '>',
      '<=',
      '>=',
      '=',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
      '&=',
      '|=',
      '^=',
      '<<=',
      '>>=',
      '&',
      '|',
      '^',
      '!',
      '<<',
      '>>',
      '.',
      '::',
      '..',
      '..=',
      '=>',
      '->',
      '?',
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
    ]),
    operatorKeywords: new Set([
      'if',
      'else',
      'match',
      'for',
      'while',
      'loop',
      'return',
      'break',
      'continue',
      'let',
      'mut',
      'fn',
      'struct',
      'enum',
      'impl',
      'trait',
      'pub',
      'mod',
      'use',
      'as',
      'async',
      'await',
      'unsafe',
      'where',
      'move',
      'ref',
      'self',
      'super',
      'crate',
      'dyn',
      'type',
    ]),
  },

  symbols: {
    callExpressionTypes: ['call_expression', 'macro_invocation'],
  },
};

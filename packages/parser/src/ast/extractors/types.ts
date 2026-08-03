import type { SymbolInfo, SyntaxNode } from '../types.js';

/**
 * Language-specific symbol extraction strategy
 *
 * Each language has different AST node types for functions, classes, and methods.
 * This interface allows language-specific symbol extraction while keeping the
 * core chunking logic language-agnostic.
 */
export interface LanguageSymbolExtractor {
  /** AST node types this extractor can handle for symbol extraction */
  readonly symbolNodeTypes: string[];

  /** Extract symbol info (name, type, signature, etc.) from an AST node */
  extractSymbol(node: SyntaxNode, content: string, parentClass?: string): SymbolInfo | null;

  /** Extract symbol name and line from a call expression node */
  extractCallSite(node: SyntaxNode): { symbol: string; line: number; key: string } | null;
}

/**
 * Language-specific export extraction strategy
 *
 * Each language has different export semantics:
 * - JavaScript/TypeScript: Explicit export statements
 * - PHP: All top-level declarations are implicitly exported
 * - Python: All module-level declarations are implicitly exported
 *
 * This interface allows us to implement language-specific export extraction
 * while keeping the core symbol extraction logic language-agnostic.
 *
 * @example JavaScript/TypeScript
 * ```typescript
 * export function validateEmail() {}  // Explicit export
 * export { foo, bar }                 // Named exports
 * export default App                  // Default export
 * ```
 *
 * @example PHP
 * ```php
 * class User {}        // Implicitly exported
 * function helper() {} // Implicitly exported
 * ```
 *
 * @example Python
 * ```python
 * class User:          # Implicitly exported
 *     pass
 * def helper():        # Implicitly exported
 *     pass
 * ```
 */
export interface LanguageExportExtractor {
  /**
   * Extract exported symbol names from an AST root node
   *
   * For JavaScript/TypeScript: Processes explicit export statements
   * For PHP/Python: Processes top-level declarations (implicitly exported)
   *
   * @param rootNode - AST root node (typically 'program' or similar)
   * @returns Array of exported symbol names (deduplicated)
   *
   * @example
   * ```typescript
   * // For: export { foo, bar }; export default App;
   * extractExports(rootNode) // => ['foo', 'bar', 'default']
   * ```
   */
  extractExports(rootNode: SyntaxNode): string[];
}

/**
 * Language-specific import extraction strategy
 *
 * Each language has different import semantics:
 * - JavaScript/TypeScript: import/export statements with source paths
 * - PHP: namespace use declarations
 * - Python: import/from...import statements with dotted paths
 * - Rust: use declarations with crate/self/super paths
 *
 * This interface allows language-specific import extraction while
 * keeping the core symbol extraction logic language-agnostic.
 */
export interface LanguageImportExtractor {
  /**
   * AST node types that represent import statements in this language.
   * Used to identify which top-level nodes to process.
   */
  readonly importNodeTypes: string[];

  /**
   * Extract the import path from an import node for the imports list.
   *
   * For a declaration that groups multiple distinct targets (e.g. Go's
   * `import ( "a"; "b" )`), this returns only the FIRST one — see
   * `extractImportPaths` for the complete, order-preserving form. Kept
   * as-is (not derived from `extractImportPaths`'s result in the
   * interface contract itself) because most languages have exactly one
   * target per declaration and existing per-language tests pin this
   * exact "first" behavior.
   *
   * @param node - AST node matching one of importNodeTypes
   * @returns The import path string, or null to skip
   */
  extractImportPath(node: SyntaxNode): string | null;

  /**
   * Extract ALL import targets from a single import declaration node.
   *
   * Most languages have exactly one target per declaration, so the
   * default shape is `extractImportPath(node)` wrapped in an array (see
   * `toImportPathsArray`). Go's grouped `import (...)` blocks can name
   * several distinct external packages from one declaration node — its
   * implementation overrides this to return every target instead of
   * silently dropping all but the first (see #863).
   *
   * @param node - AST node matching one of importNodeTypes
   * @param rustCrateMap - Rust-only (#903): map of workspace crate name
   *   (underscore form) -> crate `src/` dir, from `resolveRustCrateMap`.
   *   Every other language's implementation ignores this parameter — Rust's
   *   own extractor is the only one that needs to resolve a bare `use` root
   *   against a workspace crate BEFORE deciding whether the import is
   *   internal or external, which (unlike PHP/Go) happens inside the
   *   extractor itself rather than as post-processing in `ast/symbols.ts`.
   * @param importerFile - Rust-only (#928): workspace-relative path of the
   *   file containing this `use` declaration. Rust's `self::`/`super::`
   *   resolve relative to the IMPORTER's own location, but which directory
   *   that means depends on Rust's file-to-module convention (a `mod.rs`
   *   represents its own containing directory; any other file represents a
   *   module nested one level inside it) — this can't be decided by the
   *   generic `./`/`../` relative-import resolution every other language
   *   uses (see `ast/chunker.ts`'s `RESOLVE_RELATIVE_IMPORTS` doc comment),
   *   so Rust's own extractor resolves it directly instead. Every other
   *   language's implementation ignores this parameter.
   * @returns Every import path declared by this node, in source order (empty if none)
   */
  extractImportPaths(
    node: SyntaxNode,
    rustCrateMap?: ReadonlyMap<string, string>,
    importerFile?: string,
  ): string[];

  /**
   * Extract imported symbols mapped to their source path.
   *
   * @param node - AST node matching one of importNodeTypes
   * @param rustCrateMap - Rust-only (#903) — see `extractImportPaths`.
   * @param importerFile - Rust-only (#928) — see `extractImportPaths`.
   * @param workspaceRoot - Rust-only (#1056): absolute project root, needed
   *   to resolve a bare crate-root import (`use crate_name::Symbol;`, no
   *   submodule path) to the specific file that declares `Symbol`, via a
   *   crate-root export lookup (`../../rust-crate-exports.ts`), rather than
   *   fabricating a match against every file the crate contains. Every
   *   other language's implementation ignores this parameter.
   * @returns Object with importPath and symbols, or null to skip
   */
  processImportSymbols(
    node: SyntaxNode,
    rustCrateMap?: ReadonlyMap<string, string>,
    importerFile?: string,
    workspaceRoot?: string,
  ): { importPath: string; symbols: string[] } | null;

  /**
   * Extract ALL imported-symbol mappings from a single import declaration node.
   *
   * Most languages have exactly one importPath per declaration, so the
   * default shape is `processImportSymbols(node)` wrapped in an array (see
   * `toImportSymbolsArray`). Go's grouped `import (...)` blocks can name
   * several distinct external packages from one declaration node -- the
   * same multi-target shape `extractImportPaths` already handles for the
   * plain-path list (#863) -- so its implementation overrides this to
   * return every target's symbols instead of silently dropping all but the
   * first non-stdlib spec, which otherwise leaves `chunk.metadata.
   * importedSymbols` missing an entry for every import after the first in
   * the same declaration (confirmed on real gin source: `render/json.go`'s
   * grouped import names both `codec/json` and `internal/bytesconv`, but
   * the pre-fix singular `processImportSymbols` only ever recorded
   * `codec/json`).
   *
   * @param node - AST node matching one of importNodeTypes
   * @param rustCrateMap - Rust-only (#903) -- see `extractImportPaths`.
   * @param importerFile - Rust-only (#928) -- see `extractImportPaths`.
   * @param workspaceRoot - Rust-only (#1056) -- see `processImportSymbols`.
   * @returns Every {importPath, symbols} pair declared by this node, in source order (empty if none)
   */
  processImportSymbolsList(
    node: SyntaxNode,
    rustCrateMap?: ReadonlyMap<string, string>,
    importerFile?: string,
    workspaceRoot?: string,
  ): Array<{ importPath: string; symbols: string[] }>;

  /**
   * Extract additional "reference" import-like specifiers that name another
   * file's symbol WITHOUT going through this language's own import-
   * declaration syntax at all — so declaration-based extraction (the
   * `importNodeTypes` walk above) is structurally blind to them.
   *
   * PHP's motivating case (#878): a fully-qualified class name (`new
   * \Foo\Bar\Baz(...)`, `\Foo\Bar\Baz::class`, `\Foo\Bar\Baz::method()`)
   * never requires a `use` statement — PHP resolves a leading-`\` name as
   * absolute regardless of what's imported — so a test file can genuinely
   * reference a source class with zero corresponding
   * `namespace_use_declaration` node anywhere in the file.
   *
   * Optional: most languages have no such construct and simply omit this
   * method. Callers (`extractImportPaths` in `ast/symbols.ts`) treat a
   * missing implementation as "no additional references" — a no-op, so
   * every existing language and caller sees zero behavior change.
   *
   * @param rootNode - AST root node for the whole file. Unlike the
   *   declaration-based walk (which only looks at the top one-or-two levels
   *   from the root), implementations of this method are expected to scan
   *   the entire file recursively, since these references can appear
   *   anywhere in a function/method body.
   * @returns Extra raw specifiers, in the same pre-resolution form
   *   `extractImportPaths` returns — subject to the same downstream
   *   resolution pipeline (relative-import / workspace-package /
   *   manifest-root resolution).
   */
  extractReferencedFQCNs?(rootNode: SyntaxNode): string[];
}

/**
 * Default `extractImportPaths` shape for every language extractor that has
 * exactly one import target per declaration node: wrap `extractImportPath`'s
 * single result in an array (empty when it returns `null`). See
 * `LanguageImportExtractor.extractImportPaths`.
 */
export function toImportPathsArray(path: string | null): string[] {
  return path ? [path] : [];
}

/**
 * Default `processImportSymbolsList` shape for every language extractor that
 * has exactly one importPath per declaration node: wrap `processImportSymbols`'s
 * single result in an array (empty when it returns `null`). See
 * `LanguageImportExtractor.processImportSymbolsList`.
 */
export function toImportSymbolsArray(
  result: { importPath: string; symbols: string[] } | null,
): Array<{ importPath: string; symbols: string[] }> {
  return result ? [result] : [];
}

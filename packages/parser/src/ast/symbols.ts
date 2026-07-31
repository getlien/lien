import type { SymbolInfo, SupportedLanguage, SyntaxNode } from './types.js';
import type { LanguageSymbolExtractor } from './extractors/types.js';
import { getExtractor, getImportExtractor, getSymbolExtractor } from './extractors/index.js';
import { getLanguage } from './languages/registry.js';

import { resolveRelativeImport, resolveWorkspaceImport } from '../utils/path-matching.js';
import { resolvePsr4Import } from '../php-psr4.js';
import { resolveGoModuleImport } from '../go-module.js';
import { resolvePythonSrcLayoutImport } from '../python-src-layout.js';
import { resolveJsDirectoryIndex } from '../js-directory-index.js';

/**
 * Per-project manifest-declared import-root mappings, threaded through as a
 * third specifier-resolution step (after relative-import and workspace-
 * package resolution) in `resolveImportSpecifier` — EXCEPT for Rust, whose
 * `rustCrateMap` is threaded straight into the import extractor instead (see
 * its own doc comment below). Built once per workspace root in
 * `ast/chunker.ts`'s `prepareASTContext` — see `../php-psr4.ts`,
 * `../go-module.ts`, `../python-src-layout.ts`, and `../rust-crate-map.ts` for
 * how each map/root is read or detected. At most one field is ever populated
 * for a given file (the language determines which manifest, if any,
 * applies), and all are optional so this is a no-op for every language
 * without a manifest reader.
 */
export interface ManifestRoots {
  /** PHP Composer PSR-4 namespace-prefix -> source-directory map. */
  psr4Map?: ReadonlyMap<string, string>;
  /** Go module's declared import-path prefix (`go.mod`'s `module` line). */
  goModulePrefix?: string;
  /** Python src-layout root directory (`src`), when detected on disk. */
  pythonSrcLayoutRoot?: string;
  /**
   * Absolute workspace root, needed alongside `pythonSrcLayoutRoot` (see its
   * own doc comment) and `resolveDirectoryIndex` (below): both verify a
   * candidate path actually exists on disk before rewriting a specifier.
   */
  workspaceRoot?: string;
  /**
   * When true, a relative import that resolves to a bare directory path
   * (e.g. `../..` joined against its importer's directory, producing `src`)
   * is further resolved to that directory's real `index.<ext>` entry file,
   * when one exists on disk (#953 — see `../js-directory-index.ts`). Set
   * only for JS/TS (`ast/chunker.ts`'s `buildManifestRoots`): a bare
   * directory specifier left unresolved falls through to `matchesFile`'s
   * fuzzy-matching strategies, each tuned for a DIFFERENT language's real
   * multi-file semantics (Go's package directories, Python's package
   * `__init__.py`) — for a JS/TS importer neither applies, so the bare
   * specifier fabricates a dependent edge to every file under that
   * directory instead of the one real edge.
   */
  resolveDirectoryIndex?: true;
  /**
   * Rust Cargo workspace crate name (underscore form) -> crate `src/` dir map
   * (#903). Unlike `psr4Map`/`goModulePrefix`, this is NOT consumed by
   * `resolveManifestRoot` below — Rust's extractor (`ast/languages/rust.ts`)
   * must decide "internal vs. external crate" BEFORE it ever emits a
   * specifier (a `crate::`/`self::`/`super::`-relative path is converted;
   * anything else is dropped), so the map is passed straight into
   * `extractImportPaths`/`processImportSymbols` as an extra argument instead
   * of being applied as post-extraction string resolution.
   */
  rustCrateMap?: ReadonlyMap<string, string>;
}

/**
 * Extract symbol information from an AST node using language-specific extractors.
 *
 * @param node - AST node to extract info from
 * @param content - Source code content
 * @param parentClass - Parent class name if this is a method
 * @param language - Programming language
 * @returns Symbol information or null
 */
export function extractSymbolInfo(
  node: SyntaxNode,
  content: string,
  parentClass?: string,
  language?: string,
): SymbolInfo | null {
  if (language) {
    const extractor = getSymbolExtractor(language as SupportedLanguage);
    if (extractor) {
      return extractor.extractSymbol(node, content, parentClass);
    }
  }
  return null;
}

/**
 * Collect the import nodes to process from the root.
 *
 * Most grammars place import statements as direct children of the root node, but
 * some wrap them in a container — e.g. Kotlin's `import_list` holds the
 * `import_header` children. We therefore also descend one level into a
 * non-matching direct child to find imports nested inside such a container. This
 * is backward compatible: languages whose import nodes are already direct
 * children match in the first branch and are never descended into.
 *
 * Rust's `mod_item` (#1000) is the one matched type that can ITSELF contain
 * further import nodes at arbitrary depth: an inline `mod x { ... }` nests
 * further `use_declaration`/`mod_item` children inside its own body, unlike
 * every other matched type here (a leaf import statement with nothing
 * further inside it worth looking for). So a matched `mod_item` with a body
 * is also recursed into — every other language's matched nodes are leaves
 * and this is a no-op for them.
 */
function collectImportNodes(rootNode: SyntaxNode, nodeTypeSet: Set<string>): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  for (const child of rootNode.namedChildren) {
    if (nodeTypeSet.has(child.type)) {
      nodes.push(child, ...collectNestedModImportNodes(child, nodeTypeSet));
    } else {
      for (const grandchild of child.namedChildren) {
        if (nodeTypeSet.has(grandchild.type)) nodes.push(grandchild);
      }
    }
  }
  return nodes;
}

/**
 * Rust-only (#1000): further import nodes nested inside a matched
 * `mod_item`'s own inline body — see `collectImportNodes`'s doc comment. A
 * no-op for every other matched type, and for a file-backed `mod_item`
 * (no body).
 */
function collectNestedModImportNodes(node: SyntaxNode, nodeTypeSet: Set<string>): SyntaxNode[] {
  if (node.type !== 'mod_item') return [];
  const body = node.childForFieldName('body');
  return body ? collectImportNodes(body, nodeTypeSet) : [];
}

/**
 * Resolve a single raw import specifier in four steps, each a no-op when its
 * respective input isn't provided, so behavior for existing callers is
 * unchanged:
 * 1. Relative specifiers (`./foo`, `../bar`) against the importer's directory.
 * 2. A relative specifier that resolved to a bare DIRECTORY (`#953`) against
 *    that directory's real `index.<ext>` entry file, JS/TS only.
 * 3. Workspace package specifiers (`@scope/pkg`) against the `workspacePackages` map.
 * 4. Manifest-declared import roots (PHP PSR-4, Go module prefix) against `manifestRoots`.
 */
function resolveImportSpecifier(
  specifier: string,
  filepath: string | undefined,
  workspacePackages: ReadonlyMap<string, string> | undefined,
  manifestRoots: ManifestRoots | undefined,
): string {
  const relResolved = filepath ? resolveRelativeImport(filepath, specifier) : specifier;
  const dirResolved = resolveDirectoryIndexIfRelative(specifier, relResolved, manifestRoots);
  const wsResolved = workspacePackages
    ? resolveWorkspaceImport(dirResolved, workspacePackages)
    : dirResolved;
  return resolveManifestRoot(wsResolved, manifestRoots);
}

/**
 * Apply `resolveJsDirectoryIndex` (#953) to a relative-resolved specifier,
 * but only when it actually WAS relative (`relResolved !== originalSpecifier`
 * -- `resolveRelativeImport` is a no-op for bare/external specifiers like
 * `'lodash'` or `'@scope/pkg'`) and the importer's language opted in
 * (`manifestRoots.resolveDirectoryIndex`, set for JS/TS only -- see
 * `ast/chunker.ts`'s `buildManifestRoots`). Skipping the check entirely for
 * non-relative specifiers avoids an unnecessary filesystem stat for every
 * bare external package import.
 */
function resolveDirectoryIndexIfRelative(
  originalSpecifier: string,
  relResolved: string,
  manifestRoots: ManifestRoots | undefined,
): string {
  if (relResolved === originalSpecifier) return relResolved;
  if (!manifestRoots?.resolveDirectoryIndex || !manifestRoots.workspaceRoot) return relResolved;
  return resolveJsDirectoryIndex(relResolved, manifestRoots.workspaceRoot);
}

/** Apply step 3 (manifest-root resolution) of `resolveImportSpecifier`. */
function resolveManifestRoot(specifier: string, manifestRoots: ManifestRoots | undefined): string {
  if (!manifestRoots) return specifier;
  if (manifestRoots.psr4Map) return resolvePsr4Import(specifier, manifestRoots.psr4Map);
  if (manifestRoots.goModulePrefix) {
    return resolveGoModuleImport(specifier, manifestRoots.goModulePrefix);
  }
  if (manifestRoots.pythonSrcLayoutRoot) {
    return resolvePythonSrcLayoutImport(
      specifier,
      manifestRoots.pythonSrcLayoutRoot,
      manifestRoots.workspaceRoot,
    );
  }
  return specifier;
}

/**
 * Append `extractReferencedFQCNs`'s results (PHP only, today — see that
 * method's doc comment for #878's background) to `imports` IN PLACE, each
 * resolved through the same pipeline as a declaration-based import and
 * deduplicated against what's already present. A no-op when the extractor
 * doesn't implement the optional method, so every other language's
 * `extractImportPaths` behavior is unaffected.
 */
function appendReferencedFQCNs(
  imports: string[],
  importExtractor: ReturnType<typeof getImportExtractor>,
  rootNode: SyntaxNode,
  filepath: string | undefined,
  workspacePackages: ReadonlyMap<string, string> | undefined,
  manifestRoots: ManifestRoots | undefined,
): void {
  if (!importExtractor?.extractReferencedFQCNs) return;

  const seen = new Set(imports);
  for (const result of importExtractor.extractReferencedFQCNs(rootNode)) {
    const resolved = resolveImportSpecifier(result, filepath, workspacePackages, manifestRoots);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      imports.push(resolved);
    }
  }
}

/**
 * Extract import paths using the language-specific extractor.
 *
 * When `filepath` is provided, relative specifiers (`./foo`, `../bar`) are
 * resolved against the importer's directory so that cross-package files with
 * the same basename don't collide downstream. When `workspacePackages` is
 * also provided, bare specifiers naming a workspace package (`@scope/pkg`)
 * resolve to that package's source entry file, enabling cross-package
 * dependency analysis in monorepos. Everything else passes through
 * unchanged.
 *
 * Also merges in `appendReferencedFQCNs`'s results (#878) — see its doc
 * comment.
 */
function extractImportPaths(
  rootNode: SyntaxNode,
  importExtractor: ReturnType<typeof getImportExtractor>,
  filepath?: string,
  workspacePackages?: ReadonlyMap<string, string>,
  manifestRoots?: ManifestRoots,
  rustImporterFile?: string,
): string[] {
  if (!importExtractor) return [];

  const imports: string[] = [];
  const nodeTypeSet = new Set(importExtractor.importNodeTypes);

  for (const node of collectImportNodes(rootNode, nodeTypeSet)) {
    for (const result of importExtractor.extractImportPaths(
      node,
      manifestRoots?.rustCrateMap,
      rustImporterFile,
    )) {
      imports.push(resolveImportSpecifier(result, filepath, workspacePackages, manifestRoots));
    }
  }

  appendReferencedFQCNs(
    imports,
    importExtractor,
    rootNode,
    filepath,
    workspacePackages,
    manifestRoots,
  );

  return imports;
}

/**
 * Extract import statements from a file.
 *
 * When a language is provided, uses the language-specific import extractor.
 * Falls back to legacy behavior for backwards compatibility.
 *
 * @param filepath - Optional path of the file being chunked. Enables resolution
 *   of `./` / `../` specifiers so they store workspace-relative paths instead
 *   of bare basenames. Deliberately gated per-language by the caller (see
 *   `ast/chunker.ts`'s `RESOLVE_RELATIVE_IMPORTS`) — Rust is excluded here
 *   because filesystem-style `..` resolution would misresolve `self::`/
 *   `super::` (see `rustImporterFile` below for how Rust resolves them
 *   instead).
 * @param workspacePackages - Optional map of workspace package name -> source
 *   entry file (see `resolveWorkspacePackageEntries`). Enables resolution of
 *   bare `@scope/pkg` specifiers that reference sibling workspace packages.
 * @param manifestRoots - Optional manifest-declared import-root mappings
 *   (PHP PSR-4, Go module prefix). See `ManifestRoots`.
 * @param rustImporterFile - Rust-only (#928): the file's real workspace-
 *   relative path, passed UNCONDITIONALLY (never gated by
 *   `RESOLVE_RELATIVE_IMPORTS`, unlike `filepath` above) so
 *   `RustImportExtractor` can resolve `self::`/`super::` against the
 *   importer's own location via its own file-to-module-aware logic — see
 *   `ast/languages/rust.ts`'s `resolveRustRelativeModulePath`. Every other
 *   language's extractor ignores this parameter.
 */
export function extractImports(
  rootNode: SyntaxNode,
  language?: SupportedLanguage,
  filepath?: string,
  workspacePackages?: ReadonlyMap<string, string>,
  manifestRoots?: ManifestRoots,
  rustImporterFile?: string,
): string[] {
  if (!language) return [];
  return extractImportPaths(
    rootNode,
    getImportExtractor(language),
    filepath,
    workspacePackages,
    manifestRoots,
    rustImporterFile,
  );
}

/**
 * Add symbols to the import map, merging with existing entries.
 */
function addSymbolsToMap(
  map: Record<string, string[]>,
  importPath: string,
  symbols: string[],
): void {
  const existing = map[importPath];
  if (existing) {
    existing.push(...symbols);
  } else {
    map[importPath] = symbols;
  }
}

/**
 * Extract symbols using the language-specific extractor.
 *
 * When `filepath` is provided, relative import paths in the returned map's
 * keys are resolved to workspace-relative paths via `resolveRelativeImport`.
 * When `workspacePackages` is also provided, bare workspace-package keys are
 * further resolved to their source entry file (see `extractImportPaths`).
 */
function extractSymbolsWithExtractor(
  rootNode: SyntaxNode,
  importExtractor: ReturnType<typeof getImportExtractor>,
  filepath?: string,
  workspacePackages?: ReadonlyMap<string, string>,
  manifestRoots?: ManifestRoots,
  rustImporterFile?: string,
): Record<string, string[]> {
  if (!importExtractor) return {};

  const importedSymbols: Record<string, string[]> = {};
  const nodeTypeSet = new Set(importExtractor.importNodeTypes);

  for (const node of collectImportNodes(rootNode, nodeTypeSet)) {
    const results = importExtractor.processImportSymbolsList(
      node,
      manifestRoots?.rustCrateMap,
      rustImporterFile,
    );
    for (const result of results) {
      const key = resolveImportSpecifier(
        result.importPath,
        filepath,
        workspacePackages,
        manifestRoots,
      );
      addSymbolsToMap(importedSymbols, key, result.symbols);
    }
  }

  return importedSymbols;
}

/**
 * Extract imported symbols mapped to their source paths.
 *
 * Returns a map like: { 'packages/parser/src/validate': ['validateEmail'] }
 * when `filepath` is provided, or { './validate': ['validateEmail'] } for
 * legacy callers that don't pass it.
 *
 * @param filepath - Optional path of the file being chunked. Enables resolution
 *   of `./` / `../` specifiers into workspace-relative keys. Gated per-language
 *   by the caller — see `extractImports`'s doc comment for why Rust is
 *   excluded and uses `rustImporterFile` instead.
 * @param workspacePackages - Optional map of workspace package name -> source
 *   entry file. Enables resolution of bare `@scope/pkg` keys.
 * @param manifestRoots - Optional manifest-declared import-root mappings
 *   (PHP PSR-4, Go module prefix). See `ManifestRoots`.
 * @param rustImporterFile - Rust-only (#928) — see `extractImports`.
 */
export function extractImportedSymbols(
  rootNode: SyntaxNode,
  language?: SupportedLanguage,
  filepath?: string,
  workspacePackages?: ReadonlyMap<string, string>,
  manifestRoots?: ManifestRoots,
  rustImporterFile?: string,
): Record<string, string[]> {
  if (!language) return {};
  return extractSymbolsWithExtractor(
    rootNode,
    getImportExtractor(language),
    filepath,
    workspacePackages,
    manifestRoots,
    rustImporterFile,
  );
}

/**
 * Extract exported symbols from a file.
 *
 * Returns array of exported symbol names like: ['validateEmail', 'validatePhone', 'default']
 *
 * Language-specific behavior:
 *
 * **JavaScript/TypeScript:**
 * - Named exports: export { foo, bar }
 * - Declaration exports: export function foo() {}, export const bar = ...
 * - Default exports: export default ...
 * - Re-exports: export { foo } from './module'
 *
 * **PHP:**
 * - All top-level classes, traits, interfaces, and functions are considered exported
 * - PHP doesn't have explicit export syntax - all public declarations are accessible
 *
 * **Python:**
 * - All module-level classes and functions are considered exported
 * - Python doesn't have explicit export syntax - module-level names are importable
 *
 * Limitations:
 * - Only static, top-level declarations are processed (direct children of the root node).
 * - Dynamic or conditional exports/declarations are not detected.
 *
 * @param rootNode - AST root node
 * @param language - Programming language (defaults to 'javascript' for backwards compatibility)
 * @returns Array of exported symbol names
 */
export function extractExports(rootNode: SyntaxNode, language?: SupportedLanguage): string[] {
  // Default to JavaScript if no language specified (for backwards compatibility)
  const lang: SupportedLanguage = language ?? 'javascript';
  const extractor = getExtractor(lang);
  return extractor.extractExports(rootNode);
}

/**
 * Extract call sites within a function/method body.
 *
 * Returns array of function calls made within the node.
 *
 * Supported languages:
 * - TypeScript/JavaScript: call_expression (foo(), obj.method()), new_expression (new Foo())
 * - PHP: function_call_expression, member_call_expression, scoped_call_expression
 * - Python: call (similar to JS call_expression)
 * - Rust: call_expression (foo(), obj.method()), macro_invocation (println!())
 */
export function extractCallSites(
  node: SyntaxNode,
  language?: SupportedLanguage,
): Array<{ symbol: string; line: number; isResultCaptured?: boolean }> {
  if (!language) return [];

  const langDef = getLanguage(language);
  const extractor = langDef.symbolExtractor;
  if (!extractor) return [];

  const callExprTypes = new Set(langDef.symbols.callExpressionTypes);
  const callSites: Array<{ symbol: string; line: number; isResultCaptured?: boolean }> = [];
  const seen = new Set<string>();

  traverseForCallSites(node, callSites, seen, callExprTypes, extractor);
  return callSites;
}

/**
 * Determine whether a call expression's return value is captured (assigned/used).
 *
 * In tree-sitter, a standalone call like `doSomething();` parses as:
 *   expression_statement > call_expression
 *
 * If the call is assigned (`const x = doSomething()`), it appears inside
 * `variable_declarator` or similar — NOT `expression_statement`.
 *
 * Edge case: `await doSomething();` parses as:
 *   expression_statement > await_expression > call_expression  (TS/JS)
 *   expression_statement > await > call                        (Python)
 * We walk up through transparent wrappers to handle this.
 */
const TRANSPARENT_WRAPPER_TYPES = new Set([
  'await_expression', // TypeScript/JavaScript
  'await', // Python
  'parenthesized_expression', // All languages
]);

function isCallResultCaptured(callNode: SyntaxNode): boolean {
  let current = callNode;
  while (current.parent) {
    const parentType = current.parent.type;
    if (parentType === 'expression_statement') return false;
    // Walk up through transparent wrappers that don't consume the value
    if (TRANSPARENT_WRAPPER_TYPES.has(parentType)) {
      current = current.parent;
      continue;
    }
    break;
  }
  return true;
}

/**
 * Recursively traverse AST to find call expressions.
 */
function traverseForCallSites(
  node: SyntaxNode,
  callSites: Array<{ symbol: string; line: number; isResultCaptured?: boolean }>,
  seen: Set<string>,
  callExprTypes: Set<string>,
  extractor: LanguageSymbolExtractor,
): void {
  if (callExprTypes.has(node.type)) {
    const callSite = extractor.extractCallSite(node);
    if (callSite && !seen.has(callSite.key)) {
      seen.add(callSite.key);
      callSites.push({
        symbol: callSite.symbol,
        line: callSite.line,
        isResultCaptured: isCallResultCaptured(node),
      });
    }
  }

  // Recurse into named children to skip punctuation and other non-semantic nodes
  for (const child of node.namedChildren) {
    traverseForCallSites(child, callSites, seen, callExprTypes, extractor);
  }
}

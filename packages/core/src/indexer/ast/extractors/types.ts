import type Parser from 'tree-sitter';
import type { SymbolInfo } from '../types.js';

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
  extractSymbol(
    node: Parser.SyntaxNode,
    content: string,
    parentClass?: string
  ): SymbolInfo | null;

  /** Extract symbol name and line from a call expression node */
  extractCallSite(
    node: Parser.SyntaxNode
  ): { symbol: string; line: number; key: string } | null;
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
  extractExports(rootNode: Parser.SyntaxNode): string[];
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
   * @param node - AST node matching one of importNodeTypes
   * @returns The import path string, or null to skip
   */
  extractImportPath(node: Parser.SyntaxNode): string | null;

  /**
   * Extract imported symbols mapped to their source path.
   *
   * @param node - AST node matching one of importNodeTypes
   * @returns Object with importPath and symbols, or null to skip
   */
  processImportSymbols(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null;
}

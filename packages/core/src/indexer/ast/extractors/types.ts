import type Parser from 'tree-sitter';

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

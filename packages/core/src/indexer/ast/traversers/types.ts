import type Parser from 'tree-sitter';

/**
 * Language-specific node traversal configuration
 *
 * Each language has different AST node types and structures. This interface
 * allows us to implement language-specific traversal strategies while keeping
 * the core chunking logic language-agnostic.
 *
 * @example TypeScript/JavaScript
 * ```typescript
 * targetNodeTypes: ['function_declaration', 'method_definition', 'interface_declaration']
 * containerTypes: ['class_declaration']
 * ```
 *
 * @example Python
 * ```typescript
 * targetNodeTypes: ['function_definition', 'async_function_definition']
 * containerTypes: ['class_definition']
 * ```
 */
export interface LanguageTraverser {
  /**
   * AST node types that should be extracted as chunks
   * (e.g., 'function_declaration', 'method_definition' for TypeScript)
   */
  targetNodeTypes: string[];

  /**
   * AST node types for containers whose children should be extracted
   * (e.g., 'class_declaration' for TypeScript - we extract methods, not the class itself)
   */
  containerTypes: string[];

  /**
   * AST node types that represent variable declarations that might contain functions
   * (e.g., 'lexical_declaration' for TypeScript const/let with arrow functions)
   */
  declarationTypes: string[];

  /**
   * AST node types that represent function implementations
   * (used to detect functions inside variable declarations)
   */
  functionTypes: string[];

  /**
   * Check if a node should have its children extracted instead of being chunked itself
   *
   * @param node - AST node to check
   * @returns True if we should extract children (e.g., class methods), false otherwise
   */
  shouldExtractChildren(node: Parser.SyntaxNode): boolean;

  /**
   * Check if a node is a declaration that might contain a function
   *
   * @param node - AST node to check
   * @returns True if this is a variable declaration that might contain a function
   */
  isDeclarationWithFunction(node: Parser.SyntaxNode): boolean;

  /**
   * Extract the container body node (e.g., class body) for child traversal
   *
   * @param node - Container node (e.g., class_declaration)
   * @returns The body node containing children, or null if not found
   */
  getContainerBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null;

  /**
   * Check if traversal should continue into this node's children
   *
   * @param node - AST node to check
   * @returns True if we should traverse children (e.g., for 'program', 'export_statement')
   */
  shouldTraverseChildren(node: Parser.SyntaxNode): boolean;

  /**
   * Find the parent container name for a node (e.g., class name for a method)
   *
   * @param node - AST node (e.g., method)
   * @returns Container name (e.g., class name), or undefined if not in a container
   */
  findParentContainerName(node: Parser.SyntaxNode): string | undefined;

  /**
   * Find a function inside a declaration node (e.g., arrow function in const declaration)
   *
   * @param node - Declaration node to search
   * @returns Information about whether a function was found and the function node itself
   */
  findFunctionInDeclaration(node: Parser.SyntaxNode): DeclarationFunctionInfo;
}

/**
 * Result of finding a function inside a declaration node
 */
export interface DeclarationFunctionInfo {
  /**
   * Whether a function was found inside the declaration
   */
  hasFunction: boolean;

  /**
   * The actual function node if found
   */
  functionNode: Parser.SyntaxNode | null;
}

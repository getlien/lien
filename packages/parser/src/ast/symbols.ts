import type Parser from 'tree-sitter';
import type { SymbolInfo, SupportedLanguage } from './types.js';
import type { LanguageSymbolExtractor } from './extractors/types.js';
import { getExtractor, getImportExtractor, getSymbolExtractor } from './extractors/index.js';
import { getLanguage } from './languages/registry.js';

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
  node: Parser.SyntaxNode,
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
 * Extract import paths using the language-specific extractor.
 */
function extractImportPaths(
  rootNode: Parser.SyntaxNode,
  importExtractor: ReturnType<typeof getImportExtractor>,
): string[] {
  if (!importExtractor) return [];

  const imports: string[] = [];
  const nodeTypeSet = new Set(importExtractor.importNodeTypes);

  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const child = rootNode.namedChild(i);
    if (!child || !nodeTypeSet.has(child.type)) continue;

    const result = importExtractor.extractImportPath(child);
    if (result) imports.push(result);
  }

  return imports;
}

/**
 * Extract import statements from a file.
 *
 * When a language is provided, uses the language-specific import extractor.
 * Falls back to legacy behavior for backwards compatibility.
 */
export function extractImports(
  rootNode: Parser.SyntaxNode,
  language?: SupportedLanguage,
): string[] {
  if (!language) return [];
  return extractImportPaths(rootNode, getImportExtractor(language));
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
 */
function extractSymbolsWithExtractor(
  rootNode: Parser.SyntaxNode,
  importExtractor: ReturnType<typeof getImportExtractor>,
): Record<string, string[]> {
  if (!importExtractor) return {};

  const importedSymbols: Record<string, string[]> = {};
  const nodeTypeSet = new Set(importExtractor.importNodeTypes);

  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const node = rootNode.namedChild(i);
    if (!node || !nodeTypeSet.has(node.type)) continue;

    const result = importExtractor.processImportSymbols(node);
    if (result) {
      addSymbolsToMap(importedSymbols, result.importPath, result.symbols);
    }
  }

  return importedSymbols;
}

/**
 * Extract imported symbols mapped to their source paths.
 *
 * Returns a map like: { './validate': ['validateEmail', 'validatePhone'] }
 *
 * When a language is provided, uses the language-specific import extractor.
 * Falls back to legacy behavior for backwards compatibility.
 */
export function extractImportedSymbols(
  rootNode: Parser.SyntaxNode,
  language?: SupportedLanguage,
): Record<string, string[]> {
  if (!language) return {};
  return extractSymbolsWithExtractor(rootNode, getImportExtractor(language));
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
export function extractExports(
  rootNode: Parser.SyntaxNode,
  language?: SupportedLanguage,
): string[] {
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
  node: Parser.SyntaxNode,
  language?: SupportedLanguage,
): Array<{ symbol: string; line: number }> {
  if (!language) return [];

  const langDef = getLanguage(language);
  const extractor = langDef.symbolExtractor;
  if (!extractor) return [];

  const callExprTypes = new Set(langDef.symbols.callExpressionTypes);
  const callSites: Array<{ symbol: string; line: number }> = [];
  const seen = new Set<string>();

  traverseForCallSites(node, callSites, seen, callExprTypes, extractor);
  return callSites;
}

/**
 * Recursively traverse AST to find call expressions.
 */
function traverseForCallSites(
  node: Parser.SyntaxNode,
  callSites: Array<{ symbol: string; line: number }>,
  seen: Set<string>,
  callExprTypes: Set<string>,
  extractor: LanguageSymbolExtractor,
): void {
  if (callExprTypes.has(node.type)) {
    const callSite = extractor.extractCallSite(node);
    if (callSite && !seen.has(callSite.key)) {
      seen.add(callSite.key);
      callSites.push({ symbol: callSite.symbol, line: callSite.line });
    }
  }

  // Recurse into named children to skip punctuation and other non-semantic nodes
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) traverseForCallSites(child, callSites, seen, callExprTypes, extractor);
  }
}

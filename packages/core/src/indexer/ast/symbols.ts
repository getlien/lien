import type Parser from 'tree-sitter';
import type { SymbolInfo, SupportedLanguage } from './types.js';
import { calculateComplexity } from './complexity/index.js';
import { getExtractor, getImportExtractor } from './extractors/index.js';
import { getAllLanguages } from './languages/registry.js';

/**
 * Type for symbol extractor functions
 */
type SymbolExtractor = (
  node: Parser.SyntaxNode,
  content: string,
  parentClass?: string
) => SymbolInfo | null;

/**
 * Extract function declaration info (function_declaration, function)
 */
function extractFunctionInfo(
  node: Parser.SyntaxNode,
  content: string,
  parentClass?: string
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
 * Extract arrow function or function expression info
 */
function extractArrowFunctionInfo(
  node: Parser.SyntaxNode,
  content: string,
  parentClass?: string
): SymbolInfo | null {
    // Try to find variable name for arrow functions
    const parent = node.parent;
    let name = 'anonymous';

    if (parent?.type === 'variable_declarator') {
      const nameNode = parent.childForFieldName('name');
      name = nameNode?.text || 'anonymous';
    }

    return {
      name,
      type: parentClass ? 'method' : 'function',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: extractSignature(node, content),
      parameters: extractParameters(node, content),
      complexity: calculateComplexity(node),
    };
  }

/**
 * Extract method definition info
 */
function extractMethodInfo(
  node: Parser.SyntaxNode,
  content: string,
  parentClass?: string
): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'method',
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
 * Extract class declaration info
 */
function extractClassInfo(
  node: Parser.SyntaxNode,
  _content: string,
  _parentClass?: string
): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: `class ${nameNode.text}`,
    };
  }

/**
 * Extract interface declaration info (TypeScript)
 */
function extractInterfaceInfo(
  node: Parser.SyntaxNode,
  _content: string,
  _parentClass?: string
): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'interface',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: `interface ${nameNode.text}`,
    };
  }

/**
 * Extract Python function info (def and async def)
 */
function extractPythonFunctionInfo(
  node: Parser.SyntaxNode,
  content: string,
  parentClass?: string
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
      complexity: calculateComplexity(node),
    };
  }

/**
 * Extract Python class info
 */
function extractPythonClassInfo(
  node: Parser.SyntaxNode,
  _content: string,
  _parentClass?: string
): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: `class ${nameNode.text}`,
    };
  }

/**
 * Map of AST node types to their specialized extractors
 *
 * Note: There is intentional overlap in node type names across languages:
 * - 'function_definition': Used by both PHP and Python
 * - 'class_declaration': Used by TypeScript/JavaScript
 * - 'class_definition': Used by Python
 *
 * This is handled correctly because each file is parsed with its specific language parser.
 */
const symbolExtractors: Record<string, SymbolExtractor> = {
  // TypeScript/JavaScript
  'function_declaration': extractFunctionInfo,
  'function': extractFunctionInfo,
  'arrow_function': extractArrowFunctionInfo,
  'function_expression': extractArrowFunctionInfo,
  'method_definition': extractMethodInfo,
  'class_declaration': extractClassInfo,
  'interface_declaration': extractInterfaceInfo,

  // PHP
  'function_definition': extractFunctionInfo,   // PHP functions (Python handled via language check in extractSymbolInfo)
  'method_declaration': extractMethodInfo,       // PHP methods

  // Python
  'async_function_definition': extractPythonFunctionInfo,  // Python async functions
  'class_definition': extractPythonClassInfo,              // Python classes
  // Note: Python regular functions use 'function_definition' (same as PHP)
  // They are dispatched to extractPythonFunctionInfo via language check in extractSymbolInfo()
};

/**
 * Extract symbol information from an AST node using specialized extractors
 *
 * @param node - AST node to extract info from
 * @param content - Source code content
 * @param parentClass - Parent class name if this is a method
 * @param language - Programming language (for disambiguating shared node types)
 * @returns Symbol information or null
 */
export function extractSymbolInfo(
  node: Parser.SyntaxNode,
  content: string,
  parentClass?: string,
  language?: string
): SymbolInfo | null {
  // Handle ambiguous node types that are shared between languages
  // PHP and Python both use 'function_definition', but need different extractors
  if (node.type === 'function_definition' && language === 'python') {
    return extractPythonFunctionInfo(node, content, parentClass);
  }

  const extractor = symbolExtractors[node.type];
  return extractor ? extractor(node, content, parentClass) : null;
}

/**
 * Extract function/method signature
 */
function extractSignature(node: Parser.SyntaxNode, content: string): string {
  // Get the first line of the function (up to opening brace or arrow)
  const startLine = node.startPosition.row;
  const lines = content.split('\n');
  let signature = lines[startLine] || '';

  // If signature spans multiple lines, try to get up to the opening brace
  let currentLine = startLine;
  while (currentLine < node.endPosition.row && !signature.includes('{') && !signature.includes('=>')) {
    currentLine++;
    signature += ' ' + (lines[currentLine] || '');
  }

  // Clean up signature
  signature = signature.split('{')[0].split('=>')[0].trim();

  // Limit length
  if (signature.length > 200) {
    signature = signature.substring(0, 197) + '...';
  }

  return signature;
}

/**
 * Extract parameter list from function node
 *
 * Note: The `_content` parameter is unused in this function, but is kept for API consistency
 * with other extract functions (e.g., extractSignature).
 */
function extractParameters(node: Parser.SyntaxNode, _content: string): string[] {
  const parameters: string[] = [];

  // Find parameters node
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return parameters;

  // Traverse parameter nodes
  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = paramsNode.namedChild(i);
    if (param && param.text.trim()) {
      parameters.push(param.text);
    }
  }

  return parameters;
}

/**
 * Extract return type from function node (TypeScript)
 *
 * Note: The `_content` parameter is unused in this function, but is kept for API consistency
 * with other extract functions (e.g., extractSignature).
 */
function extractReturnType(node: Parser.SyntaxNode, _content: string): string | undefined {
  const returnTypeNode = node.childForFieldName('return_type');
  if (!returnTypeNode) return undefined;

  return returnTypeNode.text;
}

/**
 * Extract import statements from a file.
 *
 * When a language is provided, uses the language-specific import extractor.
 * Falls back to legacy behavior for backwards compatibility.
 */
export function extractImports(rootNode: Parser.SyntaxNode, language?: SupportedLanguage): string[] {
  if (language) {
    const importExtractor = getImportExtractor(language);
    if (importExtractor) {
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
  }

  // Fallback: no language or no import extractor
  return [];
}

/**
 * Extract imported symbols mapped to their source paths.
 *
 * Returns a map like: { './validate': ['validateEmail', 'validatePhone'] }
 *
 * When a language is provided, uses the language-specific import extractor.
 * Falls back to legacy behavior for backwards compatibility.
 */
export function extractImportedSymbols(rootNode: Parser.SyntaxNode, language?: SupportedLanguage): Record<string, string[]> {
  if (language) {
    const importExtractor = getImportExtractor(language);
    if (importExtractor) {
      const importedSymbols: Record<string, string[]> = {};
      const nodeTypeSet = new Set(importExtractor.importNodeTypes);

      for (let i = 0; i < rootNode.namedChildCount; i++) {
        const node = rootNode.namedChild(i);
        if (!node || !nodeTypeSet.has(node.type)) continue;

        const result = importExtractor.processImportSymbols(node);
        if (result) {
          if (importedSymbols[result.importPath]) {
            importedSymbols[result.importPath].push(...result.symbols);
          } else {
            importedSymbols[result.importPath] = result.symbols;
          }
        }
      }

      return importedSymbols;
    }
  }

  // Fallback: no language or no import extractor
  return {};
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
export function extractExports(rootNode: Parser.SyntaxNode, language?: SupportedLanguage): string[] {
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
 */
export function extractCallSites(node: Parser.SyntaxNode): Array<{ symbol: string; line: number }> {
  const callSites: Array<{ symbol: string; line: number }> = [];
  const seen = new Set<string>();
  const callExprTypes = getCallExpressionTypes();

  traverseForCallSites(node, callSites, seen, callExprTypes);
  return callSites;
}

/**
 * Call expression node types, built from all language definitions.
 * Lazily initialized on first use.
 */
let callExpressionTypesCache: Set<string> | null = null;

function getCallExpressionTypes(): Set<string> {
  if (!callExpressionTypesCache) {
    callExpressionTypesCache = new Set<string>();
    for (const lang of getAllLanguages()) {
      for (const type of lang.symbols.callExpressionTypes) {
        callExpressionTypesCache.add(type);
      }
    }
  }
  return callExpressionTypesCache;
}

/**
 * Recursively traverse AST to find call expressions.
 */
function traverseForCallSites(
  node: Parser.SyntaxNode,
  callSites: Array<{ symbol: string; line: number }>,
  seen: Set<string>,
  callExprTypes: Set<string>
): void {
  if (callExprTypes.has(node.type)) {
    const callSite = extractCallSiteFromExpression(node);
    if (callSite && !seen.has(callSite.key)) {
      seen.add(callSite.key);
      callSites.push({ symbol: callSite.symbol, line: callSite.line });
    }
  }

  // Recurse into named children to skip punctuation and other non-semantic nodes
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) traverseForCallSites(child, callSites, seen, callExprTypes);
  }
}

/**
 * Extract symbol and line from a call expression.
 * Handles multiple languages with different AST structures.
 */
function extractCallSiteFromExpression(node: Parser.SyntaxNode): { symbol: string; line: number; key: string } | null {
  const line = node.startPosition.row + 1;

  // TypeScript/JavaScript: call_expression
  if (node.type === 'call_expression') {
    return extractJSCallSite(node, line);
  }

  // TypeScript/JavaScript: new_expression (new Foo(), new ns.Bar())
  if (node.type === 'new_expression') {
    return extractNewExpressionCallSite(node, line);
  }

  // Python: call
  if (node.type === 'call') {
    return extractPythonCallSite(node, line);
  }

  // PHP: function_call_expression - helper_function()
  if (node.type === 'function_call_expression') {
    const funcNode = node.childForFieldName('function');
    if (funcNode?.type === 'name') {
      return { symbol: funcNode.text, line, key: `${funcNode.text}:${line}` };
    }
  }

  // PHP: member_call_expression - $this->method() or $obj->method()
  if (node.type === 'member_call_expression') {
    const nameNode = node.childForFieldName('name');
    if (nameNode?.type === 'name') {
      return { symbol: nameNode.text, line, key: `${nameNode.text}:${line}` };
    }
  }

  // PHP: scoped_call_expression - User::find() or static::method()
  if (node.type === 'scoped_call_expression') {
    const nameNode = node.childForFieldName('name');
    if (nameNode?.type === 'name') {
      return { symbol: nameNode.text, line, key: `${nameNode.text}:${line}` };
    }
  }

  return null;
}

/**
 * Resolve a JS/TS node (identifier or member_expression) to a symbol name.
 */
function resolveJSSymbol(node: Parser.SyntaxNode): string | null {
  if (node.type === 'identifier') return node.text;
  if (node.type === 'member_expression') {
    const propertyNode = node.childForFieldName('property');
    if (propertyNode?.type === 'property_identifier') return propertyNode.text;
  }
  return null;
}

/**
 * Extract call site from JavaScript/TypeScript call_expression.
 */
function extractJSCallSite(node: Parser.SyntaxNode, line: number): { symbol: string; line: number; key: string } | null {
  const functionNode = node.childForFieldName('function');
  if (!functionNode) return null;
  const symbol = resolveJSSymbol(functionNode);
  return symbol ? { symbol, line, key: `${symbol}:${line}` } : null;
}

/**
 * Extract call site from JavaScript/TypeScript new_expression.
 */
function extractNewExpressionCallSite(node: Parser.SyntaxNode, line: number): { symbol: string; line: number; key: string } | null {
  const ctorNode = node.childForFieldName('constructor');
  if (!ctorNode) return null;
  const symbol = resolveJSSymbol(ctorNode);
  return symbol ? { symbol, line, key: `${symbol}:${line}` } : null;
}

/**
 * Extract call site from Python call expression.
 */
function extractPythonCallSite(node: Parser.SyntaxNode, line: number): { symbol: string; line: number; key: string } | null {
  const funcNode = node.childForFieldName('function');
  if (!funcNode) return null;

  // Direct function call: foo()
  if (funcNode.type === 'identifier') {
    return { symbol: funcNode.text, line, key: `${funcNode.text}:${line}` };
  }

  // Attribute access: obj.method() - extract 'method'
  if (funcNode.type === 'attribute') {
    const attrNode = funcNode.childForFieldName('attribute');
    if (attrNode?.type === 'identifier') {
      return { symbol: attrNode.text, line, key: `${attrNode.text}:${line}` };
    }
  }

  return null;
}

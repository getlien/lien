import type Parser from 'tree-sitter';
import type { SymbolInfo } from './types.js';
import { calculateComplexity } from './complexity/index.js';

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
    if (param) {
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
 * Extract import statements from a file
 */
export function extractImports(rootNode: Parser.SyntaxNode): string[] {
  const imports: string[] = [];
  
  function traverse(node: Parser.SyntaxNode) {
    // Handle import statements (shared node type between languages)
    if (node.type === 'import_statement') {
      // TypeScript/JavaScript: Extract just the module path from 'source' field
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        // TS/JS import with source field
        const importPath = sourceNode.text.replace(/['"]/g, '');
        imports.push(importPath);
      } else {
        // Python import without source field (e.g., "import os")
        const importText = node.text.split('\n')[0];
        imports.push(importText);
      }
    }
    // Python-specific: from...import statements
    else if (node.type === 'import_from_statement') {
      // Python: Get the entire import line (first line only)
      const importText = node.text.split('\n')[0];
      imports.push(importText);
    }
    
    // Only traverse top-level nodes for imports
    if (node === rootNode) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) traverse(child);
      }
    }
  }
  
  traverse(rootNode);
  return imports;
}

/**
 * Extract imported symbols mapped to their source paths.
 * 
 * Returns a map like: { './validate': ['validateEmail', 'validatePhone'] }
 * 
 * Handles various import styles:
 * - Named imports: import { foo, bar } from './module'
 * - Default imports: import foo from './module' 
 * - Namespace imports: import * as utils from './module'
 */
export function extractImportedSymbols(rootNode: Parser.SyntaxNode): Record<string, string[]> {
  const importedSymbols: Record<string, string[]> = {};
  
  function traverse(node: Parser.SyntaxNode) {
    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (!sourceNode) return;
      
      const importPath = sourceNode.text.replace(/['"]/g, '');
      const symbols: string[] = [];
      
      // Find import clause children
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        
        // Default import: import foo from './module'
        if (child.type === 'identifier') {
          symbols.push(child.text);
        }
        // Import clause wraps both default import, named imports and namespace imports
        else if (child.type === 'import_clause') {
          extractImportClauseSymbols(child, symbols);
        }
        // Named imports: import { foo, bar } from './module'
        else if (child.type === 'named_imports') {
          extractNamedImportSymbols(child, symbols);
        }
        // Namespace import: import * as utils from './module'
        else if (child.type === 'namespace_import') {
          extractNamespaceImportSymbol(child, symbols);
        }
      }
      
      if (symbols.length > 0) {
        importedSymbols[importPath] = symbols;
      }
    }
    
    // Only traverse top-level nodes
    if (node === rootNode) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) traverse(child);
      }
    }
  }
  
  traverse(rootNode);
  return importedSymbols;
}

/**
 * Extract symbols from an import clause (handles default, named, and namespace imports)
 */
function extractImportClauseSymbols(node: Parser.SyntaxNode, symbols: string[]): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    
    // Default import identifier
    if (child.type === 'identifier') {
      symbols.push(child.text);
    }
    // Named imports
    else if (child.type === 'named_imports') {
      extractNamedImportSymbols(child, symbols);
    }
    // Namespace import
    else if (child.type === 'namespace_import') {
      extractNamespaceImportSymbol(child, symbols);
    }
  }
}

/**
 * Extract namespace import symbol: import * as utils
 */
function extractNamespaceImportSymbol(node: Parser.SyntaxNode, symbols: string[]): void {
  // Find the identifier child (the alias name)
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'identifier') {
      symbols.push(`* as ${child.text}`);
      return;
    }
  }
}

/**
 * Helper to extract symbol names from named imports clause
 */
function extractNamedImportSymbols(node: Parser.SyntaxNode, symbols: string[]): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    
    if (child.type === 'import_specifier') {
      // Get the imported name (or alias if renamed)
      const aliasNode = child.childForFieldName('alias');
      const nameNode = child.childForFieldName('name');
      const symbol = aliasNode?.text || nameNode?.text || child.text;
      if (symbol && !symbol.includes('{') && !symbol.includes('}')) {
        symbols.push(symbol);
      }
    } else if (child.type === 'identifier') {
      symbols.push(child.text);
    } else if (child.type === 'named_imports') {
      // Recurse into nested named_imports
      extractNamedImportSymbols(child, symbols);
    }
  }
}

/**
 * Extract exported symbols from a file.
 * 
 * Returns array of exported symbol names like: ['validateEmail', 'validatePhone', 'default']
 * 
 * Handles various export styles:
 * - Named exports: export { foo, bar }
 * - Declaration exports: export function foo() {}, export const bar = ...
 * - Default exports: export default ...
 * - Re-exports: export { foo } from './module'
 */
export function extractExports(rootNode: Parser.SyntaxNode): string[] {
  const exports: string[] = [];
  const seen = new Set<string>();
  
  const addExport = (name: string) => {
    if (name && !seen.has(name)) {
      seen.add(name);
      exports.push(name);
    }
  };
  
  function traverse(node: Parser.SyntaxNode) {
    // Export statement: export { foo, bar } or export { foo } from './module'
    if (node.type === 'export_statement') {
      // Check for default export
      const defaultKeyword = node.children.find(c => c.type === 'default');
      if (defaultKeyword) {
        addExport('default');
      }
      
      // Check for declaration (export function/const/class)
      const declaration = node.childForFieldName('declaration');
      if (declaration) {
        extractDeclarationExports(declaration, addExport);
      }
      
      // Check for export clause (export { foo, bar })
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child?.type === 'export_clause') {
          extractExportClauseSymbols(child, addExport);
        }
      }
    }
    
    // Only traverse top-level nodes
    if (node === rootNode) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) traverse(child);
      }
    }
  }
  
  traverse(rootNode);
  return exports;
}

/**
 * Extract exported names from a declaration (function, const, class, interface)
 */
function extractDeclarationExports(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
  // function/class/interface declaration
  const nameNode = node.childForFieldName('name');
  if (nameNode) {
    addExport(nameNode.text);
    return;
  }
  
  // lexical_declaration: const/let declarations
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'variable_declarator') {
        const varName = child.childForFieldName('name');
        if (varName) {
          addExport(varName.text);
        }
      }
    }
  }
}

/**
 * Extract symbol names from export clause: export { foo, bar as baz }
 */
function extractExportClauseSymbols(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'export_specifier') {
      // Use alias if present, otherwise use the name
      const aliasNode = child.childForFieldName('alias');
      const nameNode = child.childForFieldName('name');
      const exported = aliasNode?.text || nameNode?.text;
      if (exported) {
        addExport(exported);
      }
    }
  }
}

/**
 * Extract call sites within a function/method body.
 * 
 * Returns array of function calls made within the node.
 * Only tracks direct function calls (not method calls on objects).
 */
export function extractCallSites(node: Parser.SyntaxNode): Array<{ symbol: string; line: number }> {
  const callSites: Array<{ symbol: string; line: number }> = [];
  const seen = new Set<string>();
  
  function traverse(n: Parser.SyntaxNode) {
    // call_expression: foo() or foo.bar()
    if (n.type === 'call_expression') {
      const functionNode = n.childForFieldName('function');
      if (functionNode) {
        // Direct function call: foo()
        if (functionNode.type === 'identifier') {
          const key = `${functionNode.text}:${n.startPosition.row + 1}`;
          if (!seen.has(key)) {
            seen.add(key);
            callSites.push({
              symbol: functionNode.text,
              line: n.startPosition.row + 1,
            });
          }
        }
        // Member expression: foo.bar() - extract 'bar' if it's a method call
        else if (functionNode.type === 'member_expression') {
          const propertyNode = functionNode.childForFieldName('property');
          if (propertyNode?.type === 'property_identifier') {
            const key = `${propertyNode.text}:${n.startPosition.row + 1}`;
            if (!seen.has(key)) {
              seen.add(key);
              callSites.push({
                symbol: propertyNode.text,
                line: n.startPosition.row + 1,
              });
            }
          }
        }
      }
    }
    
    // Recurse into children
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) traverse(child);
    }
  }
  
  traverse(node);
  return callSites;
}

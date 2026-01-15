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
    // PHP: namespace use declarations (use App\Models\User;)
    else if (node.type === 'namespace_use_declaration') {
      const phpImport = extractPHPUseDeclaration(node);
      if (phpImport) {
        imports.push(phpImport);
      }
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
 * Extract the full namespace path from a PHP use declaration.
 * e.g., "use App\Models\User;" -> "App\Models\User"
 */
function extractPHPUseDeclaration(node: Parser.SyntaxNode): string | null {
  // Find namespace_use_clause
  for (let i = 0; i < node.namedChildCount; i++) {
    const clause = node.namedChild(i);
    if (clause?.type === 'namespace_use_clause') {
      return extractPHPQualifiedName(clause);
    }
  }
  return null;
}

/**
 * Extract qualified name from a PHP namespace use clause.
 * Handles: qualified_name -> namespace_name + name
 */
function extractPHPQualifiedName(clause: Parser.SyntaxNode): string | null {
  for (let i = 0; i < clause.namedChildCount; i++) {
    const child = clause.namedChild(i);
    if (child?.type === 'qualified_name') {
      // Get the full namespace path by concatenating parts
      const parts: string[] = [];
      for (let j = 0; j < child.namedChildCount; j++) {
        const part = child.namedChild(j);
        if (part?.type === 'namespace_name') {
          // namespace_name contains multiple name nodes
          for (let k = 0; k < part.namedChildCount; k++) {
            const namePart = part.namedChild(k);
            if (namePart?.type === 'name') {
              parts.push(namePart.text);
            }
          }
        } else if (part?.type === 'name') {
          parts.push(part.text);
        }
      }
      return parts.join('\\');
    }
  }
  return null;
}

/**
 * Extract imported symbols mapped to their source paths.
 * 
 * Returns a map like: { './validate': ['validateEmail', 'validatePhone'] }
 * 
 * Handles various import styles across languages:
 * 
 * TypeScript/JavaScript:
 * - Named imports: import { foo, bar } from './module'
 * - Default imports: import foo from './module' 
 * - Namespace imports: import * as utils from './module'
 * 
 * Python:
 * - from module import foo, bar
 * - import module (module name as symbol)
 * 
 * PHP:
 * - use App\Models\User (class name as symbol)
 * - use App\Services\AuthService as Auth (aliased imports)
 *
 * Note: Only top-level static import statements are processed. Dynamic imports
 * (e.g., `await import('./module')`) and non-top-level imports are not tracked.
 * TypeScript/JavaScript side-effect imports without imported symbols (e.g.,
 * `import './styles.css'`) are also not tracked and will not appear in
 * `importedSymbols`.
 */
export function extractImportedSymbols(rootNode: Parser.SyntaxNode): Record<string, string[]> {
  const importedSymbols: Record<string, string[]> = {};
  
  // Only process top-level import statements
  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const node = rootNode.namedChild(i);
    if (!node) continue;
    
    let result: { importPath: string; symbols: string[] } | null = null;
    
    // TypeScript/JavaScript imports vs Python imports both use 'import_statement' type
    // Distinguish by checking for TypeScript/JavaScript-specific structure (source field)
    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        // TypeScript/JavaScript: has a 'source' field
        result = processImportStatement(node);
      } else {
        // Python regular import: no 'source' field
        result = processPythonImport(node);
      }
    }
    // Python: from...import statements
    else if (node.type === 'import_from_statement') {
      result = processPythonFromImport(node);
    }
    // PHP: namespace use declarations
    else if (node.type === 'namespace_use_declaration') {
      result = processPHPUseDeclaration(node);
    }
    
    if (result) {
      // Merge symbols if importing from the same path multiple times
      if (importedSymbols[result.importPath]) {
        importedSymbols[result.importPath].push(...result.symbols);
      } else {
        importedSymbols[result.importPath] = result.symbols;
      }
    }
  }
  
  return importedSymbols;
}

/**
 * Extract symbol name from Python aliased import node.
 * Handles "from module import foo as bar" by extracting the alias (bar).
 * 
 * AST structure for "from module import Optional as Opt":
 * - aliased_import contains: dotted_name('Optional') and identifier('Opt')
 * - The alias is always the last identifier child
 */
function extractPythonAliasedSymbol(node: Parser.SyntaxNode): string | undefined {
  const identifierChildren = node.namedChildren.filter(c => c.type === 'identifier');
  const dottedName = node.namedChildren.find(c => c.type === 'dotted_name');

  // If there's at least one identifier, it's the alias (after 'as')
  if (identifierChildren.length >= 1) {
    // Length check guarantees element exists, no optional chaining needed
    return identifierChildren[identifierChildren.length - 1].text;
  }
  
  // No alias found, return the original symbol name
  return dottedName?.text;
}

/**
 * Process Python regular import statement.
 * e.g., "import os", "import os as system", "import os, sys"
 * 
 * Note: For aliased imports like "import numpy as np", we use the original module name
 * as the import path and the alias as the symbol (so it maps to how it's used in code).
 */
function processPythonImport(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
  const result: Array<{ moduleName: string; symbolName: string }> = [];
  
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    
    // Regular module import: "import os"
    if (child.type === 'dotted_name' || child.type === 'identifier') {
      const moduleName = child.text;
      result.push({ moduleName, symbolName: moduleName });
    }
    // Aliased import: "import os as system"
    else if (child.type === 'aliased_import') {
      // Extract the original module name and the alias
      const dottedName = child.namedChildren.find(c => c.type === 'dotted_name');
      const identifiers = child.namedChildren.filter(c => c.type === 'identifier');
      
      const moduleName = dottedName?.text || identifiers[0]?.text;
      const aliasName = identifiers.length >= 2 
        ? identifiers[identifiers.length - 1]?.text  // The alias (after 'as')
        : identifiers[0]?.text;  // Fallback
      
      if (moduleName && aliasName) {
        result.push({ moduleName, symbolName: aliasName });
      }
    }
  }
  
  if (result.length === 0) return null;
  
  // For regular imports, use the first module name as the import path
  // and the symbol name (or alias) as what to track
  return { 
    importPath: result[0].moduleName, 
    symbols: result.map(r => r.symbolName) 
  };
}

/**
 * Process Python from...import statement.
 * e.g., "from utils.validate import validateEmail, validatePhone"
 */
function processPythonFromImport(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
  let modulePath: string | null = null;
  const symbols: string[] = [];
  
  let foundModule = false;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    
    // First dotted_name is the module path
    if (child.type === 'dotted_name' && !foundModule) {
      modulePath = child.text;
      foundModule = true;
    }
    // Subsequent dotted_names are imported symbols
    else if (child.type === 'dotted_name' && foundModule) {
      symbols.push(child.text);
    }
    // Aliased imports: "from module import foo as bar"
    else if (child.type === 'aliased_import') {
      const symbolName = extractPythonAliasedSymbol(child);
      if (symbolName) {
        symbols.push(symbolName);
      }
    }
  }
  
  if (!modulePath || symbols.length === 0) return null;
  return { importPath: modulePath, symbols };
}

/**
 * Process PHP namespace use declaration.
 * e.g., "use App\Models\User" -> { importPath: "App\Models\User", symbols: ["User"] }
 */
function processPHPUseDeclaration(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
  // Find namespace_use_clause
  for (let i = 0; i < node.namedChildCount; i++) {
    const clause = node.namedChild(i);
    if (clause?.type !== 'namespace_use_clause') continue;
    
    const fullPath = extractPHPQualifiedName(clause);
    if (!fullPath) continue;
    
    // Check for alias (use App\Models\User as U)
    // Find alias: look for a name node that's a direct child (not inside qualified_name)
    const directNames = clause.namedChildren.filter(c => c.type === 'name');
    let symbol: string;
    if (directNames.length > 0) {
      // The last direct 'name' child is the alias
      symbol = directNames[directNames.length - 1].text;
    } else {
      // No alias, extract class name from the path
      const parts = fullPath.split('\\');
      symbol = parts[parts.length - 1];
    }
    
    return { importPath: fullPath, symbols: [symbol] };
  }
  
  return null;
}

/**
 * Extract the import path from an import statement.
 */
function extractImportPath(node: Parser.SyntaxNode): string | null {
  const sourceNode = node.childForFieldName('source');
  return sourceNode?.text.replace(/['"]/g, '') ?? null;
}

/**
 * Handler type for import node processing.
 */
type ImportNodeHandler = (child: Parser.SyntaxNode, symbols: string[]) => void;

/**
 * Handlers for different import node types.
 */
const IMPORT_NODE_HANDLERS: Record<string, ImportNodeHandler> = {
  'identifier': (child, symbols) => symbols.push(child.text),
  'import_clause': (child, symbols) => extractImportClauseSymbols(child, symbols),
  'named_imports': (child, symbols) => extractNamedImportSymbols(child, symbols),
  'namespace_import': (child, symbols) => extractNamespaceImportSymbol(child, symbols),
};

/**
 * Extract all imported symbols from an import statement's children.
 */
function extractImportStatementSymbols(node: Parser.SyntaxNode): string[] {
  const symbols: string[] = [];
  
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    
    const handler = IMPORT_NODE_HANDLERS[child.type];
    if (handler) {
      handler(child, symbols);
    }
  }
  
  return symbols;
}

/**
 * Process a single import statement and extract its symbols.
 */
function processImportStatement(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
  const importPath = extractImportPath(node);
  if (!importPath) return null;
  
  const symbols = extractImportStatementSymbols(node);
  return symbols.length > 0 ? { importPath, symbols } : null;
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
 * 
 * Format: "* as {alias}" (e.g., "* as utils")
 * 
 * The "* as " prefix is intentionally included to distinguish namespace imports
 * from regular named imports in the symbol matching logic. This allows us to
 * identify when a file has access to all exports via a namespace, which is
 * useful for dependency analysis even when we can't track specific call sites.
 */
function extractNamespaceImportSymbol(node: Parser.SyntaxNode, symbols: string[]): void {
  // Find the identifier child (the alias name)
  // Namespace imports have exactly one alias identifier, so we return after finding it.
  // Example: "import * as utils from './module'" → identifier is "utils"
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'identifier') {
      symbols.push(`* as ${child.text}`);
      return; // Early return - namespace imports have only one alias
    }
  }
}

/**
 * Extract symbol from an import specifier (handles aliases).
 */
function extractImportSpecifierSymbol(node: Parser.SyntaxNode, symbols: string[]): void {
  const aliasNode = node.childForFieldName('alias');
  const nameNode = node.childForFieldName('name');
  const symbol = aliasNode?.text || nameNode?.text || node.text;
  
  if (symbol && !symbol.includes('{') && !symbol.includes('}')) {
    symbols.push(symbol);
  }
}

/**
 * Helper to extract symbol names from named imports clause
 */
function extractNamedImportSymbols(node: Parser.SyntaxNode, symbols: string[]): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    
    switch (child.type) {
      case 'import_specifier':
        extractImportSpecifierSymbol(child, symbols);
        break;
      case 'identifier':
        symbols.push(child.text);
        break;
      case 'named_imports':
        // Recurse into nested named_imports
        extractNamedImportSymbols(child, symbols);
        break;
    }
  }
}

/**
 * Extract symbols from a single export statement.
 */
function extractExportStatementSymbols(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
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
 * 
 * Limitations:
 * - Only static, top-level export statements are processed (direct children of the root node).
 * - Dynamic or conditional exports (e.g., inside if/for blocks, functions, or created programmatically)
 *   are not detected and will not be included in the returned symbol list.
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
  
  // Process only top-level export statements
  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const child = rootNode.namedChild(i);
    if (child?.type === 'export_statement') {
      extractExportStatementSymbols(child, addExport);
    }
  }
  
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
 * 
 * Supported languages:
 * - TypeScript/JavaScript: call_expression (foo(), obj.method())
 * - PHP: function_call_expression, member_call_expression, scoped_call_expression
 * - Python: call (similar to JS call_expression)
 */
export function extractCallSites(node: Parser.SyntaxNode): Array<{ symbol: string; line: number }> {
  const callSites: Array<{ symbol: string; line: number }> = [];
  const seen = new Set<string>();
  
  traverseForCallSites(node, callSites, seen);
  return callSites;
}

/**
 * Call expression node types by language.
 */
const CALL_EXPRESSION_TYPES = new Set([
  'call_expression',           // TypeScript/JavaScript
  'call',                      // Python
  'function_call_expression',  // PHP: helper_function()
  'member_call_expression',    // PHP: $this->method()
  'scoped_call_expression',    // PHP: User::find()
]);

/**
 * Recursively traverse AST to find call expressions.
 */
function traverseForCallSites(
  node: Parser.SyntaxNode, 
  callSites: Array<{ symbol: string; line: number }>,
  seen: Set<string>
): void {
  if (CALL_EXPRESSION_TYPES.has(node.type)) {
    const callSite = extractCallSiteFromExpression(node);
    if (callSite && !seen.has(callSite.key)) {
      seen.add(callSite.key);
      callSites.push({ symbol: callSite.symbol, line: callSite.line });
    }
  }
  
  // Recurse into named children to skip punctuation and other non-semantic nodes
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) traverseForCallSites(child, callSites, seen);
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
 * Extract call site from JavaScript/TypeScript call_expression.
 */
function extractJSCallSite(node: Parser.SyntaxNode, line: number): { symbol: string; line: number; key: string } | null {
  const functionNode = node.childForFieldName('function');
  if (!functionNode) return null;
  
  // Direct function call: foo()
  if (functionNode.type === 'identifier') {
    return { symbol: functionNode.text, line, key: `${functionNode.text}:${line}` };
  }
  
  // Member expression: foo.bar() - extract 'bar'
  if (functionNode.type === 'member_expression') {
    const propertyNode = functionNode.childForFieldName('property');
    if (propertyNode?.type === 'property_identifier') {
      return { symbol: propertyNode.text, line, key: `${propertyNode.text}:${line}` };
    }
  }
  
  return null;
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

import type Parser from 'tree-sitter';
import type { SymbolInfo } from './types.js';

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
 * Calculate cyclomatic complexity of a function
 * 
 * Complexity = 1 (base) + number of decision points
 * Decision points: if, while, do...while, for, for...in, for...of, foreach, case, catch, &&, ||, ?:
 */
export function calculateComplexity(node: Parser.SyntaxNode): number {
  let complexity = 1; // Base complexity
  
  const decisionPoints = [
    // Common across languages (TypeScript/JavaScript/Python/PHP)
    'if_statement',          // if conditions
    'while_statement',       // while loops
    'for_statement',         // for loops
    'switch_case',           // switch/case statements
    'catch_clause',          // try/catch error handling
    'ternary_expression',    // Ternary operator (a ? b : c)
    'binary_expression',     // For && and || logical operators
    
    // TypeScript/JavaScript specific
    'do_statement',          // do...while loops
    'for_in_statement',      // for...in loops
    'for_of_statement',      // for...of loops
    
    // PHP specific
    'foreach_statement',     // PHP foreach loops
    
    // Python specific
    'elif_clause',           // Python elif (adds decision point)
    // Note: 'else_clause' is NOT a decision point (it's the default path)
    'except_clause',         // Python except (try/except)
    'conditional_expression', // Python ternary (x if cond else y)
  ];
  
  function traverse(n: Parser.SyntaxNode) {
    if (decisionPoints.includes(n.type)) {
      // For binary expressions, only count && and ||
      if (n.type === 'binary_expression') {
        const operator = n.childForFieldName('operator');
        if (operator && (operator.text === '&&' || operator.text === '||')) {
          complexity++;
        }
      } else {
        complexity++;
      }
    }
    
    // Traverse children
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) traverse(child);
    }
  }
  
  traverse(node);
  return complexity;
}

/**
 * Calculate cognitive complexity of a function
 * 
 * Based on SonarSource's Cognitive Complexity specification:
 * - +1 for each break from linear flow (if, for, while, catch, etc.)
 * - +1 for each nesting level when inside a control structure
 * - +1 for each logical operator sequence break (a && b || c)
 * 
 * Unlike cyclomatic complexity, cognitive complexity penalizes NESTING,
 * making it a better measure of code understandability.
 * 
 * @see https://www.sonarsource.com/docs/CognitiveComplexity.pdf
 */
export function calculateCognitiveComplexity(node: Parser.SyntaxNode): number {
  let complexity = 0;
  
  // Node types that increase complexity AND increment nesting for children
  const nestingTypes = new Set([
    // Common across languages
    'if_statement',
    'for_statement',
    'while_statement',
    'switch_statement',
    'catch_clause',
    'except_clause',      // Python
    
    // TypeScript/JavaScript specific
    'do_statement',
    'for_in_statement',
    'for_of_statement',
    
    // PHP specific
    'foreach_statement',
    
    // Python specific (match/case)
    'match_statement',
  ]);
  
  // Types that add complexity but DON'T nest (hybrid increments)
  const nonNestingTypes = new Set([
    'else_clause',        // else doesn't add nesting penalty
    'elif_clause',        // Python elif
    'ternary_expression', // Ternary operator
    'conditional_expression', // Python ternary
  ]);
  
  // Types that contain the body we should traverse with increased nesting
  const bodyFieldNames = ['consequence', 'body', 'alternative'];
  
  function traverse(n: Parser.SyntaxNode, nestingLevel: number, lastLogicalOp: string | null): void {
    // Check for binary logical operators (&&, ||, and, or)
    if (n.type === 'binary_expression' || n.type === 'boolean_operator') {
      const operator = n.childForFieldName('operator');
      const opText = operator?.text;
      
      // Only count &&, ||, and, or
      if (opText === '&&' || opText === '||' || opText === 'and' || opText === 'or') {
        // Normalize operator (treat 'and' as '&&', 'or' as '||')
        const normalizedOp = (opText === 'and' || opText === '&&') ? '&&' : '||';
        
        // Only increment when operator CHANGES (sequence break)
        // e.g., a && b && c = +1, but a && b || c = +2
        if (lastLogicalOp !== normalizedOp) {
          complexity += 1;
        }
        
        // Traverse children with this operator context
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i);
          if (child && child !== operator) {
            traverse(child, nestingLevel, normalizedOp);
          }
        }
        return;
      }
    }
    
    // Check for nesting control structures
    if (nestingTypes.has(n.type)) {
      // Base increment for the structure itself
      complexity += 1;
      // Nesting penalty (this is the key difference from cyclomatic!)
      complexity += nestingLevel;
      
      // Find and traverse children with increased nesting
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) {
          // Condition doesn't increase nesting
          const isCondition = n.childForFieldName('condition') === child;
          // Body/consequence/alternative increase nesting
          const isBody = bodyFieldNames.some(field => n.childForFieldName(field) === child);
          
          if (isCondition) {
            traverse(child, nestingLevel, null);
          } else if (isBody) {
            traverse(child, nestingLevel + 1, null);
          } else {
            traverse(child, nestingLevel + 1, null);
          }
        }
      }
      return;
    }
    
    // Non-nesting increments (else, elif, ternary)
    if (nonNestingTypes.has(n.type)) {
      complexity += 1;
      // Don't increase nesting for these
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) traverse(child, nestingLevel, null);
      }
      return;
    }
    
    // Recursion: function calling itself (adds complexity)
    // We detect this by looking for call expressions with the same name as an ancestor function
    // This is a simplified check - full detection would require tracking function name
    
    // Lambda/arrow functions nested inside other functions add nesting
    const lambdaTypes = new Set(['arrow_function', 'function_expression', 'lambda']);
    if (lambdaTypes.has(n.type) && nestingLevel > 0) {
      // Nested lambda adds a nesting increment
      complexity += 1;
    }
    
    // Regular traversal for other nodes
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) traverse(child, nestingLevel, null);
    }
  }
  
  traverse(node, 0, null);
  return complexity;
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


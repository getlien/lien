import type Parser from 'tree-sitter';
import type { SymbolInfo } from './types.js';

/**
 * Extract symbol information from an AST node
 * 
 * @param node - AST node to extract info from
 * @param content - Source code content
 * @param parentClass - Parent class name if this is a method
 * @returns Symbol information or null
 */
export function extractSymbolInfo(
  node: Parser.SyntaxNode,
  content: string,
  parentClass?: string
): SymbolInfo | null {
  const type = node.type;
  
  // Function declaration
  if (type === 'function_declaration' || type === 'function') {
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
  
  // Arrow function / function expression
  if (type === 'arrow_function' || type === 'function_expression') {
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
  
  // Method definition
  if (type === 'method_definition') {
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
  
  // Class declaration
  if (type === 'class_declaration') {
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
  
  // Interface declaration (TypeScript)
  if (type === 'interface_declaration') {
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
  
  return null;
}

/**
 * Extract function/method signature
 */
function extractSignature(node: Parser.SyntaxNode, _content: string): string {
  // Get the first line of the function (up to opening brace or arrow)
  const startLine = node.startPosition.row;
  const lines = _content.split('\n');
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
 * Decision points: if, while, do...while, for, for...in, for...of, case, catch, &&, ||, ?:
 */
export function calculateComplexity(node: Parser.SyntaxNode): number {
  let complexity = 1; // Base complexity
  
  const decisionPoints = [
    'if_statement',
    'while_statement',
    'do_statement',        // do...while loops
    'for_statement',
    'for_in_statement',
    'for_of_statement',    // for...of loops
    'switch_case',
    'catch_clause',
    'ternary_expression',
    'binary_expression', // For && and ||
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
 * Extract import statements from a file
 */
export function extractImports(rootNode: Parser.SyntaxNode): string[] {
  const imports: string[] = [];
  
  function traverse(node: Parser.SyntaxNode) {
    if (node.type === 'import_statement') {
      // Get the source (the string after 'from')
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const importPath = sourceNode.text.replace(/['"]/g, '');
        imports.push(importPath);
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


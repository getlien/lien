import type Parser from 'tree-sitter';

/** Raw Halstead counts from AST */
export interface HalsteadCounts {
  n1: number;  // distinct operators
  n2: number;  // distinct operands
  N1: number;  // total operators
  N2: number;  // total operands
  operators: Map<string, number>;  // operator -> count
  operands: Map<string, number>;   // operand -> count
}

/** Calculated Halstead metrics */
export interface HalsteadMetrics {
  vocabulary: number;   // n = n1 + n2
  length: number;       // N = N1 + N2
  volume: number;       // V = N × log₂(n)
  difficulty: number;   // D = (n1/2) × (N2/n2)
  effort: number;       // E = D × V
  time: number;         // T = E / 18 (seconds to understand)
  bugs: number;         // B = V / 3000 (estimated delivered bugs)
}

/** 
 * Language-specific operator symbols.
 * These are the actual text values we match against.
 */
const OPERATOR_SYMBOLS: Record<string, Set<string>> = {
  typescript: new Set([
    // Arithmetic
    '+', '-', '*', '/', '%', '**',
    // Comparison
    '==', '===', '!=', '!==', '<', '>', '<=', '>=',
    // Logical
    '&&', '||', '!', '??',
    // Assignment
    '=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=',
    // Bitwise
    '&', '|', '^', '~', '<<', '>>', '>>>',
    '&=', '|=', '^=', '<<=', '>>=', '>>>=',
    // Other
    '?', ':', '.', '?.', '++', '--', '...', '=>',
    // Brackets/parens (counted as operators)
    '(', ')', '[', ']', '{', '}',
  ]),
  python: new Set([
    // Arithmetic
    '+', '-', '*', '/', '%', '**', '//',
    // Comparison
    '==', '!=', '<', '>', '<=', '>=',
    // Logical (handled via keywords below)
    // Assignment
    '=', '+=', '-=', '*=', '/=', '%=', '**=', '//=',
    '&=', '|=', '^=', '<<=', '>>=',
    // Bitwise
    '&', '|', '^', '~', '<<', '>>',
    // Other
    '.', ':', '->', '@',
    '(', ')', '[', ']', '{', '}',
  ]),
  php: new Set([
    // Arithmetic
    '+', '-', '*', '/', '%', '**',
    // Comparison
    '==', '===', '!=', '!==', '<>', '<', '>', '<=', '>=', '<=>',
    // Logical
    '&&', '||', '!', 'and', 'or', 'xor',
    // Assignment
    '=', '+=', '-=', '*=', '/=', '%=', '**=', '.=',
    '&=', '|=', '^=', '<<=', '>>=', '??=',
    // Bitwise
    '&', '|', '^', '~', '<<', '>>',
    // String
    '.',
    // Other
    '?', ':', '::', '->', '=>', '??', '@',
    '(', ')', '[', ']', '{', '}',
  ]),
};

/** 
 * Language-specific operator keywords.
 * These are keywords that act as operators.
 */
const OPERATOR_KEYWORDS: Record<string, Set<string>> = {
  typescript: new Set([
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
    'return', 'throw', 'try', 'catch', 'finally',
    'new', 'delete', 'typeof', 'instanceof', 'in', 'of',
    'await', 'yield', 'break', 'continue',
    'const', 'let', 'var', 'function', 'class', 'extends', 'implements',
    'import', 'export', 'from', 'as',
  ]),
  python: new Set([
    'if', 'elif', 'else', 'for', 'while', 'match', 'case',
    'return', 'raise', 'try', 'except', 'finally',
    'and', 'or', 'not', 'is', 'in',
    'await', 'yield', 'break', 'continue', 'pass',
    'def', 'class', 'lambda', 'async',
    'import', 'from', 'as', 'with',
    'global', 'nonlocal', 'del', 'assert',
  ]),
  php: new Set([
    'if', 'elseif', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'case', 'default', 'match',
    'return', 'throw', 'try', 'catch', 'finally',
    'new', 'clone', 'instanceof',
    'yield', 'break', 'continue',
    'function', 'class', 'extends', 'implements', 'trait', 'interface',
    'use', 'namespace', 'as',
    'echo', 'print', 'include', 'require', 'include_once', 'require_once',
    'global', 'static', 'const', 'public', 'private', 'protected', 'readonly',
  ]),
};

/** 
 * AST node types that represent operators (language-agnostic).
 * These are the tree-sitter node types, not the text content.
 */
const OPERATOR_NODE_TYPES = new Set([
  // Expression operators
  'binary_expression',
  'unary_expression',
  'update_expression',
  'assignment_expression',
  'augmented_assignment_expression',
  'ternary_expression',
  'conditional_expression',
  
  // Call/access operators
  'call_expression',
  'method_call',
  'member_expression',
  'subscript_expression',
  'attribute',
  
  // Object/array literals ([] and {} are operators)
  'array',
  'object',
  'dictionary',
  'list',
]);

/**
 * AST node types that represent operands.
 */
const OPERAND_NODE_TYPES = new Set([
  // Identifiers
  'identifier',
  'property_identifier',
  'shorthand_property_identifier',
  'variable_name',
  'name',
  
  // Literals
  'number',
  'integer',
  'float',
  'string',
  'string_fragment',
  'template_string',
  'true',
  'false',
  'null',
  'undefined',
  'none',
  
  // Special
  'this',
  'self',
  'super',
]);

/**
 * Get the operator set for a language (with fallback to typescript)
 */
function getOperatorSymbols(language: string): Set<string> {
  return OPERATOR_SYMBOLS[language] || OPERATOR_SYMBOLS.typescript;
}

/**
 * Get the keyword set for a language (with fallback to typescript)
 */
function getOperatorKeywords(language: string): Set<string> {
  return OPERATOR_KEYWORDS[language] || OPERATOR_KEYWORDS.typescript;
}

/**
 * Check if a node represents an operator
 */
function isOperator(node: Parser.SyntaxNode, language: string): boolean {
  const nodeType = node.type;
  const nodeText = node.text;
  
  // Check if it's an operator node type
  if (OPERATOR_NODE_TYPES.has(nodeType)) {
    return true;
  }
  
  // Check if it's an operator symbol or keyword
  const symbols = getOperatorSymbols(language);
  const keywords = getOperatorKeywords(language);
  
  return symbols.has(nodeText) || keywords.has(nodeText);
}

/**
 * Check if a node represents an operand
 */
function isOperand(node: Parser.SyntaxNode): boolean {
  return OPERAND_NODE_TYPES.has(node.type);
}

/**
 * Get the canonical key for an operator (for counting distinct operators)
 */
function getOperatorKey(node: Parser.SyntaxNode): string {
  // For complex expressions, use the operator type
  if (OPERATOR_NODE_TYPES.has(node.type)) {
    // For binary/unary expressions, extract the actual operator
    const operator = node.childForFieldName('operator');
    if (operator) {
      return operator.text;
    }
    return node.type;
  }
  return node.text;
}

/**
 * Get the canonical key for an operand (for counting distinct operands)
 */
function getOperandKey(node: Parser.SyntaxNode): string {
  return node.text;
}

/**
 * Sum all values in a map
 */
function sumValues(map: Map<string, number>): number {
  let sum = 0;
  for (const count of map.values()) {
    sum += count;
  }
  return sum;
}

/**
 * Count operators and operands in an AST node
 * 
 * @param node - AST node to analyze (typically a function/method)
 * @param language - Programming language for language-specific handling
 * @returns HalsteadCounts with raw operator/operand counts
 */
export function countHalstead(node: Parser.SyntaxNode, language: string): HalsteadCounts {
  const operators = new Map<string, number>();
  const operands = new Map<string, number>();
  
  function traverse(n: Parser.SyntaxNode): void {
    // Check if this is an operator
    if (isOperator(n, language)) {
      const key = getOperatorKey(n);
      operators.set(key, (operators.get(key) || 0) + 1);
    }
    
    // Check if this is an operand
    if (isOperand(n)) {
      const key = getOperandKey(n);
      operands.set(key, (operands.get(key) || 0) + 1);
    }
    
    // Recurse into children
    for (const child of n.children) {
      traverse(child);
    }
  }
  
  traverse(node);
  
  return {
    n1: operators.size,
    n2: operands.size,
    N1: sumValues(operators),
    N2: sumValues(operands),
    operators,
    operands,
  };
}

/**
 * Calculate derived Halstead metrics from raw counts
 * 
 * Formulas based on Maurice Halstead's "Elements of Software Science" (1977):
 * - Vocabulary (n) = n1 + n2
 * - Length (N) = N1 + N2
 * - Volume (V) = N × log₂(n) - size of implementation
 * - Difficulty (D) = (n1/2) × (N2/n2) - error-proneness
 * - Effort (E) = D × V - mental effort required
 * - Time (T) = E / 18 - seconds to understand (Stroud number)
 * - Bugs (B) = V / 3000 - estimated delivered bugs
 * 
 * @param counts - Raw Halstead counts from countHalstead()
 * @returns Calculated HalsteadMetrics
 */
export function calculateHalsteadMetrics(counts: HalsteadCounts): HalsteadMetrics {
  const { n1, n2, N1, N2 } = counts;
  
  const vocabulary = n1 + n2;
  const length = N1 + N2;
  
  // Avoid log(0) and division by zero
  const volume = vocabulary > 0 ? length * Math.log2(vocabulary) : 0;
  const difficulty = n2 > 0 ? (n1 / 2) * (N2 / n2) : 0;
  const effort = difficulty * volume;
  const time = effort / 18;  // Stroud number (18 mental discriminations per second)
  const bugs = volume / 3000;
  
  return {
    vocabulary: Math.round(vocabulary),
    length: Math.round(length),
    volume: Math.round(volume * 100) / 100,
    difficulty: Math.round(difficulty * 100) / 100,
    effort: Math.round(effort),
    time: Math.round(time),
    bugs: Math.round(bugs * 1000) / 1000,
  };
}

/**
 * Calculate Halstead metrics for an AST node in one call
 * 
 * Convenience function that combines countHalstead and calculateHalsteadMetrics.
 * 
 * @param node - AST node to analyze
 * @param language - Programming language
 * @returns Calculated HalsteadMetrics
 */
export function calculateHalstead(node: Parser.SyntaxNode, language: string): HalsteadMetrics {
  const counts = countHalstead(node, language);
  return calculateHalsteadMetrics(counts);
}

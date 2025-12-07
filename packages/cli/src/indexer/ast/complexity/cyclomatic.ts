import type Parser from 'tree-sitter';

/**
 * Decision point node types for cyclomatic complexity calculation.
 * 
 * These AST node types represent branch points in code flow.
 */
const DECISION_POINTS = [
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

/**
 * Calculate cyclomatic complexity of a function
 * 
 * Complexity = 1 (base) + number of decision points
 * Decision points: if, while, do...while, for, for...in, for...of, foreach, case, catch, &&, ||, ?:
 * 
 * @param node - AST node to analyze (typically a function/method)
 * @returns Cyclomatic complexity score (minimum 1)
 */
export function calculateComplexity(node: Parser.SyntaxNode): number {
  let complexity = 1; // Base complexity
  
  function traverse(n: Parser.SyntaxNode) {
    if (DECISION_POINTS.includes(n.type)) {
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

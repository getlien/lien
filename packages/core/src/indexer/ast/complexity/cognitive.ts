import type Parser from 'tree-sitter';

// Node types that increase complexity AND increment nesting for children
const NESTING_TYPES = new Set([
  'if_statement', 'for_statement', 'while_statement', 'switch_statement',
  'catch_clause', 'except_clause', 'do_statement', 'for_in_statement',
  'for_of_statement', 'foreach_statement', 'match_statement',
]);

// Types that add complexity but DON'T nest (hybrid increments)
const NON_NESTING_TYPES = new Set([
  'else_clause', 'elif_clause', 'ternary_expression', 'conditional_expression',
]);

// Lambda types that add complexity when nested
const LAMBDA_TYPES = new Set(['arrow_function', 'function_expression', 'lambda']);

/** Traversal context passed to handlers */
interface TraversalContext {
  traverse: (n: Parser.SyntaxNode, level: number, lastOp: string | null) => void;
}

/**
 * Check if node is a logical operator and return normalized form
 */
function getLogicalOperator(node: Parser.SyntaxNode): string | null {
  if (node.type !== 'binary_expression' && node.type !== 'boolean_operator') {
    return null;
  }
  const operator = node.childForFieldName('operator');
  const opText = operator?.text;
  
  if (opText === '&&' || opText === 'and') return '&&';
  if (opText === '||' || opText === 'or') return '||';
  return null;
}

/**
 * Determine nesting level for a child node based on SonarSource spec.
 */
function getChildNestingLevel(
  parent: Parser.SyntaxNode,
  child: Parser.SyntaxNode,
  currentLevel: number
): number {
  const isCondition = parent.childForFieldName('condition') === child;
  const isElseClause = NON_NESTING_TYPES.has(child.type);
  return (!isCondition && !isElseClause) ? currentLevel + 1 : currentLevel;
}

/**
 * Get complexity increment for nested lambda (only adds if already nested)
 */
function getNestedLambdaIncrement(nodeType: string, nestingLevel: number): number {
  return (LAMBDA_TYPES.has(nodeType) && nestingLevel > 0) ? 1 : 0;
}

/** Traverse logical operator children, passing the operator type */
function traverseLogicalChildren(
  n: Parser.SyntaxNode,
  level: number,
  op: string,
  ctx: TraversalContext
): void {
  const operator = n.childForFieldName('operator');
  for (let i = 0; i < n.namedChildCount; i++) {
    const child = n.namedChild(i);
    if (child && child !== operator) ctx.traverse(child, level, op);
  }
}

/** Traverse nesting type children with proper nesting level adjustment */
function traverseNestingChildren(
  n: Parser.SyntaxNode,
  level: number,
  ctx: TraversalContext
): void {
  for (let i = 0; i < n.namedChildCount; i++) {
    const child = n.namedChild(i);
    if (child) ctx.traverse(child, getChildNestingLevel(n, child, level), null);
  }
}

/** Traverse all children at specified level */
function traverseAllChildren(
  n: Parser.SyntaxNode,
  level: number,
  ctx: TraversalContext
): void {
  for (let i = 0; i < n.namedChildCount; i++) {
    const child = n.namedChild(i);
    if (child) ctx.traverse(child, level, null);
  }
}

/**
 * Calculate cognitive complexity of a function
 * 
 * Based on SonarSource's Cognitive Complexity specification:
 * - +1 for each break from linear flow (if, for, while, catch, etc.)
 * - +1 for each nesting level when inside a control structure
 * - +1 for each logical operator sequence break (a && b || c)
 * 
 * @see https://www.sonarsource.com/docs/CognitiveComplexity.pdf
 * 
 * @param node - AST node to analyze (typically a function/method)
 * @returns Cognitive complexity score (minimum 0)
 */
export function calculateCognitiveComplexity(node: Parser.SyntaxNode): number {
  let complexity = 0;
  const ctx: TraversalContext = { traverse };
  
  function traverse(n: Parser.SyntaxNode, nestingLevel: number, lastLogicalOp: string | null): void {
    const logicalOp = getLogicalOperator(n);
    
    if (logicalOp) {
      complexity += (lastLogicalOp !== logicalOp) ? 1 : 0;
      traverseLogicalChildren(n, nestingLevel, logicalOp, ctx);
      return;
    }
    
    if (NESTING_TYPES.has(n.type)) {
      complexity += 1 + nestingLevel;
      traverseNestingChildren(n, nestingLevel, ctx);
      return;
    }
    
    if (NON_NESTING_TYPES.has(n.type)) {
      complexity += 1;
      traverseAllChildren(n, nestingLevel + 1, ctx);
      return;
    }
    
    complexity += getNestedLambdaIncrement(n.type, nestingLevel);
    traverseAllChildren(n, nestingLevel, ctx);
  }
  
  traverse(node, 0, null);
  return complexity;
}

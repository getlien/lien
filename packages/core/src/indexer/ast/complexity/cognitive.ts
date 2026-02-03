import type Parser from 'tree-sitter';
import { getAllLanguages } from '../languages/registry.js';

/**
 * Lazily-built union sets from all language definitions.
 */
let nestingTypesCache: Set<string> | null = null;
let nonNestingTypesCache: Set<string> | null = null;
let lambdaTypesCache: Set<string> | null = null;

function getNestingTypes(): Set<string> {
  if (!nestingTypesCache) {
    nestingTypesCache = new Set<string>();
    for (const lang of getAllLanguages()) {
      for (const type of lang.complexity.nestingTypes) {
        nestingTypesCache.add(type);
      }
    }
  }
  return nestingTypesCache;
}

function getNonNestingTypes(): Set<string> {
  if (!nonNestingTypesCache) {
    nonNestingTypesCache = new Set<string>();
    for (const lang of getAllLanguages()) {
      for (const type of lang.complexity.nonNestingTypes) {
        nonNestingTypesCache.add(type);
      }
    }
  }
  return nonNestingTypesCache;
}

function getLambdaTypes(): Set<string> {
  if (!lambdaTypesCache) {
    lambdaTypesCache = new Set<string>();
    for (const lang of getAllLanguages()) {
      for (const type of lang.complexity.lambdaTypes) {
        lambdaTypesCache.add(type);
      }
    }
  }
  return lambdaTypesCache;
}

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
  currentLevel: number,
  nonNestingTypes: Set<string>
): number {
  const isCondition = parent.childForFieldName('condition') === child;
  const isNonNestingChild = nonNestingTypes.has(child.type);
  return (!isCondition && !isNonNestingChild) ? currentLevel + 1 : currentLevel;
}

/**
 * Get complexity increment for nested lambda (only adds if already nested)
 */
function getNestedLambdaIncrement(nodeType: string, nestingLevel: number, lambdaTypes: Set<string>): number {
  return (lambdaTypes.has(nodeType) && nestingLevel > 0) ? 1 : 0;
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
  nonNestingTypes: Set<string>,
  ctx: TraversalContext
): void {
  for (let i = 0; i < n.namedChildCount; i++) {
    const child = n.namedChild(i);
    if (child) ctx.traverse(child, getChildNestingLevel(n, child, level, nonNestingTypes), null);
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
  const nestingTypes = getNestingTypes();
  const nonNestingTypes = getNonNestingTypes();
  const lambdaTypes = getLambdaTypes();

  function traverse(n: Parser.SyntaxNode, nestingLevel: number, lastLogicalOp: string | null): void {
    const logicalOp = getLogicalOperator(n);

    if (logicalOp) {
      complexity += (lastLogicalOp !== logicalOp) ? 1 : 0;
      traverseLogicalChildren(n, nestingLevel, logicalOp, ctx);
      return;
    }

    if (nestingTypes.has(n.type)) {
      complexity += 1 + nestingLevel;
      traverseNestingChildren(n, nestingLevel, nonNestingTypes, ctx);
      return;
    }

    if (nonNestingTypes.has(n.type)) {
      complexity += 1;
      traverseAllChildren(n, nestingLevel + 1, ctx);
      return;
    }

    complexity += getNestedLambdaIncrement(n.type, nestingLevel, lambdaTypes);
    traverseAllChildren(n, nestingLevel, ctx);
  }

  traverse(node, 0, null);
  return complexity;
}

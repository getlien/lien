import type Parser from 'tree-sitter';
import { getAllLanguages } from '../languages/registry.js';

/**
 * Build the union set of decision point node types from all language definitions.
 * Lazily initialized on first use.
 */
let decisionPointsCache: Set<string> | null = null;

function getDecisionPoints(): Set<string> {
  if (!decisionPointsCache) {
    const set = new Set<string>();
    for (const lang of getAllLanguages()) {
      for (const type of lang.complexity.decisionPoints) {
        set.add(type);
      }
    }
    decisionPointsCache = set;
  }
  return decisionPointsCache;
}

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
  const decisionPoints = getDecisionPoints();

  function traverse(n: Parser.SyntaxNode) {
    if (decisionPoints.has(n.type)) {
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

/**
 * Complexity metrics module
 * 
 * This module provides various code complexity metrics:
 * - Cyclomatic complexity: Counts decision points (branches) in code
 * - Cognitive complexity: Measures mental effort to understand code (SonarSource spec)
 * - Halstead metrics: Measures complexity based on operators/operands
 */

export { calculateComplexity } from './cyclomatic.js';
export { calculateCognitiveComplexity } from './cognitive.js';
export { 
  countHalstead, 
  calculateHalsteadMetrics, 
  calculateHalstead,
} from './halstead.js';
export type { HalsteadCounts, HalsteadMetrics } from './halstead.js';

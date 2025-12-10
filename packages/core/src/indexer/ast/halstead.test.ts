import { describe, it, expect } from 'vitest';
import { countHalstead, calculateHalstead, calculateHalsteadMetrics } from './complexity/index.js';
import { parseAST } from './parser.js';
import type { SupportedLanguage } from './types.js';
import type Parser from 'tree-sitter';

/**
 * Helper to calculate Halstead metrics of a function in TypeScript code
 */
function getHalstead(code: string, language: SupportedLanguage = 'typescript') {
  const result = parseAST(code, language);
  if (!result.tree) throw new Error('Failed to parse code');
  
  // Find the first function node
  const findFunction = (node: Parser.SyntaxNode): Parser.SyntaxNode | null => {
    if (
      node.type === 'function_declaration' ||
      node.type === 'arrow_function' ||
      node.type === 'method_definition' ||
      node.type === 'function_definition' // Python
    ) {
      return node;
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        const found = findFunction(child);
        if (found) return found;
      }
    }
    return null;
  };
  
  const funcNode = findFunction(result.tree.rootNode);
  if (!funcNode) throw new Error('No function found in code');
  
  return calculateHalstead(funcNode, language);
}

/**
 * Helper to get raw Halstead counts
 */
function getHalsteadCounts(code: string, language: SupportedLanguage = 'typescript') {
  const result = parseAST(code, language);
  if (!result.tree) throw new Error('Failed to parse code');
  
  const findFunction = (node: Parser.SyntaxNode): Parser.SyntaxNode | null => {
    if (
      node.type === 'function_declaration' ||
      node.type === 'arrow_function' ||
      node.type === 'method_definition' ||
      node.type === 'function_definition'
    ) {
      return node;
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        const found = findFunction(child);
        if (found) return found;
      }
    }
    return null;
  };
  
  const funcNode = findFunction(result.tree.rootNode);
  if (!funcNode) throw new Error('No function found in code');
  
  return countHalstead(funcNode, language);
}

describe('Halstead Metrics', () => {
  describe('basic counting', () => {
    it('should count operators and operands in simple assignment', () => {
      const code = `
        function simple() {
          const a = 1;
          return a;
        }
      `;
      const counts = getHalsteadCounts(code);
      
      // Operators: =, return
      // Operands: a, 1, a (return)
      expect(counts.n1).toBeGreaterThan(0); // distinct operators
      expect(counts.n2).toBeGreaterThan(0); // distinct operands
      expect(counts.N1).toBeGreaterThan(0); // total operators
      expect(counts.N2).toBeGreaterThan(0); // total operands
    });

    it('should count arithmetic operators', () => {
      const code = `
        function add(a: number, b: number) {
          return a + b;
        }
      `;
      const counts = getHalsteadCounts(code);
      
      // Should have + operator
      expect(counts.operators.has('+')).toBe(true);
    });

    it('should count comparison operators', () => {
      const code = `
        function compare(a: number, b: number) {
          if (a > b) {
            return a;
          }
          return b;
        }
      `;
      const counts = getHalsteadCounts(code);
      
      // Should have > operator
      expect(counts.operators.has('>')).toBe(true);
    });

    it('should count logical operators', () => {
      const code = `
        function check(a: boolean, b: boolean) {
          return a && b || !a;
        }
      `;
      const counts = getHalsteadCounts(code);
      
      // Should have &&, ||, ! operators
      expect(counts.operators.has('&&')).toBe(true);
      expect(counts.operators.has('||')).toBe(true);
      expect(counts.operators.has('!')).toBe(true);
    });

    it('should count identifiers as operands', () => {
      const code = `
        function example() {
          const foo = 1;
          const bar = 2;
          return foo + bar;
        }
      `;
      const counts = getHalsteadCounts(code);
      
      // foo and bar should be operands
      expect(counts.operands.has('foo')).toBe(true);
      expect(counts.operands.has('bar')).toBe(true);
    });

    it('should count literals as operands', () => {
      const code = `
        function example() {
          return 42 + 3.14;
        }
      `;
      const counts = getHalsteadCounts(code);
      
      // Numbers should be operands
      expect(counts.operands.has('42')).toBe(true);
      expect(counts.operands.has('3.14')).toBe(true);
    });
  });

  describe('derived metrics calculation', () => {
    it('should calculate volume (N × log₂(n))', () => {
      const counts = {
        n1: 4,  // 4 distinct operators
        n2: 6,  // 6 distinct operands
        N1: 10, // 10 total operators
        N2: 12, // 12 total operands
        operators: new Map<string, number>(),
        operands: new Map<string, number>(),
      };
      
      const metrics = calculateHalsteadMetrics(counts);
      
      // n = n1 + n2 = 10
      // N = N1 + N2 = 22
      // V = N × log₂(n) = 22 × log₂(10) ≈ 73.1
      expect(metrics.vocabulary).toBe(10);
      expect(metrics.length).toBe(22);
      expect(metrics.volume).toBeCloseTo(73.1, 0);
    });

    it('should calculate difficulty correctly', () => {
      const counts = {
        n1: 4,  // 4 distinct operators
        n2: 6,  // 6 distinct operands
        N1: 10, // 10 total operators
        N2: 12, // 12 total operands
        operators: new Map<string, number>(),
        operands: new Map<string, number>(),
      };
      
      const metrics = calculateHalsteadMetrics(counts);
      
      // D = (n1/2) × (N2/n2) = (4/2) × (12/6) = 2 × 2 = 4
      expect(metrics.difficulty).toBe(4);
    });

    it('should calculate effort as D × V (rounded)', () => {
      const counts = {
        n1: 4,
        n2: 6,
        N1: 10,
        N2: 12,
        operators: new Map<string, number>(),
        operands: new Map<string, number>(),
      };
      
      const metrics = calculateHalsteadMetrics(counts);
      
      // E = D × V (implementation rounds to integer)
      // Allow for rounding: effort should be within 1 of D × V
      const expectedEffort = metrics.difficulty * metrics.volume;
      expect(Math.abs(metrics.effort - expectedEffort)).toBeLessThan(1);
    });

    it('should estimate bugs as V / 3000 (rounded)', () => {
      const counts = {
        n1: 4,
        n2: 6,
        N1: 10,
        N2: 12,
        operators: new Map<string, number>(),
        operands: new Map<string, number>(),
      };
      
      const metrics = calculateHalsteadMetrics(counts);
      
      // B = V / 3000 (implementation rounds to 3 decimal places)
      const expectedBugs = metrics.volume / 3000;
      expect(Math.abs(metrics.bugs - expectedBugs)).toBeLessThan(0.001);
    });

    it('should handle edge case with zero operands', () => {
      const counts = {
        n1: 2,
        n2: 0,  // no distinct operands
        N1: 2,
        N2: 0,  // no total operands
        operators: new Map<string, number>(),
        operands: new Map<string, number>(),
      };
      
      const metrics = calculateHalsteadMetrics(counts);
      
      // Should not throw, should handle division by zero gracefully
      expect(metrics.difficulty).toBe(0);
      expect(metrics.effort).toBe(0);
    });
  });

  describe('full integration', () => {
    it('should calculate metrics for a simple function', () => {
      const code = `
        function add(a: number, b: number): number {
          return a + b;
        }
      `;
      const metrics = getHalstead(code);
      
      expect(metrics.volume).toBeGreaterThan(0);
      expect(metrics.difficulty).toBeGreaterThan(0);
      expect(metrics.effort).toBeGreaterThan(0);
      expect(metrics.bugs).toBeGreaterThanOrEqual(0);
    });

    it('should calculate higher metrics for more complex function', () => {
      const simpleCode = `
        function simple(a: number) {
          return a;
        }
      `;
      
      const complexCode = `
        function complex(a: number, b: number, c: number) {
          if (a > b && b > c) {
            const sum = a + b + c;
            const avg = sum / 3;
            return avg * 2;
          } else if (a < b || c === 0) {
            return a - b - c;
          }
          return a * b * c;
        }
      `;
      
      const simpleMetrics = getHalstead(simpleCode);
      const complexMetrics = getHalstead(complexCode);
      
      // Complex function should have higher metrics
      expect(complexMetrics.volume).toBeGreaterThan(simpleMetrics.volume);
      expect(complexMetrics.effort).toBeGreaterThan(simpleMetrics.effort);
    });

    it('should work with arrow functions', () => {
      const code = `
        const multiply = (x: number, y: number) => x * y;
      `;
      const metrics = getHalstead(code);
      
      expect(metrics.volume).toBeGreaterThan(0);
      expect(metrics.difficulty).toBeGreaterThan(0);
    });
  });

  describe('language support', () => {
    it('should handle JavaScript-specific operators', () => {
      const code = `
        function example(obj) {
          return obj?.prop ?? 'default';
        }
      `;
      const counts = getHalsteadCounts(code, 'javascript');
      
      // Should recognize ?. and ?? operators
      expect(counts.N1).toBeGreaterThan(0);
    });

    it('should handle Python operators', () => {
      const code = `
def example(a, b):
    return a and b or not a
      `;
      const counts = getHalsteadCounts(code, 'python');
      
      // Should recognize and, or, not as operators
      expect(counts.N1).toBeGreaterThan(0);
      expect(counts.N2).toBeGreaterThan(0);
    });
  });

  describe('real-world examples', () => {
    it('should calculate reasonable metrics for a sorting function', () => {
      const code = `
        function bubbleSort(arr: number[]): number[] {
          const n = arr.length;
          for (let i = 0; i < n - 1; i++) {
            for (let j = 0; j < n - i - 1; j++) {
              if (arr[j] > arr[j + 1]) {
                const temp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = temp;
              }
            }
          }
          return arr;
        }
      `;
      const metrics = getHalstead(code);
      
      // Should have non-trivial complexity
      expect(metrics.volume).toBeGreaterThan(100);
      expect(metrics.difficulty).toBeGreaterThan(5);
      expect(metrics.effort).toBeGreaterThan(500);
    });

    it('should show meaningful difference between trivial and complex code', () => {
      const trivial = `
        function identity(x: number) {
          return x;
        }
      `;
      
      const complex = `
        function processData(input: string[], options: { format: string; validate: boolean }) {
          const results: string[] = [];
          for (let i = 0; i < input.length; i++) {
            const item = input[i];
            if (options.validate && !isValid(item)) {
              continue;
            }
            const formatted = options.format === 'upper' 
              ? item.toUpperCase() 
              : options.format === 'lower'
                ? item.toLowerCase()
                : item;
            results.push(formatted);
          }
          return results;
        }
      `;
      
      const trivialMetrics = getHalstead(trivial);
      const complexMetrics = getHalstead(complex);
      
      // Complex code should have significantly higher effort
      expect(complexMetrics.effort).toBeGreaterThan(trivialMetrics.effort * 5);
    });
  });
});

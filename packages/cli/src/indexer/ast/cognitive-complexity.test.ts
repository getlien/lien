import { describe, it, expect } from 'vitest';
import { calculateCognitiveComplexity } from './complexity/index.js';
import { parseAST } from './parser.js';

/**
 * Helper to calculate cognitive complexity of a function in TypeScript code
 */
function getCognitiveComplexity(code: string): number {
  const result = parseAST(code, 'typescript');
  if (!result.tree) throw new Error('Failed to parse code');
  
  // Find the first function node
  const findFunction = (node: typeof result.tree.rootNode): typeof result.tree.rootNode | null => {
    if (node.type === 'function_declaration' || node.type === 'arrow_function' || node.type === 'method_definition') {
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
  
  return calculateCognitiveComplexity(funcNode);
}

describe('Cognitive Complexity', () => {
  describe('basic structures', () => {
    it('should return 0 for simple linear code', () => {
      const code = `
        function simple() {
          const a = 1;
          const b = 2;
          return a + b;
        }
      `;
      expect(getCognitiveComplexity(code)).toBe(0);
    });

    it('should add +1 for a single if statement', () => {
      const code = `
        function withIf(x: boolean) {
          if (x) {
            return 1;
          }
          return 0;
        }
      `;
      expect(getCognitiveComplexity(code)).toBe(1);
    });

    it('should add +1 for else clause (no nesting penalty)', () => {
      const code = `
        function withElse(x: boolean) {
          if (x) {
            return 1;
          } else {
            return 0;
          }
        }
      `;
      // if = +1, else = +1
      expect(getCognitiveComplexity(code)).toBe(2);
    });

    it('should add +1 for each for loop', () => {
      const code = `
        function withLoop() {
          for (let i = 0; i < 10; i++) {
            console.log(i);
          }
        }
      `;
      expect(getCognitiveComplexity(code)).toBe(1);
    });

    it('should add +1 for while loop', () => {
      const code = `
        function withWhile(x: number) {
          while (x > 0) {
            x--;
          }
        }
      `;
      expect(getCognitiveComplexity(code)).toBe(1);
    });
  });

  describe('nesting penalty', () => {
    it('should add nesting penalty for nested if', () => {
      const code = `
        function nested(a: boolean, b: boolean) {
          if (a) {           // +1 (nesting 0)
            if (b) {         // +2 (nesting 1)
              return true;
            }
          }
          return false;
        }
      `;
      // if = +1, nested if = +1 + 1 (nesting) = +2, total = 3
      expect(getCognitiveComplexity(code)).toBe(3);
    });

    it('should add increasing penalty for deeper nesting', () => {
      const code = `
        function deeplyNested(a: boolean, b: boolean, c: boolean) {
          if (a) {           // +1 (nesting 0)
            if (b) {         // +2 (nesting 1)
              if (c) {       // +3 (nesting 2)
                return true;
              }
            }
          }
          return false;
        }
      `;
      // 1 + 2 + 3 = 6
      expect(getCognitiveComplexity(code)).toBe(6);
    });

    it('should NOT add nesting penalty for else clause body', () => {
      const code = `
        function ifElse(a: boolean, b: boolean) {
          if (a) {           // +1 (nesting 0)
            return 1;
          } else {           // +1 (no nesting penalty for else itself)
            if (b) {         // +2 (nesting 1, inside else body)
              return 2;
            }
          }
          return 0;
        }
      `;
      // if = +1, else = +1, nested if in else = +1 + 1 = +2, total = 4
      expect(getCognitiveComplexity(code)).toBe(4);
    });

    it('should handle for loop nesting', () => {
      const code = `
        function nestedLoops() {
          for (let i = 0; i < 10; i++) {       // +1 (nesting 0)
            for (let j = 0; j < 10; j++) {     // +2 (nesting 1)
              console.log(i, j);
            }
          }
        }
      `;
      // 1 + 2 = 3
      expect(getCognitiveComplexity(code)).toBe(3);
    });
  });

  describe('logical operators', () => {
    it('should add +1 for first logical operator', () => {
      const code = `
        function withAnd(a: boolean, b: boolean) {
          if (a && b) {
            return true;
          }
          return false;
        }
      `;
      // if = +1, && = +1, total = 2
      expect(getCognitiveComplexity(code)).toBe(2);
    });

    it('should NOT add for same operator in sequence', () => {
      const code = `
        function chainedAnd(a: boolean, b: boolean, c: boolean) {
          if (a && b && c) {
            return true;
          }
          return false;
        }
      `;
      // if = +1, && (first) = +1, && (same) = +0, total = 2
      expect(getCognitiveComplexity(code)).toBe(2);
    });

    it('should add +1 when operator changes', () => {
      const code = `
        function mixedOperators(a: boolean, b: boolean, c: boolean) {
          if (a && b || c) {
            return true;
          }
          return false;
        }
      `;
      // if = +1, && = +1, || (different) = +1, total = 3
      expect(getCognitiveComplexity(code)).toBe(3);
    });
  });

  describe('ternary expressions', () => {
    it('should add +1 for ternary (no nesting penalty)', () => {
      const code = `
        function withTernary(x: boolean) {
          return x ? 1 : 0;
        }
      `;
      expect(getCognitiveComplexity(code)).toBe(1);
    });
  });

  describe('switch statements', () => {
    it('should add +1 for switch', () => {
      const code = `
        function withSwitch(x: number) {
          switch (x) {
            case 1: return 'one';
            case 2: return 'two';
            default: return 'other';
          }
        }
      `;
      // switch = +1
      expect(getCognitiveComplexity(code)).toBe(1);
    });
  });

  describe('try-catch', () => {
    it('should add +1 for catch clause', () => {
      const code = `
        function withTryCatch() {
          try {
            doSomething();
          } catch (e) {
            handleError(e);
          }
        }
      `;
      // catch = +1
      expect(getCognitiveComplexity(code)).toBe(1);
    });
  });

  describe('real-world examples', () => {
    it('should calculate complexity for a moderately complex function', () => {
      const code = `
        function processItems(items: string[], options: { verbose: boolean }) {
          if (!items || items.length === 0) {    // +1 (if) + +1 (||)
            return [];
          }
          
          const results = [];
          for (const item of items) {            // +1 (for)
            if (item.startsWith('_')) {          // +2 (if, nesting 1)
              continue;
            }
            
            if (options.verbose) {               // +2 (if, nesting 1)
              console.log(item);
            }
            
            results.push(item.toUpperCase());
          }
          
          return results;
        }
      `;
      // 1 + 1 + 1 + 2 + 2 = 7
      expect(getCognitiveComplexity(code)).toBe(7);
    });
  });
});

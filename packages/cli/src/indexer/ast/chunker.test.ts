import { describe, it, expect } from 'vitest';
import { chunkByAST, shouldUseAST } from './chunker.js';

describe('AST Chunker', () => {
  describe('shouldUseAST', () => {
    it('should return true for TypeScript files', () => {
      expect(shouldUseAST('test.ts')).toBe(true);
      expect(shouldUseAST('test.tsx')).toBe(true);
    });

    it('should return true for JavaScript files', () => {
      expect(shouldUseAST('test.js')).toBe(true);
      expect(shouldUseAST('test.jsx')).toBe(true);
      expect(shouldUseAST('test.mjs')).toBe(true);
      expect(shouldUseAST('test.cjs')).toBe(true);
    });

    it('should return false for unsupported files', () => {
      expect(shouldUseAST('test.py')).toBe(false);
      expect(shouldUseAST('test.go')).toBe(false);
      expect(shouldUseAST('test.txt')).toBe(false);
    });
  });

  describe('chunkByAST', () => {
    it('should chunk a simple function', () => {
      const content = `
function hello() {
  console.log("Hello world");
  return true;
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      
      expect(chunks.length).toBeGreaterThan(0);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'hello');
      
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.symbolType).toBe('function');
      expect(funcChunk?.metadata.type).toBe('function');
      expect(funcChunk?.content).toContain('console.log');
    });

    it('should chunk a class with methods', () => {
      const content = `
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  subtract(a: number, b: number): number {
    return a - b;
  }
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      
      // Should have at least the class chunk
      const classChunk = chunks.find(c => c.metadata.symbolName === 'Calculator');
      expect(classChunk).toBeDefined();
      expect(classChunk?.metadata.symbolType).toBe('class');
      
      // Methods might be included in the class chunk or as separate chunks
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should extract function metadata', () => {
      const content = `
function validateEmail(email: string): boolean {
  if (!email) return false;
  if (!email.includes('@')) return false;
  return true;
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      const chunk = chunks.find(c => c.metadata.symbolName === 'validateEmail');
      
      expect(chunk).toBeDefined();
      expect(chunk?.metadata.symbolName).toBe('validateEmail');
      expect(chunk?.metadata.symbolType).toBe('function');
      expect(chunk?.metadata.complexity).toBeGreaterThan(1); // Has if statements
      expect(chunk?.metadata.parameters).toBeDefined();
      expect(chunk?.metadata.signature).toContain('validateEmail');
    });

    it('should handle arrow functions', () => {
      const content = `
const greet = (name: string) => {
  return \`Hello, \${name}!\`;
};
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      
      // Arrow functions should be detected
      expect(chunks.length).toBeGreaterThan(0);
      const arrowChunk = chunks.find(c => c.metadata.symbolName === 'greet');
      expect(arrowChunk).toBeDefined();
    });

    it('should handle interfaces', () => {
      const content = `
interface User {
  id: number;
  name: string;
  email: string;
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      const interfaceChunk = chunks.find(c => c.metadata.symbolName === 'User');
      
      expect(interfaceChunk).toBeDefined();
      expect(interfaceChunk?.metadata.symbolType).toBe('interface');
    });

    it('should extract imports', () => {
      const content = `
import { foo } from './foo';
import { bar } from './bar';

function test() {
  return foo() + bar();
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'test');
      
      expect(funcChunk?.metadata.imports).toBeDefined();
      expect(funcChunk?.metadata.imports).toContain('./foo');
      expect(funcChunk?.metadata.imports).toContain('./bar');
    });

    it('should calculate cyclomatic complexity', () => {
      const content = `
function complexFunction(x: number): string {
  if (x > 10) {
    if (x > 20) {
      return "very high";
    }
    return "high";
  } else if (x > 5) {
    return "medium";
  } else {
    return "low";
  }
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      const chunk = chunks.find(c => c.metadata.symbolName === 'complexFunction');
      
      expect(chunk?.metadata.complexity).toBeGreaterThan(3); // Multiple if statements
    });

    it('should handle multiple functions in one file', () => {
      const content = `
function first() {
  return 1;
}

function second() {
  return 2;
}

function third() {
  return 3;
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      
      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks.some(c => c.metadata.symbolName === 'first')).toBe(true);
      expect(chunks.some(c => c.metadata.symbolName === 'second')).toBe(true);
      expect(chunks.some(c => c.metadata.symbolName === 'third')).toBe(true);
    });

    it('should handle empty files gracefully', () => {
      const content = '';
      const chunks = chunkByAST('test.ts', content);
      
      // Empty file should produce no chunks or minimal chunks
      expect(chunks.length).toBeGreaterThanOrEqual(0);
    });

    it('should preserve line numbers correctly', () => {
      const content = `
// Line 1
// Line 2
function test() {
  // Line 4
  return true;
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'test');
      
      expect(funcChunk).toBeDefined();
      expect(funcChunk!.metadata.startLine).toBeGreaterThan(0);
      expect(funcChunk!.metadata.endLine).toBeGreaterThan(funcChunk!.metadata.startLine);
    });

    it('should handle JavaScript files', () => {
      const content = `
function add(a, b) {
  return a + b;
}
      `.trim();

      const chunks = chunkByAST('test.js', content);
      const chunk = chunks.find(c => c.metadata.symbolName === 'add');
      
      expect(chunk).toBeDefined();
      expect(chunk?.metadata.language).toBe('javascript');
    });

    it('should handle exported functions', () => {
      const content = `
export function exportedFunc() {
  return "exported";
}

export default function defaultFunc() {
  return "default";
}
      `.trim();

      const chunks = chunkByAST('test.ts', content);
      
      expect(chunks.some(c => c.metadata.symbolName === 'exportedFunc')).toBe(true);
      expect(chunks.some(c => c.metadata.symbolName === 'defaultFunc')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw error for unsupported language', () => {
      const content = 'print("Hello")';
      
      expect(() => chunkByAST('test.py', content)).toThrow();
    });

    it('should handle invalid syntax gracefully', () => {
      const content = 'function invalid() { this is not valid }}}';
      
      // Tree-sitter is resilient and still produces a tree with errors
      // So this should not throw, but return some chunks
      const chunks = chunkByAST('test.ts', content);
      expect(chunks).toBeDefined();
    });
  });
});


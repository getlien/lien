import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import { chunkByAST } from '../chunker.js';
import {
  TypeScriptTraverser,
  TypeScriptExportExtractor,
  TypeScriptImportExtractor,
  TypeScriptSymbolExtractor,
} from './javascript.js';

describe('TypeScript Language', () => {
  const parser = new Parser();
  parser.setLanguage(TypeScript.typescript);
  const traverser = new TypeScriptTraverser();
  const exportExtractor = new TypeScriptExportExtractor();
  const importExtractor = new TypeScriptImportExtractor();
  const symbolExtractor = new TypeScriptSymbolExtractor();

  describe('Traverser', () => {
    it('should identify function declarations as target nodes', () => {
      expect(traverser.targetNodeTypes).toContain('function_declaration');
      expect(traverser.targetNodeTypes).toContain('method_definition');
      expect(traverser.targetNodeTypes).toContain('interface_declaration');
    });

    it('should identify class declarations as containers', () => {
      expect(traverser.containerTypes).toContain('class_declaration');
    });

    it('should extract children from class declarations', () => {
      const code = 'class Foo { bar() {} }';
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      expect(traverser.shouldExtractChildren(classNode)).toBe(true);
    });

    it('should get class body as container body', () => {
      const code = 'class Foo { bar() {} }';
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      const body = traverser.getContainerBody(classNode);
      expect(body).not.toBeNull();
      expect(body!.type).toBe('class_body');
    });

    it('should traverse children of program nodes', () => {
      const code = 'const x = 1;';
      const tree = parser.parse(code);
      expect(traverser.shouldTraverseChildren(tree.rootNode)).toBe(true);
    });

    it('should traverse children of export statements', () => {
      const code = 'export function foo() {}';
      const tree = parser.parse(code);
      const exportNode = tree.rootNode.namedChild(0)!;
      expect(exportNode.type).toBe('export_statement');
      expect(traverser.shouldTraverseChildren(exportNode)).toBe(true);
    });

    it('should detect arrow functions in lexical declarations', () => {
      const code = 'const foo = () => {};';
      const tree = parser.parse(code);
      const declNode = tree.rootNode.namedChild(0)!;
      expect(traverser.isDeclarationWithFunction(declNode)).toBe(true);
      const result = traverser.findFunctionInDeclaration(declNode);
      expect(result.hasFunction).toBe(true);
      expect(result.functionNode?.type).toBe('arrow_function');
    });

    it('should not treat non-function declarations as function declarations', () => {
      const code = 'const x = 42;';
      const tree = parser.parse(code);
      const declNode = tree.rootNode.namedChild(0)!;
      expect(traverser.isDeclarationWithFunction(declNode)).toBe(true);
      const result = traverser.findFunctionInDeclaration(declNode);
      expect(result.hasFunction).toBe(false);
    });

    it('should find parent class name for methods', () => {
      const code = 'class MyClass { myMethod() {} }';
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;
      expect(traverser.findParentContainerName(methodNode)).toBe('MyClass');
    });
  });

  describe('Export Extraction', () => {
    it('should extract named exports', () => {
      const code = 'export { foo, bar };';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['foo', 'bar']);
    });

    it('should extract function declaration exports', () => {
      const code = 'export function validateEmail(): boolean { return true; }';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['validateEmail']);
    });

    it('should extract const exports', () => {
      const code = 'export const MAX_SIZE = 100;';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['MAX_SIZE']);
    });

    it('should extract default exports', () => {
      const code = 'export default class App {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['default', 'App']);
    });

    it('should extract re-exports', () => {
      const code = "export { foo, bar } from './module';";
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['foo', 'bar']);
    });

    it('should extract aliased exports', () => {
      const code = 'export { foo as bar };';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['bar']);
    });

    it('should extract interface exports', () => {
      const code = 'export interface User { name: string; }';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['User']);
    });

    it('should extract type alias exports', () => {
      const code = 'export type ID = string | number;';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['ID']);
    });

    it('should deduplicate exports', () => {
      const code = `export function foo() {}
export { foo };`;
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['foo']);
    });
  });

  describe('Import Extraction', () => {
    it('should identify import node types', () => {
      expect(importExtractor.importNodeTypes).toContain('import_statement');
      expect(importExtractor.importNodeTypes).toContain('export_statement');
    });

    it('should extract import paths', () => {
      const code = "import { foo } from './module';";
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBe('./module');
    });

    it('should extract named import symbols', () => {
      const code = "import { foo, bar } from './module';";
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('./module');
      expect(result!.symbols).toEqual(['foo', 'bar']);
    });

    it('should extract default import symbols', () => {
      const code = "import MyModule from './module';";
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.symbols).toContain('MyModule');
    });

    it('should extract namespace import symbols', () => {
      const code = "import * as utils from './utils';";
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.symbols).toContain('* as utils');
    });

    it('should extract aliased import symbols', () => {
      const code = "import { foo as bar } from './module';";
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.symbols).toContain('bar');
    });

    it('should extract re-export symbols from export statements', () => {
      const code = "export { foo, bar } from './module';";
      const tree = parser.parse(code);
      const exportNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(exportNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('./module');
      expect(result!.symbols).toEqual(['foo', 'bar']);
    });
  });

  describe('Symbol Extraction', () => {
    it('should extract function declarations', () => {
      const code = 'function greet(name: string): string { return `Hello ${name}`; }';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(funcNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('greet');
      expect(symbol!.type).toBe('function');
      expect(symbol!.signature).toContain('greet');
      expect(symbol!.parameters).toBeDefined();
    });

    it('should extract method definitions with parent class', () => {
      const code = `class Foo {
  bar(x: number): void {}
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(methodNode, code, 'Foo');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('bar');
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('Foo');
    });

    it('should extract class declarations', () => {
      const code = 'class UserService {}';
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(classNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('UserService');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('class UserService');
    });

    it('should extract interface declarations', () => {
      const code = 'interface Config { port: number; }';
      const tree = parser.parse(code);
      const ifaceNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(ifaceNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Config');
      expect(symbol!.type).toBe('interface');
      expect(symbol!.signature).toBe('interface Config');
    });

    it('should extract call sites from function calls', () => {
      const code = 'foo();';
      const tree = parser.parse(code);
      // expression_statement > call_expression
      const exprStmt = tree.rootNode.namedChild(0)!;
      const callExpr = exprStmt.namedChild(0)!;
      const callSite = symbolExtractor.extractCallSite(callExpr);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('foo');
    });

    it('should extract call sites from new expressions', () => {
      const code = 'new MyClass();';
      const tree = parser.parse(code);
      const exprStmt = tree.rootNode.namedChild(0)!;
      const newExpr = exprStmt.namedChild(0)!;
      const callSite = symbolExtractor.extractCallSite(newExpr);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('MyClass');
    });

    it('should extract call sites from member expressions', () => {
      const code = 'obj.method();';
      const tree = parser.parse(code);
      const exprStmt = tree.rootNode.namedChild(0)!;
      const callExpr = exprStmt.namedChild(0)!;
      const callSite = symbolExtractor.extractCallSite(callExpr);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('method');
    });
  });

  describe('AST Chunking Integration', () => {
    it('should chunk TypeScript functions', () => {
      const content = `function hello(): void {
  console.log("Hello!");
}

function add(a: number, b: number): number {
  return a + b;
}`;

      const chunks = chunkByAST('test.ts', content);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      const helloChunk = chunks.find(c => c.metadata.symbolName === 'hello');
      expect(helloChunk).toBeDefined();
      expect(helloChunk?.metadata.symbolType).toBe('function');

      const addChunk = chunks.find(c => c.metadata.symbolName === 'add');
      expect(addChunk).toBeDefined();
      expect(addChunk?.metadata.symbolType).toBe('function');
    });

    it('should chunk TypeScript classes with methods', () => {
      const content = `class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  subtract(a: number, b: number): number {
    return a - b;
  }
}`;

      const chunks = chunkByAST('test.ts', content);
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      const classChunk = chunks.find(c => c.metadata.symbolName === 'Calculator');
      expect(classChunk).toBeDefined();
      expect(classChunk?.metadata.symbolType).toBe('class');

      const addMethod = chunks.find(c => c.metadata.symbolName === 'add');
      expect(addMethod).toBeDefined();
      expect(addMethod?.metadata.symbolType).toBe('method');
      expect(addMethod?.metadata.parentClass).toBe('Calculator');
    });

    it('should chunk TypeScript interfaces', () => {
      const content = `interface User {
  name: string;
  age: number;
}`;

      const chunks = chunkByAST('test.ts', content);
      const ifaceChunk = chunks.find(c => c.metadata.symbolName === 'User');
      expect(ifaceChunk).toBeDefined();
      expect(ifaceChunk?.metadata.symbolType).toBe('interface');
    });

    it('should extract exports from TypeScript files', () => {
      const content = `export function validateEmail(email: string): boolean {
  return email.includes('@');
}

export const MAX_LENGTH = 255;`;

      const chunks = chunkByAST('test.ts', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'validateEmail');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.exports).toContain('validateEmail');
      expect(funcChunk?.metadata.exports).toContain('MAX_LENGTH');
    });

    it('should extract imports from TypeScript files', () => {
      const content = `import { readFile } from 'fs/promises';

export function loadConfig(): void {
  readFile('config.json');
}`;

      const chunks = chunkByAST('test.ts', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'loadConfig');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.imports).toBeDefined();
      expect(funcChunk?.metadata.imports?.length).toBeGreaterThan(0);
    });

    it('should handle arrow function assignments', () => {
      const content = `const greet = (name: string): string => {
  return \`Hello \${name}\`;
};`;

      const chunks = chunkByAST('test.ts', content);
      const greetChunk = chunks.find(c => c.metadata.symbolName === 'greet');
      expect(greetChunk).toBeDefined();
      expect(greetChunk?.metadata.symbolType).toBe('function');
    });

    it('should calculate complexity for TypeScript functions', () => {
      const content = `function complex(x: number): number {
  if (x > 0) {
    return 1;
  } else if (x < 0) {
    return -1;
  } else {
    return 0;
  }
}`;

      const chunks = chunkByAST('test.ts', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'complex');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeGreaterThanOrEqual(2);
    });

    it('should handle async functions', () => {
      const content = `async function fetchData(): Promise<string> {
  return "data";
}`;

      const chunks = chunkByAST('test.ts', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'fetchData');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.symbolType).toBe('function');
    });

    it('should extract function parameters with types', () => {
      const content = `function greet(name: string, age: number): string {
  return \`Hello \${name}, age \${age}\`;
}`;

      const chunks = chunkByAST('test.ts', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'greet');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.parameters).toBeDefined();
      expect(funcChunk?.metadata.parameters?.length).toBe(2);
    });
  });
});

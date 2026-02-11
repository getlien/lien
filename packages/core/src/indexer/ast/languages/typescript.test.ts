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
    it('should include TS-specific target node types', () => {
      expect(traverser.targetNodeTypes).toContain('interface_declaration');
      expect(traverser.targetNodeTypes).toContain('function_declaration');
      expect(traverser.targetNodeTypes).toContain('method_definition');
    });

    it('should detect arrow functions in lexical declarations', () => {
      const code = 'const foo = () => {};';
      const tree = parser.parse(code);
      const declNode = tree.rootNode.namedChild(0)!;
      const result = traverser.findFunctionInDeclaration(declNode);
      expect(result.hasFunction).toBe(true);
      expect(result.functionNode?.type).toBe('arrow_function');
    });

    it('should find parent class name for methods', () => {
      const code = 'class MyClass { myMethod() {} }';
      const tree = parser.parse(code);
      const classBody = tree.rootNode.namedChild(0)!.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;
      expect(traverser.findParentContainerName(methodNode)).toBe('MyClass');
    });
  });

  describe('Export Extraction', () => {
    it('should extract named, default, and re-exports', () => {
      const code = `export function validate() {}
export default class App {}
export { foo } from './module';`;
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('validate');
      expect(exports).toContain('default');
      expect(exports).toContain('App');
      expect(exports).toContain('foo');
    });

    it('should extract interface and type alias exports', () => {
      const tree = parser.parse(
        'export interface User { name: string; }\nexport type ID = string;',
      );
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('User');
      expect(exports).toContain('ID');
    });

    it('should deduplicate exports', () => {
      const tree = parser.parse('export function foo() {}\nexport { foo };');
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports.filter((e: string) => e === 'foo')).toHaveLength(1);
    });
  });

  describe('Import Extraction', () => {
    it('should extract named, default, and namespace imports', () => {
      const cases = [
        { code: "import { foo, bar } from './mod';", expected: ['foo', 'bar'] },
        { code: "import MyModule from './mod';", expected: ['MyModule'] },
        { code: "import * as utils from './utils';", expected: ['* as utils'] },
      ];
      for (const { code, expected } of cases) {
        const tree = parser.parse(code);
        const result = importExtractor.processImportSymbols(tree.rootNode.namedChild(0)!);
        for (const sym of expected) {
          expect(result!.symbols).toContain(sym);
        }
      }
    });
  });

  describe('Symbol Extraction', () => {
    it('should extract interface declarations', () => {
      const tree = parser.parse('interface Config { port: number; }');
      const symbol = symbolExtractor.extractSymbol(
        tree.rootNode.namedChild(0)!,
        'interface Config { port: number; }',
      );
      expect(symbol!.name).toBe('Config');
      expect(symbol!.type).toBe('interface');
    });

    it('should extract call sites from member expressions', () => {
      const tree = parser.parse('obj.method();');
      const callExpr = tree.rootNode.namedChild(0)!.namedChild(0)!;
      const callSite = symbolExtractor.extractCallSite(callExpr);
      expect(callSite!.symbol).toBe('method');
    });
  });

  describe('AST Chunking', () => {
    it('should chunk functions, classes, and interfaces', () => {
      const content = `export function hello(): void { console.log("hi"); }

class Calculator {
  add(a: number, b: number): number { return a + b; }
}

interface User { name: string; }`;

      const chunks = chunkByAST('test.ts', content);
      expect(chunks.find(c => c.metadata.symbolName === 'hello')).toBeDefined();
      expect(chunks.find(c => c.metadata.symbolName === 'Calculator')).toBeDefined();
      expect(chunks.find(c => c.metadata.symbolName === 'add')?.metadata.parentClass).toBe(
        'Calculator',
      );
      expect(chunks.find(c => c.metadata.symbolName === 'User')?.metadata.symbolType).toBe(
        'interface',
      );
    });
  });
});

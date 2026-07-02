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

  // ---------------------------------------------------------------------------
  // Abstract classes
  //
  // tree-sitter-typescript parses `abstract class Foo {}` as a distinct
  // `abstract_class_declaration` node (not `class_declaration`), and an
  // abstract method as `abstract_method_signature` (not `method_definition`).
  // Regression coverage for the previous behavior: an abstract class became a
  // single anonymous `type: 'block'` chunk with none of its methods visible
  // as symbols.
  // ---------------------------------------------------------------------------
  describe('Abstract Classes', () => {
    describe('Traverser', () => {
      it('should treat abstract_class_declaration as a container', () => {
        const code = 'abstract class Base { work() {} }';
        const tree = parser.parse(code);
        const classNode = tree.rootNode.namedChild(0)!;
        expect(classNode.type).toBe('abstract_class_declaration');
        expect(traverser.shouldExtractChildren(classNode)).toBe(true);
      });

      it('should resolve the class_body for an abstract class', () => {
        const code = 'abstract class Base { work() {} }';
        const tree = parser.parse(code);
        const classNode = tree.rootNode.namedChild(0)!;
        const body = traverser.getContainerBody(classNode);
        expect(body?.type).toBe('class_body');
      });

      it('should find the parent container name through an abstract class', () => {
        const code = 'abstract class Base { work() {} }';
        const tree = parser.parse(code);
        const classNode = tree.rootNode.namedChild(0)!;
        const classBody = classNode.childForFieldName('body')!;
        const methodNode = classBody.namedChild(0)!;
        expect(traverser.findParentContainerName(methodNode)).toBe('Base');
      });

      it('should include abstract_method_signature in target node types', () => {
        expect(traverser.targetNodeTypes).toContain('abstract_method_signature');
      });

      it('should not mutate the JavaScript traverser containerTypes', async () => {
        const { JavaScriptTraverser } = await import('./javascript.js');
        const jsTraverser = new JavaScriptTraverser();
        expect(jsTraverser.containerTypes).not.toContain('abstract_class_declaration');
        expect(traverser.containerTypes).toContain('abstract_class_declaration');
      });
    });

    describe('Symbol Extraction', () => {
      it('should extract the abstract class itself as a class symbol', () => {
        const code = 'abstract class BaseService { doWork() {} }';
        const tree = parser.parse(code);
        const classNode = tree.rootNode.namedChild(0)!;
        const symbol = symbolExtractor.extractSymbol(classNode, code);
        expect(symbol?.name).toBe('BaseService');
        expect(symbol?.type).toBe('class');
      });

      it('should extract an abstract method signature as a method symbol', () => {
        const code = `abstract class BaseService {
  abstract doWork(x: number): void;
}`;
        const tree = parser.parse(code);
        const classBody = tree.rootNode.namedChild(0)!.childForFieldName('body')!;
        const methodNode = classBody.namedChild(0)!;
        expect(methodNode.type).toBe('abstract_method_signature');

        const symbol = symbolExtractor.extractSymbol(methodNode, code, 'BaseService');
        expect(symbol?.name).toBe('doWork');
        expect(symbol?.type).toBe('method');
        expect(symbol?.parentClass).toBe('BaseService');
        expect(symbol?.signature).toContain('abstract doWork');
        // No body to walk, so complexity should be a sane baseline, not undefined/NaN.
        expect(symbol?.complexity).toBe(1);
      });
    });

    describe('AST Chunking', () => {
      it('should chunk an abstract class as a named class, not an anonymous block', () => {
        const content = `abstract class BaseService {
  abstract doWork(): void;

  concreteMethod() {
    return 1;
  }
}`;
        const chunks = chunkByAST('test.ts', content);
        const classChunk = chunks.find(c => c.metadata.symbolName === 'BaseService');
        expect(classChunk).toBeDefined();
        expect(classChunk?.metadata.symbolType).toBe('class');
        expect(classChunk?.metadata.type).toBe('class');
      });

      it('should chunk the concrete method with a body and complexity', () => {
        const content = `abstract class BaseService {
  abstract doWork(): void;

  concreteMethod(flag: boolean) {
    if (flag) {
      return 1;
    }
    return 2;
  }
}`;
        const chunks = chunkByAST('test.ts', content);
        const methodChunk = chunks.find(c => c.metadata.symbolName === 'concreteMethod');
        expect(methodChunk).toBeDefined();
        expect(methodChunk?.metadata.symbolType).toBe('method');
        expect(methodChunk?.metadata.parentClass).toBe('BaseService');
        expect(methodChunk?.metadata.complexity).toBeGreaterThanOrEqual(2);
        expect(methodChunk?.content).toContain('return 1');
      });

      it('should chunk the abstract method signature without crashing', () => {
        const content = `abstract class BaseService {
  abstract doWork(): void;

  concreteMethod() {
    return 1;
  }
}`;
        const chunks = chunkByAST('test.ts', content);
        const abstractChunk = chunks.find(c => c.metadata.symbolName === 'doWork');
        expect(abstractChunk).toBeDefined();
        expect(abstractChunk?.metadata.symbolType).toBe('method');
        expect(abstractChunk?.metadata.parentClass).toBe('BaseService');
      });

      it('should export the class name for an exported abstract class', () => {
        const content = `export abstract class BaseService {
  abstract doWork(): void;
}`;
        const chunks = chunkByAST('test.ts', content);
        const classChunk = chunks.find(c => c.metadata.symbolName === 'BaseService');
        expect(classChunk).toBeDefined();
        expect(classChunk?.metadata.exports).toContain('BaseService');
      });

      it('should still chunk methods when the abstract class also declares properties', () => {
        const content = `export abstract class BaseService {
  protected readonly name: string = 'base';

  abstract doWork(): void;

  concreteMethod() {
    return this.name;
  }
}`;
        const chunks = chunkByAST('test.ts', content);
        expect(chunks.find(c => c.metadata.symbolName === 'BaseService')).toBeDefined();
        expect(chunks.find(c => c.metadata.symbolName === 'doWork')).toBeDefined();
        expect(chunks.find(c => c.metadata.symbolName === 'concreteMethod')).toBeDefined();
      });

      it('should chunk a generic abstract class and its methods', () => {
        const content = `export abstract class Repository<T> {
  protected items: T[] = [];

  abstract findById(id: string): T | undefined;

  add(item: T): void {
    this.items.push(item);
  }
}`;
        const chunks = chunkByAST('test.ts', content);
        expect(chunks.find(c => c.metadata.symbolName === 'Repository')?.metadata.symbolType).toBe(
          'class',
        );
        expect(chunks.find(c => c.metadata.symbolName === 'findById')?.metadata.parentClass).toBe(
          'Repository',
        );
        expect(chunks.find(c => c.metadata.symbolName === 'add')?.metadata.parentClass).toBe(
          'Repository',
        );
      });

      it('should chunk an abstract class that extends another class', () => {
        const content = `abstract class Animal {
  abstract speak(): string;
}

abstract class Pet extends Animal {
  abstract speak(): string;

  play() {
    return 'playing';
  }
}`;
        const chunks = chunkByAST('test.ts', content);
        expect(chunks.find(c => c.metadata.symbolName === 'Animal')?.metadata.symbolType).toBe(
          'class',
        );
        expect(chunks.find(c => c.metadata.symbolName === 'Pet')?.metadata.symbolType).toBe(
          'class',
        );
        expect(chunks.find(c => c.metadata.symbolName === 'play')?.metadata.parentClass).toBe(
          'Pet',
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Other TS-only surface — documents current chunking/extraction behavior
  // for grammar unique to TypeScript. Not all of these produce dedicated
  // symbols today (enums and namespaces still fall back to opaque `block`
  // chunks); these tests lock in that documented behavior rather than
  // silently regressing it, and are separate from the abstract-class fix
  // above.
  // ---------------------------------------------------------------------------
  describe('Other TS-only surface', () => {
    it('should extract type-only named imports like regular named imports', () => {
      const code = "import type { Foo } from './foo';";
      const tree = parser.parse(code);
      const result = importExtractor.processImportSymbols(tree.rootNode.namedChild(0)!);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('./foo');
      expect(result!.symbols).toContain('Foo');
    });

    it('should extract inline type-qualified named imports alongside value imports', () => {
      const code = "import { type Bar, baz } from './bar';";
      const tree = parser.parse(code);
      const result = importExtractor.processImportSymbols(tree.rootNode.namedChild(0)!);
      expect(result).not.toBeNull();
      expect(result!.symbols).toContain('Bar');
      expect(result!.symbols).toContain('baz');
    });

    it('should extract type-only re-exports and type alias exports', () => {
      const code = "export type { Foo } from './foo';\nexport type Bar = string;";
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('Foo');
      expect(exports).toContain('Bar');
    });

    it('should preserve type parameters in function and class signatures', () => {
      const content = `export function identity<T>(x: T): T {
  return x;
}

export class Box<T> {
  get(): T {
    return null as unknown as T;
  }
}`;
      const chunks = chunkByAST('test.ts', content);
      const identityChunk = chunks.find(c => c.metadata.symbolName === 'identity');
      expect(identityChunk?.metadata.signature).toContain('<T>');

      const boxChunk = chunks.find(c => c.metadata.symbolName === 'Box');
      expect(boxChunk?.metadata.symbolType).toBe('class');

      const getChunk = chunks.find(c => c.metadata.symbolName === 'get');
      expect(getChunk?.metadata.parentClass).toBe('Box');
    });

    it('should still recognize a decorated class as a class symbol', () => {
      const content = `@Component()
export class Widget {
  render() {
    return 'ok';
  }
}`;
      const chunks = chunkByAST('test.ts', content);
      const classChunk = chunks.find(c => c.metadata.symbolName === 'Widget');
      expect(classChunk).toBeDefined();
      expect(classChunk?.metadata.symbolType).toBe('class');
      expect(chunks.find(c => c.metadata.symbolName === 'render')?.metadata.parentClass).toBe(
        'Widget',
      );
    });

    it('documents that enum bodies are not yet extracted as dedicated symbols', () => {
      // Known gap, out of scope for the abstract-class fix: enum_declaration
      // is neither a targetNodeType nor a containerType, so it falls into the
      // generic "uncovered code" block rather than becoming its own symbol.
      const content = `export enum Color {
  Red,
  Green,
}

export function useColor() {
  return Color.Red;
}`;
      const chunks = chunkByAST('test.ts', content);
      expect(chunks.find(c => c.metadata.symbolName === 'Color')).toBeUndefined();
      expect(chunks.some(c => c.content.includes('enum Color'))).toBe(true);
      // Unrelated top-level symbols after the enum still chunk correctly.
      expect(chunks.find(c => c.metadata.symbolName === 'useColor')).toBeDefined();
    });

    it('documents that namespace bodies are not yet extracted as dedicated symbols', () => {
      // Known gap, out of scope for the abstract-class fix: internal_module
      // (namespace) is neither a targetNodeType nor a containerType, so its
      // nested function also isn't surfaced as its own symbol.
      const content = `export namespace MyNamespace {
  export function foo() {
    return 1;
  }
}`;
      const chunks = chunkByAST('test.ts', content);
      expect(chunks.find(c => c.metadata.symbolName === 'foo')).toBeUndefined();
      expect(chunks.some(c => c.content.includes('namespace MyNamespace'))).toBe(true);
    });
  });
});

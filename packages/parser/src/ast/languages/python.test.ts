import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import { chunkByAST } from '../chunker.js';
import {
  PythonTraverser,
  PythonExportExtractor,
  PythonImportExtractor,
  PythonSymbolExtractor,
} from './python.js';

describe('Python Language', () => {
  const parser = new Parser();
  parser.setLanguage(Python);
  const traverser = new PythonTraverser();
  const exportExtractor = new PythonExportExtractor();
  const importExtractor = new PythonImportExtractor();
  const symbolExtractor = new PythonSymbolExtractor();

  describe('Traverser', () => {
    it('should identify function_definition and async_function_definition as target nodes', () => {
      expect(traverser.targetNodeTypes).toContain('function_definition');
      expect(traverser.targetNodeTypes).toContain('async_function_definition');
    });

    it('should identify class_definition and decorated_definition as container types', () => {
      expect(traverser.containerTypes).toContain('class_definition');
      expect(traverser.containerTypes).toContain('decorated_definition');
    });

    it('should extract children from class definitions', () => {
      const code = 'class Foo:\n    def bar(self): pass\n';
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      expect(traverser.shouldExtractChildren(classNode)).toBe(true);
    });

    it('should get block body from a class definition', () => {
      const code = 'class Foo:\n    def bar(self): pass\n';
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      const body = traverser.getContainerBody(classNode);
      expect(body).not.toBeNull();
      expect(body!.type).toBe('block');
    });

    it('should traverse module root', () => {
      const code = 'def foo(): pass\n';
      const tree = parser.parse(code);
      expect(tree.rootNode.type).toBe('module');
      expect(traverser.shouldTraverseChildren(tree.rootNode)).toBe(true);
    });

    it('should traverse a class block', () => {
      const code = 'class Foo:\n    def bar(self): pass\n';
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      const body = classNode.childForFieldName('body')!;
      expect(body.type).toBe('block');
      expect(traverser.shouldTraverseChildren(body)).toBe(true);
    });

    it('should not traverse function definitions', () => {
      const code = 'def foo(): pass\n';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;
      expect(traverser.shouldTraverseChildren(funcNode)).toBe(false);
    });

    it('should find parent container name for methods', () => {
      const code = 'class Calculator:\n    def add(self, a, b): return a + b\n';
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      const body = classNode.childForFieldName('body')!;
      const methodNode = body.namedChild(0)!;
      expect(traverser.findParentContainerName(methodNode)).toBe('Calculator');
    });

    it('should return undefined for top-level parent container name', () => {
      const code = 'def foo(): pass\n';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;
      expect(traverser.findParentContainerName(funcNode)).toBeUndefined();
    });

    it('should never report a variable declaration as function-bearing (Python has none)', () => {
      const code = 'x = 5\n';
      const tree = parser.parse(code);
      const assignment = tree.rootNode.namedChild(0)!;
      expect(traverser.isDeclarationWithFunction(assignment)).toBe(false);
      expect(traverser.findFunctionInDeclaration(assignment).hasFunction).toBe(false);
    });

    describe('decorated_definition (regression: decorators must not break traversal)', () => {
      it('should extract children (treat as container) from a decorated function', () => {
        const code = "@app.route('/')\ndef index(): pass\n";
        const tree = parser.parse(code);
        const decorated = findNode(tree.rootNode, 'decorated_definition')!;
        expect(traverser.shouldExtractChildren(decorated)).toBe(true);
      });

      it('should return null container body for a decorated function (leaf, not a container)', () => {
        const code = "@app.route('/')\ndef index(): pass\n";
        const tree = parser.parse(code);
        const decorated = findNode(tree.rootNode, 'decorated_definition')!;
        expect(traverser.getContainerBody(decorated)).toBeNull();
      });

      it('should return the inner class block as container body for a decorated class', () => {
        const code = '@dataclass\nclass Point:\n    x: int\n';
        const tree = parser.parse(code);
        const decorated = findNode(tree.rootNode, 'decorated_definition')!;
        const body = traverser.getContainerBody(decorated);
        expect(body).not.toBeNull();
        expect(body!.type).toBe('block');
      });

      it('should find parent container name for a decorated method', () => {
        const code = 'class Foo:\n    @staticmethod\n    def bar(): pass\n';
        const tree = parser.parse(code);
        const decorated = findNode(tree.rootNode, 'decorated_definition')!;
        expect(traverser.findParentContainerName(decorated)).toBe('Foo');
      });
    });
  });

  describe('Export Extraction', () => {
    it('should export top-level functions', () => {
      const code = 'def helper(): pass\n';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('helper');
    });

    it('should export top-level async functions', () => {
      const code = 'async def fetch_data(): pass\n';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('fetch_data');
    });

    it('should export top-level classes', () => {
      const code = 'class User: pass\n';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('User');
    });

    it('should not export nested function names as top-level exports', () => {
      const code = 'def outer():\n    def inner(): pass\n    return inner\n';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('outer');
      expect(exports).not.toContain('inner');
    });

    it('should export a decorated top-level function', () => {
      const code = "@app.route('/users')\ndef get_users(): pass\n";
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('get_users');
    });

    it('should export a decorated top-level class', () => {
      const code = '@dataclass\nclass Point:\n    x: int\n';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('Point');
    });

    it('should re-export names from relative imports', () => {
      const code = 'from .models import User, Order\n';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('User');
      expect(exports).toContain('Order');
    });

    it('should re-export the alias from an aliased relative import', () => {
      const code = 'from .models import User as UserModel\n';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('UserModel');
      expect(exports).not.toContain('User');
    });

    it('should not re-export names from absolute (non-relative) imports', () => {
      const code = 'from os.path import join\n';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).not.toContain('join');
    });

    it('should not export duplicate names', () => {
      const code = 'def helper(): pass\nfrom .helper import helper\n';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports.filter(name => name === 'helper')).toHaveLength(1);
    });
  });

  describe('Import Extraction', () => {
    it('should identify import_statement and import_from_statement as import node types', () => {
      expect(importExtractor.importNodeTypes).toContain('import_statement');
      expect(importExtractor.importNodeTypes).toContain('import_from_statement');
    });

    it('should extract a simple import path', () => {
      const code = 'import os\n';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBe('import os');
    });

    it('should process a simple import into a symbol', () => {
      const code = 'import os\n';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.symbols).toContain('os');
    });

    it('should process an aliased import using the alias as the symbol', () => {
      const code = 'import os as system\n';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('os');
      expect(result!.symbols).toEqual(['system']);
    });

    it('should process a from-import with multiple symbols', () => {
      const code = 'from utils.validate import validateEmail, validatePhone\n';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('utils.validate');
      expect(result!.symbols).toEqual(['validateEmail', 'validatePhone']);
    });

    it('should process a from-import with an alias', () => {
      const code = 'from typing import Optional as Opt\n';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.symbols).toEqual(['Opt']);
    });

    it('should return null for an unrecognized node type', () => {
      const code = 'x = 5\n';
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      expect(importExtractor.processImportSymbols(node)).toBeNull();
    });
  });

  describe('Symbol Extraction', () => {
    it('should extract function_definition info', () => {
      const code = 'def greet(name, age=25):\n    return name\n';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(funcNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('greet');
      expect(symbol!.type).toBe('function');
      expect(symbol!.parameters).toHaveLength(2);
      expect(symbol!.signature).toContain('greet');
      expect(symbol!.signature).not.toContain('return');
    });

    it('should extract async_function_definition info', () => {
      const code = 'async def fetch_data():\n    return "data"\n';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(funcNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('fetch_data');
      expect(symbol!.type).toBe('function');
    });

    it('should mark a function as a method when given a parentClass', () => {
      const code = 'class Foo:\n    def bar(self): pass\n';
      const tree = parser.parse(code);
      const body = tree.rootNode.namedChild(0)!.childForFieldName('body')!;
      const methodNode = body.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(methodNode, code, 'Foo');
      expect(symbol).not.toBeNull();
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('Foo');
    });

    it('should extract class_definition info', () => {
      const code = 'class Calculator: pass\n';
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(classNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Calculator');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('class Calculator');
    });

    it('should return null for an unrecognized node type', () => {
      const code = 'x = 5\n';
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      expect(symbolExtractor.extractSymbol(node, code)).toBeNull();
    });

    it('should extract call site from a direct invocation', () => {
      const code = 'def bar():\n    do_something()\n';
      const tree = parser.parse(code);
      const callNode = findNode(tree.rootNode, 'call');
      expect(callNode).not.toBeNull();
      const callSite = symbolExtractor.extractCallSite(callNode!);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('do_something');
    });

    it('should extract call site from an attribute invocation', () => {
      const code = 'def bar():\n    user.get_name()\n';
      const tree = parser.parse(code);
      const callNode = findNode(tree.rootNode, 'call');
      expect(callNode).not.toBeNull();
      const callSite = symbolExtractor.extractCallSite(callNode!);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('get_name');
    });

    it('should return null call site for a non-call node', () => {
      const code = 'x = 5\n';
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      expect(symbolExtractor.extractCallSite(node)).toBeNull();
    });

    describe('decorated_definition (regression: unwrap to the inner definition)', () => {
      it('should extract a decorated function as a normal function symbol', () => {
        const code = "@app.route('/users')\ndef get_users(): pass\n";
        const tree = parser.parse(code);
        const decorated = findNode(tree.rootNode, 'decorated_definition')!;
        const symbol = symbolExtractor.extractSymbol(decorated, code);
        expect(symbol).not.toBeNull();
        expect(symbol!.name).toBe('get_users');
        expect(symbol!.type).toBe('function');
      });

      it('should fold the decorator source into the signature', () => {
        const code = "@app.route('/users')\ndef get_users(): pass\n";
        const tree = parser.parse(code);
        const decorated = findNode(tree.rootNode, 'decorated_definition')!;
        const symbol = symbolExtractor.extractSymbol(decorated, code);
        expect(symbol!.signature).toContain("@app.route('/users')");
        expect(symbol!.signature).toContain('get_users');
      });

      it('should fold multiple stacked decorators into the signature in source order', () => {
        const code = '@staticmethod\n@cache\ndef bar(): pass\n';
        const tree = parser.parse(code);
        const decorated = findNode(tree.rootNode, 'decorated_definition')!;
        const symbol = symbolExtractor.extractSymbol(decorated, code);
        expect(symbol!.signature).toContain('@staticmethod');
        expect(symbol!.signature).toContain('@cache');
        expect(symbol!.signature!.indexOf('@staticmethod')).toBeLessThan(
          symbol!.signature!.indexOf('@cache'),
        );
      });

      it('should mark a decorated method as a method with the correct parentClass', () => {
        const code = 'class Foo:\n    @staticmethod\n    def bar(): pass\n';
        const tree = parser.parse(code);
        const decorated = findNode(tree.rootNode, 'decorated_definition')!;
        const symbol = symbolExtractor.extractSymbol(decorated, code, 'Foo');
        expect(symbol).not.toBeNull();
        expect(symbol!.type).toBe('method');
        expect(symbol!.parentClass).toBe('Foo');
      });

      it('should extract a decorated class as a normal class symbol', () => {
        const code = '@dataclass\nclass Point:\n    x: int\n';
        const tree = parser.parse(code);
        const decorated = findNode(tree.rootNode, 'decorated_definition')!;
        const symbol = symbolExtractor.extractSymbol(decorated, code);
        expect(symbol).not.toBeNull();
        expect(symbol!.name).toBe('Point');
        expect(symbol!.type).toBe('class');
        expect(symbol!.signature).toContain('@dataclass');
      });

      it('should compute complexity from the inner function, not the decorator', () => {
        const code =
          "@app.route('/')\ndef handler(x):\n    if x:\n        return 1\n    return 0\n";
        const tree = parser.parse(code);
        const decorated = findNode(tree.rootNode, 'decorated_definition')!;
        const symbol = symbolExtractor.extractSymbol(decorated, code);
        expect(symbol!.complexity).toBe(2);
      });

      it('should return null when the decorated_definition has no definition field', () => {
        // Defensive: a malformed/partial node should not throw.
        const code = "@app.route('/')\ndef get_users(): pass\n";
        const tree = parser.parse(code);
        const decorated = findNode(tree.rootNode, 'decorated_definition')!;
        expect(decorated.childForFieldName('definition')).not.toBeNull();
      });
    });
  });

  describe('AST Chunking Integration', () => {
    it('should chunk Python functions', () => {
      const content = 'def hello_world():\n    print("Hello, world!")\n';
      const chunks = chunkByAST('test.py', content);
      expect(chunks.some(c => c.metadata.symbolName === 'hello_world')).toBe(true);
    });

    it('should chunk methods with parentClass', () => {
      const content = 'class Calculator:\n    def add(self, a, b):\n        return a + b\n';
      const chunks = chunkByAST('Calculator.py', content);

      const classChunk = chunks.find(c => c.metadata.symbolName === 'Calculator');
      expect(classChunk).toBeDefined();
      expect(classChunk?.metadata.symbolType).toBe('class');

      const addChunk = chunks.find(c => c.metadata.symbolName === 'add');
      expect(addChunk).toBeDefined();
      expect(addChunk?.metadata.symbolType).toBe('method');
      expect(addChunk?.metadata.parentClass).toBe('Calculator');
    });

    describe('decorated definitions (regression: PR fixing #critical decorator chunking bug)', () => {
      it('should chunk a decorated top-level function with full symbol metadata', () => {
        const content = "@app.route('/users')\ndef get_users():\n    return []\n";
        const chunks = chunkByAST('routes.py', content);

        expect(chunks).toHaveLength(1);
        const chunk = chunks[0];
        expect(chunk.metadata.symbolName).toBe('get_users');
        expect(chunk.metadata.symbolType).toBe('function');
        expect(chunk.metadata.complexity).toBeDefined();
        // The decorator's call must still surface as a call site.
        expect(chunk.metadata.callSites?.some(cs => cs.symbol === 'route')).toBe(true);
        // The decorator text is preserved in the stored chunk content.
        expect(chunk.content).toContain("@app.route('/users')");
      });

      it('should chunk a decorated async function with full symbol metadata', () => {
        const content = "@app.get('/items')\nasync def get_items():\n    return await fetch()\n";
        const chunks = chunkByAST('routes.py', content);

        expect(chunks).toHaveLength(1);
        expect(chunks[0].metadata.symbolName).toBe('get_items');
        expect(chunks[0].metadata.symbolType).toBe('function');
      });

      it('should chunk a decorated method (@staticmethod) with parentClass', () => {
        const content = 'class Foo:\n    @staticmethod\n    def bar():\n        return 1\n';
        const chunks = chunkByAST('foo.py', content);

        const classChunk = chunks.find(c => c.metadata.symbolName === 'Foo');
        expect(classChunk).toBeDefined();
        expect(classChunk?.metadata.symbolType).toBe('class');

        const methodChunk = chunks.find(c => c.metadata.symbolName === 'bar');
        expect(methodChunk).toBeDefined();
        expect(methodChunk?.metadata.symbolType).toBe('method');
        expect(methodChunk?.metadata.parentClass).toBe('Foo');
      });

      it('should chunk a decorated property method (@property) with parentClass', () => {
        const content =
          'class Circle:\n    def __init__(self, r):\n        self.r = r\n\n    @property\n    def area(self):\n        return 3.14 * self.r ** 2\n';
        const chunks = chunkByAST('circle.py', content);

        const areaChunk = chunks.find(c => c.metadata.symbolName === 'area');
        expect(areaChunk).toBeDefined();
        expect(areaChunk?.metadata.symbolType).toBe('method');
        expect(areaChunk?.metadata.parentClass).toBe('Circle');

        const initChunk = chunks.find(c => c.metadata.symbolName === '__init__');
        expect(initChunk).toBeDefined();
        expect(initChunk?.metadata.symbolType).toBe('method');
      });

      it('should chunk a decorated class as a proper container whose methods still chunk', () => {
        const content =
          '@dataclass\nclass Point:\n    x: int\n    y: int\n\n    def magnitude(self):\n        return (self.x ** 2 + self.y ** 2) ** 0.5\n';
        const chunks = chunkByAST('point.py', content);

        const classChunk = chunks.find(c => c.metadata.symbolName === 'Point');
        expect(classChunk).toBeDefined();
        expect(classChunk?.metadata.symbolType).toBe('class');

        const methodChunk = chunks.find(c => c.metadata.symbolName === 'magnitude');
        expect(methodChunk).toBeDefined();
        expect(methodChunk?.metadata.symbolType).toBe('method');
        expect(methodChunk?.metadata.parentClass).toBe('Point');
      });

      it('should chunk a decorated class containing decorated methods', () => {
        const content = [
          '@dataclass',
          'class Point:',
          '    x: int',
          '    y: int',
          '',
          '    @property',
          '    def magnitude(self):',
          '        return (self.x ** 2 + self.y ** 2) ** 0.5',
          '',
          '    def plain_method(self):',
          '        return self.x',
          '',
        ].join('\n');
        const chunks = chunkByAST('point.py', content);

        const classChunk = chunks.find(c => c.metadata.symbolName === 'Point');
        expect(classChunk).toBeDefined();
        expect(classChunk?.metadata.symbolType).toBe('class');

        const magnitudeChunk = chunks.find(c => c.metadata.symbolName === 'magnitude');
        expect(magnitudeChunk).toBeDefined();
        expect(magnitudeChunk?.metadata.symbolType).toBe('method');
        expect(magnitudeChunk?.metadata.parentClass).toBe('Point');

        const plainChunk = chunks.find(c => c.metadata.symbolName === 'plain_method');
        expect(plainChunk).toBeDefined();
        expect(plainChunk?.metadata.symbolType).toBe('method');
        expect(plainChunk?.metadata.parentClass).toBe('Point');
      });

      it('should chunk a method with stacked decorators', () => {
        const content =
          'class Foo:\n    @staticmethod\n    @cache\n    def bar():\n        return 1\n';
        const chunks = chunkByAST('foo.py', content);

        const methodChunk = chunks.find(c => c.metadata.symbolName === 'bar');
        expect(methodChunk).toBeDefined();
        expect(methodChunk?.metadata.symbolType).toBe('method');
        expect(methodChunk?.metadata.parentClass).toBe('Foo');
        expect(methodChunk?.metadata.signature).toContain('@staticmethod');
        expect(methodChunk?.metadata.signature).toContain('@cache');
      });

      it('should not leave decorated functions as anonymous block chunks', () => {
        const content = "@app.route('/')\ndef index():\n    return 'home'\n";
        const chunks = chunkByAST('app.py', content);

        expect(chunks.every(c => c.metadata.type !== 'block')).toBe(true);
      });

      it('should export a decorated top-level function/class in chunk metadata', () => {
        const content = "@app.route('/users')\ndef get_users():\n    return []\n";
        const chunks = chunkByAST('routes.py', content);
        expect(chunks[0].metadata.exports).toContain('get_users');
      });
    });

    it('should calculate complexity for Python functions', () => {
      const content =
        'def complex_function(x):\n    if x > 0:\n        return 1\n    elif x < 0:\n        return -1\n    else:\n        return 0\n';
      const chunks = chunkByAST('test.py', content);
      const chunk = chunks.find(c => c.metadata.symbolName === 'complex_function');
      expect(chunk?.metadata.complexity).toBe(3);
    });

    it('should extract imports into chunk metadata', () => {
      const content =
        'import os\nfrom pathlib import Path\n\ndef use_path():\n    return Path.home()\n';
      const chunks = chunkByAST('test.py', content);
      const chunk = chunks.find(c => c.metadata.symbolName === 'use_path');
      expect(chunk?.metadata.imports?.length).toBeGreaterThan(0);
    });
  });
});

/** Helper to recursively find a node of a given type (depth-first) */
function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    const result = findNode(child, type);
    if (result) return result;
  }
  return null;
}

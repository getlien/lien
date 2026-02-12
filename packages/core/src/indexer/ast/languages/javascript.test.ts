import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { chunkByAST } from '../chunker.js';
import {
  JavaScriptTraverser,
  JavaScriptExportExtractor,
  JavaScriptImportExtractor,
  JavaScriptSymbolExtractor,
} from './javascript.js';

describe('JavaScript Language', () => {
  const parser = new Parser();
  parser.setLanguage(JavaScript);
  const traverser = new JavaScriptTraverser();
  const exportExtractor = new JavaScriptExportExtractor();
  const importExtractor = new JavaScriptImportExtractor();
  const symbolExtractor = new JavaScriptSymbolExtractor();

  describe('Traverser', () => {
    it('should share target node types with TypeScript', () => {
      expect(traverser.targetNodeTypes).toContain('function_declaration');
      expect(traverser.targetNodeTypes).toContain('method_definition');
      expect(traverser.targetNodeTypes).toContain('lexical_declaration');
    });

    it('should identify class declarations as containers', () => {
      const code = 'class Foo { bar() {} }';
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      expect(traverser.shouldExtractChildren(classNode)).toBe(true);
    });

    it('should traverse program root', () => {
      const code = 'const x = 1;';
      const tree = parser.parse(code);
      expect(traverser.shouldTraverseChildren(tree.rootNode)).toBe(true);
    });

    it('should detect function expressions in variable declarations', () => {
      const code = 'var handler = function() {};';
      const tree = parser.parse(code);
      const declNode = tree.rootNode.namedChild(0)!;
      expect(traverser.isDeclarationWithFunction(declNode)).toBe(true);
      const result = traverser.findFunctionInDeclaration(declNode);
      expect(result.hasFunction).toBe(true);
      expect(result.functionNode?.type).toBe('function_expression');
    });

    it('should find parent container name', () => {
      const code = 'class App { render() {} }';
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;
      expect(traverser.findParentContainerName(methodNode)).toBe('App');
    });

    it('should return undefined for top-level functions', () => {
      const code = 'function standalone() {}';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;
      expect(traverser.findParentContainerName(funcNode)).toBeUndefined();
    });
  });

  describe('Export Extraction', () => {
    it('should extract named exports', () => {
      const code = 'export { foo, bar };';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['foo', 'bar']);
    });

    it('should extract function exports', () => {
      const code = 'export function handler() {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['handler']);
    });

    it('should extract default class exports', () => {
      const code = 'export default class App {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['default', 'App']);
    });

    it('should extract default function exports', () => {
      const code = 'export default function main() {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['default', 'main']);
    });

    it('should extract const/let exports', () => {
      const code = 'export const VERSION = "1.0";';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['VERSION']);
    });

    it('should extract re-exports with source', () => {
      const code = "export { helper } from './utils';";
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['helper']);
    });

    it('should handle multiple export statements', () => {
      const code = `export function foo() {}
export function bar() {}
export const baz = 42;`;
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['foo', 'bar', 'baz']);
    });
  });

  describe('Import Extraction', () => {
    it('should extract import path from import statement', () => {
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

    it('should extract default import', () => {
      const code = "import React from 'react';";
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.symbols).toContain('React');
    });

    it('should extract mixed default and named imports', () => {
      const code = "import React, { useState } from 'react';";
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.symbols).toContain('React');
      expect(result!.symbols).toContain('useState');
    });

    it('should extract namespace imports', () => {
      const code = "import * as path from 'path';";
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.symbols).toContain('* as path');
    });

    it('should return null for import without source', () => {
      // Side-effect-only imports don't have named symbols to extract
      const code = "import './polyfill';";
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      // No symbols to extract from side-effect imports
      expect(result).toBeNull();
    });
  });

  describe('CJS Export Extraction', () => {
    it('should extract module.exports = { foo, bar }', () => {
      const code = 'module.exports = { foo, bar };';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['foo', 'bar']);
    });

    it('should extract module.exports = { key: value }', () => {
      const code = 'module.exports = { handler: handleRequest, router: appRouter };';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['handler', 'router']);
    });

    it('should extract module.exports = MyClass as default', () => {
      const code = 'module.exports = MyClass;';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['default']);
    });

    it('should extract module.exports = function name() {}', () => {
      const code = 'module.exports = function createApp() {};';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['default', 'createApp']);
    });

    it('should extract module.exports = function() {} (anonymous)', () => {
      const code = 'module.exports = function() {};';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['default']);
    });

    it('should extract exports.foo and exports.bar', () => {
      const code = `exports.foo = function() {};
exports.bar = 42;`;
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['foo', 'bar']);
    });

    it('should extract module.exports.handler', () => {
      const code = 'module.exports.handler = function() {};';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['handler']);
    });
  });

  describe('CJS Import Extraction', () => {
    it('should extract path and symbols from const x = require()', () => {
      const code = "const express = require('express');";
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(node);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('express');
      expect(result!.symbols).toEqual(['express']);
    });

    it('should extract destructured symbols from require()', () => {
      const code = "const { Router, json } = require('express');";
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(node);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('express');
      expect(result!.symbols).toEqual(['Router', 'json']);
    });

    it('should extract aliased destructured symbols', () => {
      const code = "const { Router: MyRouter } = require('express');";
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(node);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('express');
      expect(result!.symbols).toEqual(['MyRouter']);
    });

    it('should handle var declarations with require()', () => {
      const code = "var fs = require('fs');";
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(node);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('fs');
      expect(result!.symbols).toEqual(['fs']);
    });

    it('should extract path from bare require()', () => {
      const code = "require('./polyfill');";
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      const path = importExtractor.extractImportPath(node);
      expect(path).toBe('./polyfill');
    });

    it('should return empty symbols for bare require()', () => {
      const code = "require('./polyfill');";
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(node);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('./polyfill');
      expect(result!.symbols).toEqual([]);
    });

    it('should extract import path from require() declaration via extractImportPath', () => {
      const code = "const express = require('express');";
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      const path = importExtractor.extractImportPath(node);
      expect(path).toBe('express');
    });

    it('should return null for non-require declarations', () => {
      const code = 'const x = 42;';
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(node);
      expect(result).toBeNull();
    });

    it('should return null for dynamic require()', () => {
      const code = 'const mod = require(dynamicPath);';
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(node);
      expect(result).toBeNull();
    });

    it('should not treat nested require() as an import', () => {
      const code = "const x = foo(require('a'));";
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(node);
      expect(result).toBeNull();
    });

    it('should skip dynamic require and find static require in same declaration', () => {
      const code = "const a = require(dynamic), b = require('express');";
      const tree = parser.parse(code);
      const node = tree.rootNode.namedChild(0)!;
      const result = importExtractor.processImportSymbols(node);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('express');
      expect(result!.symbols).toEqual(['b']);
    });
  });

  describe('Symbol Extraction', () => {
    it('should extract function declaration info', () => {
      const code = 'function processData(items) { return items; }';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(funcNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('processData');
      expect(symbol!.type).toBe('function');
    });

    it('should extract class info', () => {
      const code = 'class EventEmitter {}';
      const tree = parser.parse(code);
      const classNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(classNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('EventEmitter');
      expect(symbol!.type).toBe('class');
    });

    it('should extract method info with parent class', () => {
      const code = `class Foo {
  bar() { return 1; }
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

    it('should extract call site from direct function call', () => {
      const code = 'doSomething();';
      const tree = parser.parse(code);
      const exprStmt = tree.rootNode.namedChild(0)!;
      const callExpr = exprStmt.namedChild(0)!;
      const callSite = symbolExtractor.extractCallSite(callExpr);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('doSomething');
    });

    it('should extract call site from method call', () => {
      const code = 'console.log("test");';
      const tree = parser.parse(code);
      const exprStmt = tree.rootNode.namedChild(0)!;
      const callExpr = exprStmt.namedChild(0)!;
      const callSite = symbolExtractor.extractCallSite(callExpr);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('log');
    });

    it('should return null for unsupported node types', () => {
      const code = 'const x = 42;';
      const tree = parser.parse(code);
      const declNode = tree.rootNode.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(declNode, code);
      expect(symbol).toBeNull();
    });
  });

  describe('AST Chunking Integration', () => {
    it('should chunk JavaScript functions', () => {
      const content = `function greet(name) {
  return "Hello " + name;
}

function add(a, b) {
  return a + b;
}`;

      const chunks = chunkByAST('test.js', content);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      const greetChunk = chunks.find(c => c.metadata.symbolName === 'greet');
      expect(greetChunk).toBeDefined();
      expect(greetChunk?.metadata.symbolType).toBe('function');

      const addChunk = chunks.find(c => c.metadata.symbolName === 'add');
      expect(addChunk).toBeDefined();
    });

    it('should chunk JavaScript classes', () => {
      const content = `class Dog {
  bark() {
    return "Woof!";
  }

  fetch(item) {
    return item;
  }
}`;

      const chunks = chunkByAST('test.js', content);
      const classChunk = chunks.find(c => c.metadata.symbolName === 'Dog');
      expect(classChunk).toBeDefined();
      expect(classChunk?.metadata.symbolType).toBe('class');

      const barkMethod = chunks.find(c => c.metadata.symbolName === 'bark');
      expect(barkMethod).toBeDefined();
      expect(barkMethod?.metadata.symbolType).toBe('method');
      expect(barkMethod?.metadata.parentClass).toBe('Dog');
    });

    it('should handle arrow function assignments', () => {
      const content = `const double = (x) => {
  return x * 2;
};`;

      const chunks = chunkByAST('test.js', content);
      const doubleChunk = chunks.find(c => c.metadata.symbolName === 'double');
      expect(doubleChunk).toBeDefined();
      expect(doubleChunk?.metadata.symbolType).toBe('function');
    });

    it('should extract imports in JavaScript files', () => {
      const content = `import express from 'express';

function startServer() {
  const app = express();
}`;

      const chunks = chunkByAST('test.js', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'startServer');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.imports?.length).toBeGreaterThan(0);
    });

    it('should calculate complexity for JavaScript functions', () => {
      const content = `function check(value) {
  if (value > 0) {
    return true;
  } else {
    return false;
  }
}`;

      const chunks = chunkByAST('test.js', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'check');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeGreaterThanOrEqual(2);
    });

    it('should handle function expressions assigned to variables', () => {
      const content = `const handler = function handleRequest(req, res) {
  res.send("ok");
};`;

      const chunks = chunkByAST('test.js', content);
      // The function expression's name is 'handleRequest'
      const handlerChunk = chunks.find(
        c => c.metadata.symbolName === 'handleRequest' || c.metadata.symbolName === 'handler',
      );
      expect(handlerChunk).toBeDefined();
    });
  });
});

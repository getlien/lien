import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import Kotlin from 'tree-sitter-kotlin';
import { chunkByAST } from '../chunker.js';
import {
  KotlinTraverser,
  KotlinExportExtractor,
  KotlinImportExtractor,
  KotlinSymbolExtractor,
} from './kotlin.js';

describe('Kotlin Language', () => {
  const parser = new Parser();
  parser.setLanguage(Kotlin);
  const traverser = new KotlinTraverser();
  const exportExtractor = new KotlinExportExtractor();
  const importExtractor = new KotlinImportExtractor();
  const symbolExtractor = new KotlinSymbolExtractor();

  const parse = (src: string) => parser.parse(src).rootNode;

  // ===========================================================================
  // TRAVERSER
  // ===========================================================================
  describe('Traverser', () => {
    it('recognizes class and object declarations as containers', () => {
      const root = parse('class A { fun m() {} }\nobject B { fun n() {} }\n');
      const cls = findNode(root, 'class_declaration')!;
      const obj = findNode(root, 'object_declaration')!;
      expect(traverser.shouldExtractChildren(cls)).toBe(true);
      expect(traverser.shouldExtractChildren(obj)).toBe(true);
    });

    it('finds the class body for child traversal', () => {
      const root = parse('class A { fun m() {} }\n');
      const cls = findNode(root, 'class_declaration')!;
      const body = traverser.getContainerBody(cls);
      expect(body?.type).toBe('class_body');
    });

    it('finds the enum class body', () => {
      const root = parse('enum class E { A, B }\n');
      const cls = findNode(root, 'class_declaration')!;
      expect(traverser.getContainerBody(cls)?.type).toBe('enum_class_body');
    });

    it('traverses into source_file, class_body, and companion_object', () => {
      const root = parse('class A {\n  companion object {\n    fun c() {}\n  }\n}\n');
      expect(traverser.shouldTraverseChildren(root)).toBe(true);
      expect(traverser.shouldTraverseChildren(findNode(root, 'class_body')!)).toBe(true);
      expect(traverser.shouldTraverseChildren(findNode(root, 'companion_object')!)).toBe(true);
    });

    it('resolves the parent container name for a method', () => {
      const root = parse('class Calc { fun add() {} }\n');
      const fn = findNode(root, 'function_declaration')!;
      expect(traverser.findParentContainerName(fn)).toBe('Calc');
    });

    it('detects a lambda inside a property declaration', () => {
      const root = parse('val handler = { x: Int -> x + 1 }\n');
      const prop = findNode(root, 'property_declaration')!;
      expect(traverser.isDeclarationWithFunction(prop)).toBe(true);
      expect(traverser.findFunctionInDeclaration(prop).hasFunction).toBe(true);
    });

    it('does not treat a property with a call-argument lambda as function-valued', () => {
      const root = parse('val count = xs.count { it > 0 }\n');
      const prop = findNode(root, 'property_declaration')!;
      expect(traverser.isDeclarationWithFunction(prop)).toBe(false);
    });
  });

  // ===========================================================================
  // EXPORT EXTRACTOR
  // ===========================================================================
  describe('Export Extraction', () => {
    it('exports top-level public functions, classes, and objects', () => {
      const root = parse('fun topFn() {}\nclass PublicClass\nobject Singleton\n');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('topFn');
      expect(exports).toContain('PublicClass');
      expect(exports).toContain('Singleton');
    });

    it('excludes private and internal declarations', () => {
      const root = parse('private fun secret() {}\ninternal class Hidden\nfun open() {}\n');
      const exports = exportExtractor.extractExports(root);
      expect(exports).not.toContain('secret');
      expect(exports).not.toContain('Hidden');
      expect(exports).toContain('open');
    });

    it('exports public members of a class', () => {
      const root = parse(
        'class Service {\n  fun publicMethod() {}\n  private fun helper() {}\n}\n',
      );
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('Service');
      expect(exports).toContain('publicMethod');
      expect(exports).not.toContain('helper');
    });

    it('treats interface members as exported (implicitly public)', () => {
      const root = parse('interface Repo {\n  fun find(): String\n}\n');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('Repo');
      expect(exports).toContain('find');
    });

    it('does not export members of a private container', () => {
      const root = parse('private class Secret {\n  fun internalApi() {}\n}\n');
      const exports = exportExtractor.extractExports(root);
      expect(exports).not.toContain('Secret');
      expect(exports).not.toContain('internalApi');
    });
  });

  // ===========================================================================
  // IMPORT EXTRACTOR
  // ===========================================================================
  describe('Import Extraction', () => {
    const importHeaders = (src: string) => {
      const root = parse(src);
      const list = findNode(root, 'import_list');
      return list ? list.namedChildren.filter(c => c.type === 'import_header') : [];
    };

    it('extracts a simple import path', () => {
      const [imp] = importHeaders('import com.example.Service\n');
      expect(importExtractor.extractImportPath(imp)).toBe('com.example.Service');
    });

    it('handles wildcard imports', () => {
      const [imp] = importHeaders('import com.example.*\n');
      expect(importExtractor.extractImportPath(imp)).toBe('com.example.*');
    });

    it('uses the alias as the imported symbol', () => {
      const [imp] = importHeaders('import com.example.Foo as Bar\n');
      const result = importExtractor.processImportSymbols(imp);
      expect(result?.symbols).toContain('Bar');
    });

    it('filters out kotlin/java standard library imports', () => {
      const [stdlib] = importHeaders('import kotlin.collections.List\n');
      expect(importExtractor.extractImportPath(stdlib)).toBeNull();
      const [javaStd] = importHeaders('import java.util.ArrayList\n');
      expect(importExtractor.extractImportPath(javaStd)).toBeNull();
    });

    it('keeps kotlinx.* imports (external libraries, not stdlib)', () => {
      const [kx] = importHeaders('import kotlinx.coroutines.flow.Flow\n');
      expect(importExtractor.extractImportPath(kx)).toBe('kotlinx.coroutines.flow.Flow');
    });

    it('maps a non-wildcard import to its last segment as the symbol', () => {
      const [imp] = importHeaders('import com.example.Service\n');
      const result = importExtractor.processImportSymbols(imp);
      expect(result?.importPath).toBe('com.example.Service');
      expect(result?.symbols).toContain('Service');
    });
  });

  // ===========================================================================
  // SYMBOL EXTRACTION
  // ===========================================================================
  describe('Symbol Extraction', () => {
    it('extracts a function with a clean block-body signature', () => {
      const src = 'fun calculate(a: Int, b: Int): Int {\n  return a + b\n}\n';
      const fn = findNode(parse(src), 'function_declaration')!;
      const sym = symbolExtractor.extractSymbol(fn, src)!;
      expect(sym.name).toBe('calculate');
      expect(sym.type).toBe('function');
      expect(sym.signature).toBe('fun calculate(a: Int, b: Int): Int');
      expect(sym.parameters).toEqual(['a: Int', 'b: Int']);
      expect(sym.returnType).toBe('Int');
    });

    it('extracts a clean signature for an expression-body function (no trailing =)', () => {
      const src = 'fun double(x: Int): Int = x * 2\n';
      const fn = findNode(parse(src), 'function_declaration')!;
      const sym = symbolExtractor.extractSymbol(fn, src)!;
      expect(sym.signature).toBe('fun double(x: Int): Int');
      expect(sym.signature).not.toContain('=');
    });

    it('marks functions inside a class as methods', () => {
      const src = 'class A {\n  fun m() {}\n}\n';
      const fn = findNode(parse(src), 'function_declaration')!;
      const sym = symbolExtractor.extractSymbol(fn, src, 'A')!;
      expect(sym.type).toBe('method');
      expect(sym.parentClass).toBe('A');
    });

    it('extracts class, interface, enum, and object symbols', () => {
      const cls = symbolExtractor.extractSymbol(
        findNode(parse('class Foo'), 'class_declaration')!,
        '',
      )!;
      expect(cls).toMatchObject({ name: 'Foo', type: 'class', signature: 'class Foo' });

      const iface = symbolExtractor.extractSymbol(
        findNode(parse('interface Bar { fun x() }'), 'class_declaration')!,
        '',
      )!;
      expect(iface).toMatchObject({ name: 'Bar', type: 'interface', signature: 'interface Bar' });

      const en = symbolExtractor.extractSymbol(
        findNode(parse('enum class Color { RED }'), 'class_declaration')!,
        '',
      )!;
      expect(en).toMatchObject({ name: 'Color', type: 'class', signature: 'enum class Color' });

      const obj = symbolExtractor.extractSymbol(
        findNode(parse('object Registry { fun r() {} }'), 'object_declaration')!,
        '',
      )!;
      expect(obj).toMatchObject({ name: 'Registry', type: 'class', signature: 'object Registry' });
    });

    it('extracts call sites for direct and navigation calls', () => {
      const src = 'fun run() {\n  foo()\n  obj.bar.baz()\n}\n';
      const calls = findAllNodes(parse(src), 'call_expression');
      const names = calls.map(c => symbolExtractor.extractCallSite(c)?.symbol).filter(Boolean);
      expect(names).toContain('foo');
      expect(names).toContain('baz');
    });
  });

  // ===========================================================================
  // AST CHUNKING INTEGRATION
  // ===========================================================================
  describe('AST Chunking', () => {
    const SOURCE = `package com.example.app

import com.example.lib.Helper
import com.example.util.*

class OrderService(private val repo: Repository) {
  fun place(order: Order): Boolean {
    return when {
      order.isValid() && repo.has(order.id) -> repo.save(order)
      else -> false
    }
  }

  companion object {
    fun create(): OrderService = OrderService(Repository())
  }
}

interface Repository {
  fun save(o: Order): Boolean
}

object Defaults {
  fun empty(): Order = Order()
}

fun topLevelHelper(x: Int): Int = x + 1
`;

    const chunks = chunkByAST('OrderService.kt', SOURCE);
    const bySymbol = (name: string, type?: string) =>
      chunks.find(
        c => c.metadata.symbolName === name && (type ? c.metadata.symbolType === type : true),
      );

    it('produces more chunks than one (AST-bounded, not a single blob)', () => {
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('chunks the class, its method, the companion method, the interface, the object, and the top-level fn', () => {
      expect(bySymbol('OrderService', 'class')).toBeDefined();
      expect(bySymbol('Defaults', 'class')).toBeDefined();
      expect(bySymbol('Repository', 'interface')).toBeDefined();
      expect(bySymbol('place', 'method')?.metadata.parentClass).toBe('OrderService');
      expect(bySymbol('create')).toBeDefined(); // companion-object method
      expect(bySymbol('topLevelHelper', 'function')).toBeDefined();
    });

    it('captures non-stdlib imports (incl. nested import_header under import_list)', () => {
      const allImports = chunks.flatMap(c => c.metadata.imports ?? []);
      expect(allImports).toContain('com.example.lib.Helper');
      expect(allImports.some(i => i.startsWith('com.example.util'))).toBe(true);
    });

    it('computes complexity for a branchy method (counts when / && )', () => {
      const place = bySymbol('place', 'method');
      expect(place).toBeDefined();
      expect(place?.metadata.complexity ?? 0).toBeGreaterThan(1);
    });
  });
});

// =============================================================================
// HELPERS
// =============================================================================
function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return null;
}

function findAllNodes(
  node: Parser.SyntaxNode,
  type: string,
  acc: Parser.SyntaxNode[] = [],
): Parser.SyntaxNode[] {
  if (node.type === type) acc.push(node);
  for (const child of node.namedChildren) findAllNodes(child, type, acc);
  return acc;
}

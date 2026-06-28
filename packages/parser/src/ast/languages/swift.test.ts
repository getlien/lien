import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import Swift from 'tree-sitter-swift';
import { chunkByAST } from '../chunker.js';
import {
  SwiftTraverser,
  SwiftExportExtractor,
  SwiftImportExtractor,
  SwiftSymbolExtractor,
} from './swift.js';

describe('Swift Language', () => {
  const parser = new Parser();
  parser.setLanguage(Swift);
  const traverser = new SwiftTraverser();
  const exportExtractor = new SwiftExportExtractor();
  const importExtractor = new SwiftImportExtractor();
  const symbolExtractor = new SwiftSymbolExtractor();

  const parse = (src: string) => parser.parse(src).rootNode;

  // ===========================================================================
  // TRAVERSER
  // ===========================================================================
  describe('Traverser', () => {
    it('recognizes class/struct and protocol declarations as containers', () => {
      const root = parse('struct A { func m() {} }\nprotocol B { func n() }\n');
      const struct = findNode(root, 'class_declaration')!;
      const proto = findNode(root, 'protocol_declaration')!;
      expect(traverser.shouldExtractChildren(struct)).toBe(true);
      expect(traverser.shouldExtractChildren(proto)).toBe(true);
    });

    it('finds the class body for child traversal (struct/class/actor/extension)', () => {
      const root = parse('struct A { func m() {} }\n');
      const struct = findNode(root, 'class_declaration')!;
      expect(traverser.getContainerBody(struct)?.type).toBe('class_body');
    });

    it('finds the enum class body', () => {
      const root = parse('enum E { case a, b }\n');
      const en = findNode(root, 'class_declaration')!;
      expect(traverser.getContainerBody(en)?.type).toBe('enum_class_body');
    });

    it('finds the protocol body', () => {
      const root = parse('protocol P { func m() }\n');
      const proto = findNode(root, 'protocol_declaration')!;
      expect(traverser.getContainerBody(proto)?.type).toBe('protocol_body');
    });

    it('traverses into source_file, class_body, and protocol_body', () => {
      const root = parse('struct A {\n  func m() {}\n}\n');
      expect(traverser.shouldTraverseChildren(root)).toBe(true);
      expect(traverser.shouldTraverseChildren(findNode(root, 'class_body')!)).toBe(true);
    });

    it('resolves the parent container name for a method', () => {
      const root = parse('struct Calc { func add() {} }\n');
      const fn = findNode(root, 'function_declaration')!;
      expect(traverser.findParentContainerName(fn)).toBe('Calc');
    });

    it('detects a closure inside a property declaration', () => {
      const root = parse('let handler = { (x: Int) in x + 1 }\n');
      const prop = findNode(root, 'property_declaration')!;
      expect(traverser.isDeclarationWithFunction(prop)).toBe(true);
      expect(traverser.findFunctionInDeclaration(prop).hasFunction).toBe(true);
    });

    it('does not treat a property with a call-argument closure as function-valued', () => {
      const root = parse('let mapped = xs.map { $0 + 1 }\n');
      const prop = findNode(root, 'property_declaration')!;
      expect(traverser.isDeclarationWithFunction(prop)).toBe(false);
    });
  });

  // ===========================================================================
  // EXPORT EXTRACTOR
  // ===========================================================================
  describe('Export Extraction', () => {
    it('exports top-level functions, structs, classes, and protocols (internal by default)', () => {
      const root = parse('func topFn() {}\nstruct PublicStruct {}\nprotocol Service {}\n');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('topFn');
      expect(exports).toContain('PublicStruct');
      expect(exports).toContain('Service');
    });

    it('excludes private and fileprivate declarations', () => {
      const root = parse(
        'private func secret() {}\nfileprivate struct Hidden {}\nfunc shown() {}\n',
      );
      const exports = exportExtractor.extractExports(root);
      expect(exports).not.toContain('secret');
      expect(exports).not.toContain('Hidden');
      expect(exports).toContain('shown');
    });

    it('exports non-private members of a struct', () => {
      const root = parse(
        'struct Service {\n  func publicMethod() {}\n  private func helper() {}\n}\n',
      );
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('Service');
      expect(exports).toContain('publicMethod');
      expect(exports).not.toContain('helper');
    });

    it('treats protocol members as exported (implicitly part of the surface)', () => {
      const root = parse('protocol Repo {\n  func find() -> String\n}\n');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('Repo');
      expect(exports).toContain('find');
    });

    it('does not export members of a private container', () => {
      const root = parse('private struct Secret {\n  func internalApi() {}\n}\n');
      const exports = exportExtractor.extractExports(root);
      expect(exports).not.toContain('Secret');
      expect(exports).not.toContain('internalApi');
    });
  });

  // ===========================================================================
  // IMPORT EXTRACTOR
  // ===========================================================================
  describe('Import Extraction', () => {
    const imports = (src: string) => findAllNodes(parse(src), 'import_declaration');

    it('extracts a simple import path', () => {
      const [imp] = imports('import Foundation\n');
      expect(importExtractor.extractImportPath(imp)).toBe('Foundation');
    });

    it('extracts a dotted / import-kind path', () => {
      const [imp] = imports('import struct Combine.Just\n');
      expect(importExtractor.extractImportPath(imp)).toBe('Combine.Just');
    });

    it('filters out the Swift standard library module', () => {
      const [stdlib] = imports('import Swift\n');
      expect(importExtractor.extractImportPath(stdlib)).toBeNull();
    });

    it('keeps real framework imports (Foundation, UIKit, …)', () => {
      const [uikit] = imports('import UIKit\n');
      expect(importExtractor.extractImportPath(uikit)).toBe('UIKit');
    });

    it('maps an import to its last segment as the symbol', () => {
      const [imp] = imports('import struct Combine.Just\n');
      const result = importExtractor.processImportSymbols(imp);
      expect(result?.importPath).toBe('Combine.Just');
      expect(result?.symbols).toContain('Just');
    });
  });

  // ===========================================================================
  // SYMBOL EXTRACTION
  // ===========================================================================
  describe('Symbol Extraction', () => {
    it('extracts a function with a clean signature, params, and return type', () => {
      const src = 'func calculate(a: Int, b: Int) -> Int {\n  return a + b\n}\n';
      const fn = findNode(parse(src), 'function_declaration')!;
      const sym = symbolExtractor.extractSymbol(fn, src)!;
      expect(sym.name).toBe('calculate');
      expect(sym.type).toBe('function');
      expect(sym.signature).toBe('func calculate(a: Int, b: Int) -> Int');
      expect(sym.parameters).toEqual(['a: Int', 'b: Int']);
      expect(sym.returnType).toBe('Int');
    });

    it('marks functions inside a type as methods', () => {
      const src = 'struct A {\n  func m() {}\n}\n';
      const fn = findNode(parse(src), 'function_declaration')!;
      const sym = symbolExtractor.extractSymbol(fn, src, 'A')!;
      expect(sym.type).toBe('method');
      expect(sym.parentClass).toBe('A');
    });

    it('extracts an initializer as a method', () => {
      const src = 'struct A {\n  init(x: Int) {}\n}\n';
      const init = findNode(parse(src), 'init_declaration')!;
      const sym = symbolExtractor.extractSymbol(init, src, 'A')!;
      expect(sym.name).toBe('init');
      expect(sym.type).toBe('method');
    });

    it('maps struct / enum / extension / class to class with the real keyword in the signature', () => {
      const struct = symbolExtractor.extractSymbol(
        findNode(parse('struct Foo { let x: Int }'), 'class_declaration')!,
        '',
      )!;
      expect(struct).toMatchObject({ name: 'Foo', type: 'class', signature: 'struct Foo' });

      const en = symbolExtractor.extractSymbol(
        findNode(parse('enum Color { case red }'), 'class_declaration')!,
        '',
      )!;
      expect(en).toMatchObject({ name: 'Color', type: 'class', signature: 'enum Color' });

      const ext = symbolExtractor.extractSymbol(
        findNode(parse('extension String { func x() {} }'), 'class_declaration')!,
        '',
      )!;
      expect(ext).toMatchObject({ name: 'String', type: 'class', signature: 'extension String' });

      const cls = symbolExtractor.extractSymbol(
        findNode(parse('class Bar {}'), 'class_declaration')!,
        '',
      )!;
      expect(cls).toMatchObject({ name: 'Bar', type: 'class', signature: 'class Bar' });
    });

    it('maps a protocol to an interface', () => {
      const proto = symbolExtractor.extractSymbol(
        findNode(parse('protocol Drawable { func draw() }'), 'protocol_declaration')!,
        '',
      )!;
      expect(proto).toMatchObject({
        name: 'Drawable',
        type: 'interface',
        signature: 'protocol Drawable',
      });
    });

    it('extracts call sites for direct and navigation calls', () => {
      const src = 'func run() {\n  foo()\n  obj.bar.baz()\n}\n';
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
    const SOURCE = `import Foundation
import Swift

struct OrderService {
  let repo: Repository

  func place(_ order: Order) -> Bool {
    guard order.isValid else { return false }
    switch order.kind {
    case .standard where order.total > 0 && repo.has(order.id):
      return repo.save(order)
    default:
      return false
    }
  }
}

protocol Repository {
  func save(_ o: Order) -> Bool
}

enum OrderKind {
  case standard
  case express
}

extension OrderService {
  func summary() -> String { return "order" }
}

func topLevelHelper(_ x: Int) -> Int { return x + 1 }
`;

    const chunks = chunkByAST('OrderService.swift', SOURCE);
    const bySymbol = (name: string, type?: string) =>
      chunks.find(
        c => c.metadata.symbolName === name && (type ? c.metadata.symbolType === type : true),
      );

    it('produces more chunks than one (AST-bounded, not a single blob)', () => {
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('chunks the struct, its method, the protocol, the enum, the extension method, and the top-level fn', () => {
      expect(bySymbol('OrderService', 'class')).toBeDefined();
      expect(bySymbol('Repository', 'interface')).toBeDefined();
      expect(bySymbol('OrderKind', 'class')).toBeDefined();
      expect(bySymbol('place', 'method')?.metadata.parentClass).toBe('OrderService');
      expect(bySymbol('summary', 'method')).toBeDefined();
      expect(bySymbol('topLevelHelper', 'function')).toBeDefined();
    });

    it('captures real framework imports and filters the Swift stdlib module', () => {
      const allImports = chunks.flatMap(c => c.metadata.imports ?? []);
      expect(allImports).toContain('Foundation');
      expect(allImports).not.toContain('Swift');
    });

    it('computes complexity for a branchy method (counts guard / switch / && )', () => {
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

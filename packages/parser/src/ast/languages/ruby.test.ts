import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import Ruby from 'tree-sitter-ruby';
import { chunkByAST } from '../chunker.js';
import {
  RubyTraverser,
  RubyExportExtractor,
  RubyImportExtractor,
  RubySymbolExtractor,
} from './ruby.js';

describe('Ruby Language', () => {
  const parser = new Parser();
  parser.setLanguage(Ruby);
  const traverser = new RubyTraverser();
  const exportExtractor = new RubyExportExtractor();
  const importExtractor = new RubyImportExtractor();
  const symbolExtractor = new RubySymbolExtractor();

  const parse = (code: string) => parser.parse(code).rootNode;

  describe('Traverser', () => {
    it('should identify method and singleton_method as target nodes', () => {
      expect(traverser.targetNodeTypes).toContain('method');
      expect(traverser.targetNodeTypes).toContain('singleton_method');
    });

    it('should identify class as a container', () => {
      expect(traverser.containerTypes).toContain('class');
    });

    it('should traverse through module as a transparent namespace', () => {
      // module is NOT a container (it does not add a nesting level); we traverse
      // into it so `module → class → method` still yields method chunks.
      expect(traverser.containerTypes).not.toContain('module');
      const moduleNode = parse('module M\n  def helper; end\nend').namedChild(0)!;
      expect(traverser.shouldTraverseChildren(moduleNode)).toBe(true);
    });

    it('should extract children from class bodies', () => {
      const classNode = parse('class Foo\n  def bar; end\nend').namedChild(0)!;
      expect(traverser.shouldExtractChildren(classNode)).toBe(true);
    });

    it('should not extract children from a plain method', () => {
      const methodNode = parse('def bar; end').namedChild(0)!;
      expect(traverser.shouldExtractChildren(methodNode)).toBe(false);
    });

    it('should return body_statement as the class container body', () => {
      const classNode = parse('class Foo\n  def bar; end\nend').namedChild(0)!;
      const body = traverser.getContainerBody(classNode);
      expect(body).not.toBeNull();
      expect(body!.type).toBe('body_statement');
    });

    it('should traverse program root and body_statement nodes', () => {
      const root = parse('class Foo\n  def bar; end\nend');
      expect(traverser.shouldTraverseChildren(root)).toBe(true);
      const body = root.namedChild(0)!.childForFieldName('body')!;
      expect(traverser.shouldTraverseChildren(body)).toBe(true);
    });

    it('should not treat any node as a declaration with a function', () => {
      const root = parse('x = 42');
      root.namedChildren.forEach(child => {
        expect(traverser.isDeclarationWithFunction(child)).toBe(false);
      });
    });

    it('should find the parent class name for a method', () => {
      const root = parse('class MyService\n  def call; end\nend');
      const body = root.namedChild(0)!.childForFieldName('body')!;
      const methodNode = body.namedChild(0)!;
      expect(traverser.findParentContainerName(methodNode)).toBe('MyService');
    });

    it('should find the parent module name for a method', () => {
      const root = parse('module Helpers\n  def format; end\nend');
      const body = root.namedChild(0)!.childForFieldName('body')!;
      const methodNode = body.namedChild(0)!;
      expect(traverser.findParentContainerName(methodNode)).toBe('Helpers');
    });

    it('should find the nearest container name for a nested method', () => {
      const root = parse('module Billing\n  class Invoice\n    def total; end\n  end\nend');
      const moduleBody = root.namedChild(0)!.childForFieldName('body')!;
      const classBody = moduleBody.namedChild(0)!.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;
      expect(traverser.findParentContainerName(methodNode)).toBe('Invoice');
    });
  });

  describe('Export Extraction', () => {
    it('should export a top-level class', () => {
      expect(exportExtractor.extractExports(parse('class User\nend'))).toEqual(['User']);
    });

    it('should export a top-level module', () => {
      expect(exportExtractor.extractExports(parse('module Billing\nend'))).toEqual(['Billing']);
    });

    it('should export a top-level method', () => {
      expect(exportExtractor.extractExports(parse('def helper; end'))).toEqual(['helper']);
    });

    it('should export a top-level singleton method', () => {
      expect(exportExtractor.extractExports(parse('def self.build; end'))).toEqual(['build']);
    });

    it('should export a top-level constant', () => {
      expect(exportExtractor.extractExports(parse("VERSION = '1.0'"))).toEqual(['VERSION']);
    });

    it('should export multiple top-level definitions', () => {
      const exports = exportExtractor.extractExports(
        parse('class A\nend\nmodule B\nend\ndef c; end'),
      );
      expect(exports).toEqual(['A', 'B', 'c']);
    });

    it('should only export the top-level container, not nested members', () => {
      const exports = exportExtractor.extractExports(
        parse('module Billing\n  class Invoice\n    def total; end\n  end\nend'),
      );
      expect(exports).toEqual(['Billing']);
    });

    it('should return an empty array for a file with no definitions', () => {
      expect(exportExtractor.extractExports(parse('x = compute(1, 2)'))).toEqual([]);
    });

    it('should deduplicate re-opened classes', () => {
      const exports = exportExtractor.extractExports(parse('class A\nend\nclass A\nend'));
      expect(exports).toEqual(['A']);
    });
  });

  describe('Import Extraction', () => {
    const firstCall = (code: string) => parse(code).namedChild(0)!;

    it('should extract a require path', () => {
      expect(importExtractor.extractImportPath(firstCall("require 'json'"))).toBe('json');
    });

    it('should extract a require_relative path', () => {
      expect(importExtractor.extractImportPath(firstCall("require_relative '../lib/foo'"))).toBe(
        '../lib/foo',
      );
    });

    it('should extract a load path', () => {
      expect(importExtractor.extractImportPath(firstCall("load 'config.rb'"))).toBe('config.rb');
    });

    it('should extract the path argument of autoload (skipping the symbol)', () => {
      expect(importExtractor.extractImportPath(firstCall("autoload :Bar, 'bar'"))).toBe('bar');
    });

    it('should return null for non-require method calls', () => {
      expect(importExtractor.extractImportPath(firstCall("puts 'hello'"))).toBeNull();
      expect(importExtractor.extractImportPath(firstCall('compute(1, 2)'))).toBeNull();
    });

    it('should map require_relative to its basename symbol', () => {
      const result = importExtractor.processImportSymbols(
        firstCall("require_relative '../lib/foo'"),
      );
      expect(result).toEqual({ importPath: '../lib/foo', symbols: ['foo'] });
    });

    it('should declare call as the import node type', () => {
      expect(importExtractor.importNodeTypes).toEqual(['call']);
    });
  });

  describe('Symbol Extraction', () => {
    const firstNamed = (code: string) => parse(code).namedChild(0)!;

    it('should extract a top-level method as a function', () => {
      const code = 'def helper(a, b)\n  a + b\nend';
      const symbol = symbolExtractor.extractSymbol(firstNamed(code), code)!;
      expect(symbol.name).toBe('helper');
      expect(symbol.type).toBe('function');
      expect(symbol.parameters).toEqual(['a', 'b']);
    });

    it('should extract a method inside a class as a method', () => {
      const code = 'def call(req)\n  req\nend';
      const symbol = symbolExtractor.extractSymbol(firstNamed(code), code, 'MyService')!;
      expect(symbol.type).toBe('method');
      expect(symbol.parentClass).toBe('MyService');
    });

    it('should extract a singleton method', () => {
      const code = 'def self.create(x)\n  new(x)\nend';
      const symbol = symbolExtractor.extractSymbol(firstNamed(code), code)!;
      expect(symbol.name).toBe('create');
    });

    it('should produce a clean signature that excludes the body', () => {
      const code = 'def charge(card, retries = 3)\n  process(card)\nend';
      const symbol = symbolExtractor.extractSymbol(firstNamed(code), code)!;
      expect(symbol.signature).toContain('charge');
      expect(symbol.signature).toContain('card');
      expect(symbol.signature).toContain('retries = 3');
      expect(symbol.signature).not.toContain('process');
    });

    it('should capture optional/default parameters', () => {
      const code = 'def charge(card, retries = 3)\n  card\nend';
      const symbol = symbolExtractor.extractSymbol(firstNamed(code), code)!;
      expect(symbol.parameters).toEqual(['card', 'retries = 3']);
    });

    it('should extract a class with its superclass in the signature', () => {
      const code = 'class CreditService < Base\nend';
      const symbol = symbolExtractor.extractSymbol(firstNamed(code), code)!;
      expect(symbol.type).toBe('class');
      expect(symbol.name).toBe('CreditService');
      expect(symbol.signature).toBe('class CreditService < Base');
    });

    it('should extract a class without a superclass', () => {
      const code = 'class User\nend';
      const symbol = symbolExtractor.extractSymbol(firstNamed(code), code)!;
      expect(symbol.signature).toBe('class User');
    });

    it('should extract a module as a class-typed symbol', () => {
      const code = 'module Billing\nend';
      const symbol = symbolExtractor.extractSymbol(firstNamed(code), code)!;
      expect(symbol.type).toBe('class');
      expect(symbol.name).toBe('Billing');
      expect(symbol.signature).toBe('module Billing');
    });

    it('should extract a direct call site', () => {
      const code = 'process(card)';
      const callNode = firstNamed(code);
      expect(symbolExtractor.extractCallSite(callNode)).toMatchObject({
        symbol: 'process',
        line: 1,
      });
    });

    it('should extract a receiver call site by method name', () => {
      const code = 'card.charge(amount)';
      const callNode = firstNamed(code);
      expect(symbolExtractor.extractCallSite(callNode)).toMatchObject({
        symbol: 'charge',
        line: 1,
      });
    });

    it('should count if/elsif branches for cyclomatic complexity', () => {
      const code = [
        'def charge(card, retries)',
        '  if card.nil?',
        '    raise Error',
        '  elsif retries > 0',
        '    process(card)',
        '  else',
        '    fail',
        '  end',
        'end',
      ].join('\n');
      const symbol = symbolExtractor.extractSymbol(firstNamed(code), code)!;
      // base 1 + if + elsif (else is not a branch)
      expect(symbol.complexity).toBe(3);
    });

    it('should count a modifier-if for cyclomatic complexity', () => {
      const code = 'def notify(user)\n  send_email(user) if user.active?\nend';
      const symbol = symbolExtractor.extractSymbol(firstNamed(code), code)!;
      // base 1 + if_modifier
      expect(symbol.complexity).toBe(2);
    });

    it('should count case/when branches for cyclomatic complexity', () => {
      const code = [
        'def label(x)',
        '  case x',
        '  when 1 then :a',
        '  when 2 then :b',
        '  else :c',
        '  end',
        'end',
      ].join('\n');
      const symbol = symbolExtractor.extractSymbol(firstNamed(code), code)!;
      // base 1 + two when arms
      expect(symbol.complexity).toBe(3);
    });
  });

  describe('AST Chunking Integration', () => {
    const RUBY_FILE = [
      "require 'json'",
      "require_relative './base'",
      '',
      'module Billing',
      '  class CreditService < Base',
      '    def initialize(amount)',
      '      @amount = amount',
      '    end',
      '',
      '    def self.create(x)',
      '      new(x)',
      '    end',
      '',
      '    def charge(card)',
      '      process(card)',
      '    end',
      '  end',
      'end',
    ].join('\n');

    it('should extract method chunks from a nested module/class', () => {
      const chunks = chunkByAST('billing.rb', RUBY_FILE);
      const names = chunks.map(c => c.metadata.symbolName);
      expect(names).toContain('initialize');
      expect(names).toContain('create');
      expect(names).toContain('charge');
    });

    it('should attach the enclosing class as parentClass', () => {
      const chunks = chunkByAST('billing.rb', RUBY_FILE);
      const charge = chunks.find(c => c.metadata.symbolName === 'charge');
      expect(charge?.metadata.parentClass).toBe('CreditService');
    });

    it('should produce clean method signatures', () => {
      const chunks = chunkByAST('billing.rb', RUBY_FILE);
      const charge = chunks.find(c => c.metadata.symbolName === 'charge');
      expect(charge?.metadata.signature).toContain('def charge(card)');
      expect(charge?.metadata.signature).not.toContain('process');
    });

    it('should chunk a standalone top-level method', () => {
      const chunks = chunkByAST('util.rb', 'def slugify(text)\n  text.downcase\nend');
      expect(chunks.some(c => c.metadata.symbolName === 'slugify')).toBe(true);
    });
  });
});

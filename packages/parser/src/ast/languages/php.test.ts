import { describe, it, expect } from 'vitest';
import { mustParse } from '../test/helpers/parse-fixture.js';
import type { SyntaxNode } from '../types.js';
import { chunkByAST } from '../chunker.js';
import { PHPTraverser, PHPExportExtractor, PHPImportExtractor, PHPSymbolExtractor } from './php.js';

describe('PHP Language', () => {
  const traverser = new PHPTraverser();
  const exportExtractor = new PHPExportExtractor();
  const importExtractor = new PHPImportExtractor();
  const symbolExtractor = new PHPSymbolExtractor();

  describe('Traverser', () => {
    it('should identify function and method node types as targets', () => {
      expect(traverser.targetNodeTypes).toContain('function_definition');
      expect(traverser.targetNodeTypes).toContain('method_declaration');
    });

    it('should identify class, trait, and interface as containers', () => {
      expect(traverser.containerTypes).toContain('class_declaration');
      expect(traverser.containerTypes).toContain('trait_declaration');
      expect(traverser.containerTypes).toContain('interface_declaration');
    });

    it('should extract children from class declarations', () => {
      const code = '<?php\nclass Foo { public function bar() {} }';
      const root = mustParse(code, 'php');
      // PHP AST: rootNode > program > php_tag, class_declaration
      const programNode = root;
      let classNode: SyntaxNode | null = null;
      for (const child of programNode.namedChildren) {
        if (child.type === 'class_declaration') {
          classNode = child;
          break;
        }
        // Traverse into php node
        if (child.type === 'php' || child.type === 'program') {
          const found = child.namedChildren.find(gc => gc.type === 'class_declaration');
          if (found) {
            classNode = found;
            break;
          }
        }
      }
      if (classNode) {
        expect(traverser.shouldExtractChildren(classNode)).toBe(true);
      }
    });

    it('should traverse program and php node types', () => {
      const code = '<?php\nfunction foo() {}';
      const root = mustParse(code, 'php');
      expect(traverser.shouldTraverseChildren(root)).toBe(true);
    });

    it('should not treat any nodes as declarations with functions', () => {
      const code = '<?php\n$x = 42;';
      const root = mustParse(code, 'php');
      root.namedChildren.forEach(child => {
        expect(traverser.isDeclarationWithFunction(child)).toBe(false);
      });
    });

    it('should return no function from findFunctionInDeclaration', () => {
      const code = '<?php\n$x = 42;';
      const root = mustParse(code, 'php');
      const result = traverser.findFunctionInDeclaration(root);
      expect(result.hasFunction).toBe(false);
      expect(result.functionNode).toBeNull();
    });

    it('should find parent class name for methods', () => {
      const code = '<?php\nclass MyClass { public function myMethod() {} }';
      const root = mustParse(code, 'php');

      // Find the method_declaration node
      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const methodNode = findNode(root, 'method_declaration');
      if (methodNode) {
        expect(traverser.findParentContainerName(methodNode)).toBe('MyClass');
      }
    });
  });

  describe('Export Extraction', () => {
    it('should extract class exports', () => {
      const code = '<?php\nclass User {}';
      const root = mustParse(code, 'php');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['User']);
    });

    it('should extract trait exports', () => {
      const code = '<?php\ntrait HasTimestamps {}';
      const root = mustParse(code, 'php');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['HasTimestamps']);
    });

    it('should extract interface exports', () => {
      const code = '<?php\ninterface Repository {}';
      const root = mustParse(code, 'php');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['Repository']);
    });

    it('should extract function exports', () => {
      const code = '<?php\nfunction helper() {}';
      const root = mustParse(code, 'php');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['helper']);
    });

    it('should extract namespaced class exports', () => {
      const code = '<?php\nnamespace App\\Models;\nclass User {}';
      const root = mustParse(code, 'php');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['User']);
    });

    it('should extract multiple exports', () => {
      const code = `<?php
class User {}
function helper() {}
interface Repository {}`;
      const root = mustParse(code, 'php');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['User', 'helper', 'Repository']);
    });

    it('should not export methods (only top-level declarations)', () => {
      const code = `<?php
class User {
    public function getName() {}
}`;
      const root = mustParse(code, 'php');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toEqual(['User']);
      expect(exports).not.toContain('getName');
    });
  });

  describe('Import Extraction', () => {
    it('should identify namespace_use_declaration as import node type', () => {
      expect(importExtractor.importNodeTypes).toContain('namespace_use_declaration');
    });

    it('should extract use declaration path', () => {
      const code = '<?php\nuse App\\Models\\User;';
      const root = mustParse(code, 'php');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const useNode = findNode(root, 'namespace_use_declaration');
      if (useNode) {
        const path = importExtractor.extractImportPath(useNode);
        expect(path).toBe('App\\Models\\User');
      }
    });

    it('should extract import symbol from use declaration', () => {
      const code = '<?php\nuse App\\Models\\User;';
      const root = mustParse(code, 'php');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const useNode = findNode(root, 'namespace_use_declaration');
      if (useNode) {
        const result = importExtractor.processImportSymbols(useNode);
        expect(result).not.toBeNull();
        expect(result!.importPath).toBe('App\\Models\\User');
        expect(result!.symbols).toContain('User');
      }
    });

    it('should extract aliased import symbol', () => {
      const code = '<?php\nuse App\\Services\\AuthService as Auth;';
      const root = mustParse(code, 'php');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const useNode = findNode(root, 'namespace_use_declaration');
      if (useNode) {
        const result = importExtractor.processImportSymbols(useNode);
        expect(result).not.toBeNull();
        expect(result!.symbols).toContain('Auth');
      }
    });

    // Grouped use (`use Ns\{A, B};`, PHP 7+) previously returned null for the
    // WHOLE declaration from both extractImportPath and processImportSymbols
    // — tree-sitter-php parses it as a `namespace_name` prefix sibling plus a
    // `namespace_use_group` of `namespace_use_clause` items, a shape the
    // extractor didn't recognize at all (distinct from the simple/aliased
    // form's `namespace_use_clause -> qualified_name`). Each item targets a
    // different file under PSR-4, so — mirroring GoImportExtractor's "first
    // wins" precedent for its own multi-target grouped imports — only the
    // first item is captured rather than the whole statement staying invisible.
    it('should extract the first target from a grouped use declaration', () => {
      const code = '<?php\nuse App\\Models\\{User, Post};';
      const root = mustParse(code, 'php');
      const useNode = root.namedChild(1)!;
      expect(useNode.type).toBe('namespace_use_declaration');
      const path = importExtractor.extractImportPath(useNode);
      expect(path).toBe('App\\Models\\User');
    });

    it('should extract import symbols from a grouped use declaration', () => {
      const code = '<?php\nuse App\\Models\\{User, Post};';
      const root = mustParse(code, 'php');
      const useNode = root.namedChild(1)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('App\\Models\\User');
      expect(result!.symbols).toEqual(['User']);
    });

    it('should use the alias as the symbol for an aliased item in a grouped use', () => {
      const code = '<?php\nuse App\\Models\\{User as UserModel, Post};';
      const root = mustParse(code, 'php');
      const useNode = root.namedChild(1)!;
      const result = importExtractor.processImportSymbols(useNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('App\\Models\\User');
      expect(result!.symbols).toEqual(['UserModel']);
    });

    it('extractImportPaths wraps the single extractImportPath result in an array (default shape, #863)', () => {
      const code = '<?php\nuse App\\Models\\User;';
      const root = mustParse(code, 'php');
      const useNode = root.namedChild(1)!;
      expect(importExtractor.extractImportPaths(useNode)).toEqual(['App\\Models\\User']);
    });

    // FQCN-reference scanning (#878): a test file can genuinely exercise a
    // source class via a fully-qualified reference with no corresponding
    // `use` import for declaration-based extraction to find. Guzzle's real
    // remainder from #877's dogfood (`RetryMiddleware.php`, referenced only
    // via `Middleware::retry()`) stays unresolved by design -- see the
    // last test in this block.
    describe('extractReferencedFQCNs (fully-qualified class-name references, #878)', () => {
      it('extracts a fully-qualified `new` instantiation', () => {
        const code = `<?php
class FooTest {
  public function testFoo() {
    $x = new \\GuzzleHttp\\RetryMiddleware($a, $b);
  }
}`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractReferencedFQCNs(root)).toEqual([
          'GuzzleHttp\\RetryMiddleware',
        ]);
      });

      it('extracts a fully-qualified `::class` reference', () => {
        const code = `<?php
class FooTest {
  public function testFoo() {
    $this->expectException(\\GuzzleHttp\\Exception\\ClientException::class);
  }
}`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractReferencedFQCNs(root)).toEqual([
          'GuzzleHttp\\Exception\\ClientException',
        ]);
      });

      it('extracts a fully-qualified static method call', () => {
        const code = `<?php
class FooTest {
  public function testFoo() {
    $y = \\GuzzleHttp\\Middleware::retry();
  }
}`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractReferencedFQCNs(root)).toEqual(['GuzzleHttp\\Middleware']);
      });

      it('deduplicates repeated references to the same class', () => {
        const code = `<?php
class FooTest {
  public function testFoo() {
    $a = new \\GuzzleHttp\\RetryMiddleware();
    $b = new \\GuzzleHttp\\RetryMiddleware();
  }
}`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractReferencedFQCNs(root)).toEqual([
          'GuzzleHttp\\RetryMiddleware',
        ]);
      });

      it('ignores a "qualified" (not fully-qualified) name -- no leading backslash', () => {
        // Inside namespace Tests, `GuzzleHttp\Middleware` (no leading \) resolves
        // relative to the current namespace or a `use`-imported alias -- genuinely
        // ambiguous without cross-referencing the file's own use imports, and
        // exactly the shape #868/#883 guard against elsewhere. Real PHP code
        // always uses either a leading-\ FQCN or a bare `use`-imported name for
        // this; this input is deliberately the untrusted middle case.
        const code = `<?php
namespace Tests;
class FooTest {
  public function testFoo() {
    $y = GuzzleHttp\\Middleware::retry();
  }
}`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractReferencedFQCNs(root)).toEqual([]);
      });

      it('ignores a bare name already reachable via a `use` import', () => {
        const code = `<?php
use GuzzleHttp\\Exception\\ClientException;
class FooTest {
  public function testFoo() {
    self::assertInstanceOf(ClientException::class, $e);
  }
}`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractReferencedFQCNs(root)).toEqual([]);
      });

      it('ignores a fully-qualified single-segment (global-namespace) reference', () => {
        // \DateTime, \Exception, etc. are PHP built-ins or global-namespace
        // classes -- never a Composer-autoloaded project file under a PSR-4
        // vendor prefix, so there is no source file this could ever match.
        const code = `<?php
class FooTest {
  public function testFoo() {
    $x = \\DateTime::class;
  }
}`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractReferencedFQCNs(root)).toEqual([]);
      });

      it('does not resolve the transitive factory-indirection shape (honest remainder, #878)', () => {
        // The real guzzle case: RetryMiddlewareTest.php calls Middleware::retry()
        // and never mentions RetryMiddleware anywhere in its own text -- the
        // factory (a DIFFERENT file, Middleware.php) is what internally `new`s
        // RetryMiddleware. A single-file structural scan has no way to see that;
        // this is the honest, documented remainder of #878.
        const code = `<?php
use GuzzleHttp\\Middleware;
class RetryMiddlewareTest {
  public function testRetry() {
    $middleware = Middleware::retry(fn() => true);
  }
}`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractReferencedFQCNs(root)).toEqual([]);
      });
    });

    // require/include static-target scanning (#1009): PHP's OTHER
    // file-inclusion mechanism, alongside `use`. `require`/`include` are
    // expressions (not declarations), so most call sites are only resolvable
    // at runtime -- only a plain literal, a `__DIR__`/`dirname(__FILE__)`
    // -prefixed one, or a `dirname(__DIR__)`-prefixed one (the file's PARENT
    // directory) is statically decidable. This method only returns a
    // `./`- or `../`-prefixed specifier; the existence check that decides
    // whether it becomes a real edge lives one layer up
    // (`appendStaticRequireTargets` in `ast/symbols.ts`, exercised in
    // `chunker.test.ts`).
    describe('extractStaticRequireTargets (require/include static targets, #1009)', () => {
      it('resolves a plain string literal relative to the containing file', () => {
        const code = `<?php
include 'includes/foo.php';`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual(['./includes/foo.php']);
      });

      it('resolves `__DIR__ . <literal>` relative to the containing file', () => {
        const code = `<?php
require __DIR__ . '/../vendor/autoload.php';`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual([
          './../vendor/autoload.php',
        ]);
      });

      it('resolves `dirname(__FILE__) . <literal>` the same way as `__DIR__`', () => {
        const code = `<?php
require_once dirname(__FILE__) . '/config.php';`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual(['./config.php']);
      });

      it('resolves `dirname(__DIR__) . <literal>` one level up (WordPress admin-ajax.php repro, #1009 dogfood)', () => {
        const code = `<?php
require_once dirname( __DIR__ ) . '/wp-load.php';`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual(['../wp-load.php']);
      });

      it('resolves non-canonical-case magic constants and `dirname` the same way (PHP is case-insensitive, Lien Review finding)', () => {
        // Confirmed empirically against a real PHP 8.4 interpreter: __dir__,
        // __file__, and Dirname()/DIRNAME() all behave identically to their
        // canonical-case spelling -- PHP magic constants and built-in
        // function names are both case-insensitive at the language level.
        const code = `<?php
require __dir__ . '/config.php';
require dirname(__file__) . '/other.php';
require Dirname(__FILE__) . '/third.php';
require DIRNAME(__DIR__) . '/fourth.php';`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual([
          './config.php',
          './other.php',
          './third.php',
          '../fourth.php',
        ]);
      });

      it('skips a bare-constant concatenation even when it names a directory-shaped constant (WordPress ABSPATH repro)', () => {
        // ABSPATH is assigned dynamically in wp-load.php -- not a lexical
        // compile-time constant like `__DIR__`, so it is NOT one of the
        // `dirLevelOf` shapes and stays unresolved, unlike `dirname(__DIR__)`.
        const code = `<?php
require_once ABSPATH . 'wp-admin/includes/admin.php';`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual([]);
      });

      it('unwraps a parenthesized target (WordPress-style `require_once( ... )`)', () => {
        const code = `<?php
require_once( __DIR__ . '/wp-load.php' );`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual(['./wp-load.php']);
      });

      it('handles `include_once` the same way as the other three keywords', () => {
        const code = `<?php
include_once __DIR__ . '/helpers.php';`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual(['./helpers.php']);
      });

      it('finds a require nested inside a function body, not just top-level', () => {
        // Unlike `use` (always top-level), require/include can appear
        // anywhere a PHP expression can -- this method scans the whole file.
        const code = `<?php
function bootstrap() {
  if (!defined('LOADED')) {
    require __DIR__ . '/config.php';
  }
}`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual(['./config.php']);
      });

      it('deduplicates two requires that resolve to the same target', () => {
        const code = `<?php
require __DIR__ . '/config.php';
require_once __DIR__ . '/config.php';`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual(['./config.php']);
      });

      it('skips a variable target -- not statically decidable', () => {
        const code = `<?php
require $someVariable;`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual([]);
      });

      it('skips a bare-constant concatenation -- not the `__DIR__`/`dirname(__FILE__)` shape', () => {
        const code = `<?php
require SOME_CONSTANT . '/file.php';`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual([]);
      });

      it('skips a function-call concatenation other than `dirname(__FILE__)`', () => {
        const code = `<?php
require foo() . '/file.php';`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual([]);
      });

      it('skips a bare OS-absolute literal rather than guessing', () => {
        const code = `<?php
require '/etc/passwd';`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual([]);
      });

      it('skips an interpolated string -- its value is only known at runtime', () => {
        const code = `<?php
require __DIR__ . "/$var/config.php";`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual([]);
      });

      it('is a no-op for a file with no require/include statements at all', () => {
        const code = `<?php
use App\\Models\\User;
class Foo {}`;
        const root = mustParse(code, 'php');
        expect(importExtractor.extractStaticRequireTargets(root)).toEqual([]);
      });
    });
  });

  describe('Symbol Extraction', () => {
    it('should extract function definition info', () => {
      const code = '<?php\nfunction processData($items) { return $items; }';
      const root = mustParse(code, 'php');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const funcNode = findNode(root, 'function_definition');
      if (funcNode) {
        const symbol = symbolExtractor.extractSymbol(funcNode, code);
        expect(symbol).not.toBeNull();
        expect(symbol!.name).toBe('processData');
        expect(symbol!.type).toBe('function');
      }
    });

    it('should extract method declaration info with parent class', () => {
      const code = `<?php
class User {
    public function getName() { return $this->name; }
}`;
      const root = mustParse(code, 'php');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const methodNode = findNode(root, 'method_declaration');
      if (methodNode) {
        const symbol = symbolExtractor.extractSymbol(methodNode, code, 'User');
        expect(symbol).not.toBeNull();
        expect(symbol!.name).toBe('getName');
        expect(symbol!.type).toBe('method');
        expect(symbol!.parentClass).toBe('User');
      }
    });

    it('should extract class declaration info', () => {
      const code = '<?php\nclass UserService {}';
      const root = mustParse(code, 'php');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const classNode = findNode(root, 'class_declaration');
      if (classNode) {
        const symbol = symbolExtractor.extractSymbol(classNode, code);
        expect(symbol).not.toBeNull();
        expect(symbol!.name).toBe('UserService');
        expect(symbol!.type).toBe('class');
        expect(symbol!.signature).toBe('class UserService');
      }
    });

    // #976 (#965 recurring): `signature` dropped the extends/implements
    // heritage clause entirely — `class Dog extends Animal implements
    // Serializable {}` came back as bare `class Dog`, the single most
    // useful fact about the class.
    it('should include the extends/implements heritage clause in a class signature', () => {
      const code = '<?php\nclass Dog extends Animal implements Serializable {}';
      const root = mustParse(code, 'php');
      const classNode = root.namedChildren.find(child => child.type === 'class_declaration');
      expect(classNode).not.toBeUndefined();
      const symbol = symbolExtractor.extractSymbol(classNode!, code);
      expect(symbol!.signature).toBe('class Dog extends Animal implements Serializable');
    });

    it('should extract call site from function call', () => {
      const code = '<?php\nhelper();';
      const root = mustParse(code, 'php');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const callNode = findNode(root, 'function_call_expression');
      if (callNode) {
        const callSite = symbolExtractor.extractCallSite(callNode);
        expect(callSite).not.toBeNull();
        expect(callSite!.symbol).toBe('helper');
      }
    });

    it('should extract call site from member call', () => {
      const code = '<?php\n$user->getName();';
      const root = mustParse(code, 'php');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const callNode = findNode(root, 'member_call_expression');
      if (callNode) {
        const callSite = symbolExtractor.extractCallSite(callNode);
        expect(callSite).not.toBeNull();
        expect(callSite!.symbol).toBe('getName');
      }
    });

    it('should extract call site from scoped call', () => {
      const code = '<?php\nUser::find(1);';
      const root = mustParse(code, 'php');

      function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;
        for (const child of node.namedChildren) {
          const result = findNode(child, type);
          if (result) return result;
        }
        return null;
      }

      const callNode = findNode(root, 'scoped_call_expression');
      if (callNode) {
        const callSite = symbolExtractor.extractCallSite(callNode);
        expect(callSite).not.toBeNull();
        expect(callSite!.symbol).toBe('find');
      }
    });
  });

  describe('AST Chunking Integration', () => {
    it('should chunk PHP functions', () => {
      const content = `<?php
function greet($name) {
    return "Hello " . $name;
}

function add($a, $b) {
    return $a + $b;
}`;

      const chunks = chunkByAST('test.php', content);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      const greetChunk = chunks.find(c => c.metadata.symbolName === 'greet');
      expect(greetChunk).toBeDefined();
      expect(greetChunk?.metadata.symbolType).toBe('function');

      const addChunk = chunks.find(c => c.metadata.symbolName === 'add');
      expect(addChunk).toBeDefined();
    });

    it('should chunk PHP classes with methods', () => {
      const content = `<?php
class Calculator {
    public function add($a, $b) {
        return $a + $b;
    }

    public function subtract($a, $b) {
        return $a - $b;
    }
}`;

      const chunks = chunkByAST('test.php', content);
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      const classChunk = chunks.find(c => c.metadata.symbolName === 'Calculator');
      expect(classChunk).toBeDefined();
      expect(classChunk?.metadata.symbolType).toBe('class');

      const addMethod = chunks.find(c => c.metadata.symbolName === 'add');
      expect(addMethod).toBeDefined();
      expect(addMethod?.metadata.symbolType).toBe('method');
      expect(addMethod?.metadata.parentClass).toBe('Calculator');
    });

    it('should handle PHP traits', () => {
      const content = `<?php
trait HasTimestamps {
    public function createdAt() {
        return $this->created_at;
    }
}`;

      const chunks = chunkByAST('test.php', content);
      const methodChunk = chunks.find(c => c.metadata.symbolName === 'createdAt');
      expect(methodChunk).toBeDefined();
      expect(methodChunk?.metadata.symbolType).toBe('method');
    });

    it('should extract exports from PHP files', () => {
      const content = `<?php
class User {}

function helper() {
    return true;
}`;

      const chunks = chunkByAST('test.php', content);
      // PHP implicitly exports all top-level declarations
      const classChunk = chunks.find(c => c.metadata.symbolName === 'User');
      expect(classChunk).toBeDefined();
      expect(classChunk?.metadata.exports).toContain('User');
      expect(classChunk?.metadata.exports).toContain('helper');
    });

    it('should calculate complexity for PHP functions', () => {
      const content = `<?php
function check($value) {
    if ($value > 0) {
        return true;
    } elseif ($value < 0) {
        return false;
    }
    return null;
}`;

      const chunks = chunkByAST('test.php', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'check');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeGreaterThanOrEqual(2);
    });

    it('should handle namespaced PHP classes', () => {
      const content = `<?php
namespace App\\Models;

class User {
    public function getName() {
        return $this->name;
    }
}`;

      const chunks = chunkByAST('test.php', content);
      const classChunk = chunks.find(c => c.metadata.symbolName === 'User');
      expect(classChunk).toBeDefined();
      expect(classChunk?.metadata.symbolType).toBe('class');
    });

    it('should handle PHP interface declarations', () => {
      const content = `<?php
interface Repository {
    public function find($id);
    public function save($entity);
}`;

      const chunks = chunkByAST('test.php', content);
      // Interface methods are extracted as method_declaration nodes
      const findMethod = chunks.find(c => c.metadata.symbolName === 'find');
      expect(findMethod).toBeDefined();
    });
  });
});

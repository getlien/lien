import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import PHP from 'tree-sitter-php';
import { chunkByAST } from '../chunker.js';
import { PHPTraverser, PHPExportExtractor, PHPImportExtractor, PHPSymbolExtractor } from './php.js';

describe('PHP Language', () => {
  const parser = new Parser();
  parser.setLanguage(PHP.php);
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
      const tree = parser.parse(code);
      // PHP AST: rootNode > program > php_tag, class_declaration
      const programNode = tree.rootNode;
      let classNode: Parser.SyntaxNode | null = null;
      for (let i = 0; i < programNode.namedChildCount; i++) {
        const child = programNode.namedChild(i);
        if (child?.type === 'class_declaration') {
          classNode = child;
          break;
        }
        // Traverse into php node
        if (child?.type === 'php' || child?.type === 'program') {
          for (let j = 0; j < child.namedChildCount; j++) {
            const grandchild = child.namedChild(j);
            if (grandchild?.type === 'class_declaration') {
              classNode = grandchild;
              break;
            }
          }
        }
      }
      if (classNode) {
        expect(traverser.shouldExtractChildren(classNode)).toBe(true);
      }
    });

    it('should traverse program and php node types', () => {
      const code = '<?php\nfunction foo() {}';
      const tree = parser.parse(code);
      expect(traverser.shouldTraverseChildren(tree.rootNode)).toBe(true);
    });

    it('should not treat any nodes as declarations with functions', () => {
      const code = '<?php\n$x = 42;';
      const tree = parser.parse(code);
      for (let i = 0; i < tree.rootNode.namedChildCount; i++) {
        const child = tree.rootNode.namedChild(i);
        if (child) {
          expect(traverser.isDeclarationWithFunction(child)).toBe(false);
        }
      }
    });

    it('should return no function from findFunctionInDeclaration', () => {
      const code = '<?php\n$x = 42;';
      const tree = parser.parse(code);
      const result = traverser.findFunctionInDeclaration(tree.rootNode);
      expect(result.hasFunction).toBe(false);
      expect(result.functionNode).toBeNull();
    });

    it('should find parent class name for methods', () => {
      const code = '<?php\nclass MyClass { public function myMethod() {} }';
      const tree = parser.parse(code);

      // Find the method_declaration node
      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const result = findNode(node.namedChild(i)!, type);
          if (result) return result;
        }
        return null;
      }

      const methodNode = findNode(tree.rootNode, 'method_declaration');
      if (methodNode) {
        expect(traverser.findParentContainerName(methodNode)).toBe('MyClass');
      }
    });
  });

  describe('Export Extraction', () => {
    it('should extract class exports', () => {
      const code = '<?php\nclass User {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['User']);
    });

    it('should extract trait exports', () => {
      const code = '<?php\ntrait HasTimestamps {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['HasTimestamps']);
    });

    it('should extract interface exports', () => {
      const code = '<?php\ninterface Repository {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['Repository']);
    });

    it('should extract function exports', () => {
      const code = '<?php\nfunction helper() {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['helper']);
    });

    it('should extract namespaced class exports', () => {
      const code = '<?php\nnamespace App\\Models;\nclass User {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['User']);
    });

    it('should extract multiple exports', () => {
      const code = `<?php
class User {}
function helper() {}
interface Repository {}`;
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['User', 'helper', 'Repository']);
    });

    it('should not export methods (only top-level declarations)', () => {
      const code = `<?php
class User {
    public function getName() {}
}`;
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
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
      const tree = parser.parse(code);

      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            const result = findNode(child, type);
            if (result) return result;
          }
        }
        return null;
      }

      const useNode = findNode(tree.rootNode, 'namespace_use_declaration');
      if (useNode) {
        const path = importExtractor.extractImportPath(useNode);
        expect(path).toBe('App\\Models\\User');
      }
    });

    it('should extract import symbol from use declaration', () => {
      const code = '<?php\nuse App\\Models\\User;';
      const tree = parser.parse(code);

      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            const result = findNode(child, type);
            if (result) return result;
          }
        }
        return null;
      }

      const useNode = findNode(tree.rootNode, 'namespace_use_declaration');
      if (useNode) {
        const result = importExtractor.processImportSymbols(useNode);
        expect(result).not.toBeNull();
        expect(result!.importPath).toBe('App\\Models\\User');
        expect(result!.symbols).toContain('User');
      }
    });

    it('should extract aliased import symbol', () => {
      const code = '<?php\nuse App\\Services\\AuthService as Auth;';
      const tree = parser.parse(code);

      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            const result = findNode(child, type);
            if (result) return result;
          }
        }
        return null;
      }

      const useNode = findNode(tree.rootNode, 'namespace_use_declaration');
      if (useNode) {
        const result = importExtractor.processImportSymbols(useNode);
        expect(result).not.toBeNull();
        expect(result!.symbols).toContain('Auth');
      }
    });
  });

  describe('Symbol Extraction', () => {
    it('should extract function definition info', () => {
      const code = '<?php\nfunction processData($items) { return $items; }';
      const tree = parser.parse(code);

      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            const result = findNode(child, type);
            if (result) return result;
          }
        }
        return null;
      }

      const funcNode = findNode(tree.rootNode, 'function_definition');
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
      const tree = parser.parse(code);

      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            const result = findNode(child, type);
            if (result) return result;
          }
        }
        return null;
      }

      const methodNode = findNode(tree.rootNode, 'method_declaration');
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
      const tree = parser.parse(code);

      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            const result = findNode(child, type);
            if (result) return result;
          }
        }
        return null;
      }

      const classNode = findNode(tree.rootNode, 'class_declaration');
      if (classNode) {
        const symbol = symbolExtractor.extractSymbol(classNode, code);
        expect(symbol).not.toBeNull();
        expect(symbol!.name).toBe('UserService');
        expect(symbol!.type).toBe('class');
        expect(symbol!.signature).toBe('class UserService');
      }
    });

    it('should extract call site from function call', () => {
      const code = '<?php\nhelper();';
      const tree = parser.parse(code);

      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            const result = findNode(child, type);
            if (result) return result;
          }
        }
        return null;
      }

      const callNode = findNode(tree.rootNode, 'function_call_expression');
      if (callNode) {
        const callSite = symbolExtractor.extractCallSite(callNode);
        expect(callSite).not.toBeNull();
        expect(callSite!.symbol).toBe('helper');
      }
    });

    it('should extract call site from member call', () => {
      const code = '<?php\n$user->getName();';
      const tree = parser.parse(code);

      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            const result = findNode(child, type);
            if (result) return result;
          }
        }
        return null;
      }

      const callNode = findNode(tree.rootNode, 'member_call_expression');
      if (callNode) {
        const callSite = symbolExtractor.extractCallSite(callNode);
        expect(callSite).not.toBeNull();
        expect(callSite!.symbol).toBe('getName');
      }
    });

    it('should extract call site from scoped call', () => {
      const code = '<?php\nUser::find(1);';
      const tree = parser.parse(code);

      function findNode(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            const result = findNode(child, type);
            if (result) return result;
          }
        }
        return null;
      }

      const callNode = findNode(tree.rootNode, 'scoped_call_expression');
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

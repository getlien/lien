import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import Go from 'tree-sitter-go';
import { chunkByAST } from '../chunker.js';
import { GoTraverser, GoExportExtractor, GoImportExtractor, GoSymbolExtractor } from './go.js';

describe('Go Language', () => {
  const parser = new Parser();
  parser.setLanguage(Go);
  const traverser = new GoTraverser();
  const exportExtractor = new GoExportExtractor();
  const importExtractor = new GoImportExtractor();
  const symbolExtractor = new GoSymbolExtractor();

  describe('Traverser', () => {
    it('should identify function_declaration and method_declaration as target nodes', () => {
      expect(traverser.targetNodeTypes).toContain('function_declaration');
      expect(traverser.targetNodeTypes).toContain('method_declaration');
    });

    it('should have no container types', () => {
      expect(traverser.containerTypes).toHaveLength(0);
    });

    it('should identify var_declaration and short_var_declaration as declaration types', () => {
      expect(traverser.declarationTypes).toContain('var_declaration');
      expect(traverser.declarationTypes).toContain('short_var_declaration');
    });

    it('should traverse source_file root', () => {
      const code = 'package main\nfunc main() {}';
      const tree = parser.parse(code);
      expect(traverser.shouldTraverseChildren(tree.rootNode)).toBe(true);
    });

    it('should not traverse non-root nodes', () => {
      const code = 'package main\nfunc main() { if true {} }';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(1)!;
      expect(traverser.shouldTraverseChildren(funcNode)).toBe(false);
    });

    it('should detect func_literal in var_declaration', () => {
      const code = 'package main\nvar handler = func() {}';
      const tree = parser.parse(code);
      const varNode = tree.rootNode.namedChild(1)!;
      expect(traverser.isDeclarationWithFunction(varNode)).toBe(true);
    });

    it('should not detect non-function var declarations', () => {
      const code = 'package main\nvar x = 42';
      const tree = parser.parse(code);
      const varNode = tree.rootNode.namedChild(1)!;
      expect(traverser.isDeclarationWithFunction(varNode)).toBe(false);
    });

    it('should find func_literal node in var_declaration', () => {
      const code = 'package main\nvar handler = func() {}';
      const tree = parser.parse(code);
      const varNode = tree.rootNode.namedChild(1)!;
      const result = traverser.findFunctionInDeclaration(varNode);
      expect(result.hasFunction).toBe(true);
      expect(result.functionNode).not.toBeNull();
      expect(result.functionNode!.type).toBe('func_literal');
    });

    it('should always return undefined for findParentContainerName', () => {
      const code = 'package main\nfunc main() {}';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(1)!;
      expect(traverser.findParentContainerName(funcNode)).toBeUndefined();
    });

    it('should not extract children from any node', () => {
      const code = 'package main\ntype User struct { Name string }';
      const tree = parser.parse(code);
      const typeNode = tree.rootNode.namedChild(1)!;
      expect(traverser.shouldExtractChildren(typeNode)).toBe(false);
    });
  });

  describe('Export Extraction', () => {
    it('should extract exported function (uppercase)', () => {
      const code = 'package main\nfunc NewUser() {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['NewUser']);
    });

    it('should not export unexported function (lowercase)', () => {
      const code = 'package main\nfunc helper() {}';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual([]);
    });

    it('should extract exported method', () => {
      const code = 'package main\nfunc (u *User) GetName() string { return u.Name }';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['GetName']);
    });

    it('should not export unexported method', () => {
      const code = 'package main\nfunc (u *User) getName() string { return u.Name }';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual([]);
    });

    it('should extract exported struct', () => {
      const code = 'package main\ntype User struct { Name string }';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['User']);
    });

    it('should extract exported interface', () => {
      const code = 'package main\ntype Validator interface { Validate() error }';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['Validator']);
    });

    it('should not export unexported types', () => {
      const code = 'package main\ntype user struct { name string }';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual([]);
    });

    it('should extract exported constants', () => {
      const code = 'package main\nconst MaxSize = 100';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['MaxSize']);
    });

    it('should extract exported variables', () => {
      const code = 'package main\nvar GlobalVar = "hello"';
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['GlobalVar']);
    });

    it('should handle grouped const declarations', () => {
      const code = `package main
const (
  StatusActive = 1
  statusInactive = 2
  MaxRetries = 3
)`;
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('StatusActive');
      expect(exports).toContain('MaxRetries');
      expect(exports).not.toContain('statusInactive');
    });

    it('should handle grouped var declarations', () => {
      const code = `package main
var (
  Version = "1.0"
  debug = false
  Build = "123"
)`;
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toContain('Version');
      expect(exports).toContain('Build');
      expect(exports).not.toContain('debug');
    });

    it('should extract mixed exported items', () => {
      const code = `package main

func NewUser() {}
func helper() {}
type User struct {}
type config struct {}
const MaxSize = 100
const minSize = 5`;
      const tree = parser.parse(code);
      const exports = exportExtractor.extractExports(tree.rootNode);
      expect(exports).toEqual(['NewUser', 'User', 'MaxSize']);
      expect(exports).not.toContain('helper');
      expect(exports).not.toContain('config');
      expect(exports).not.toContain('minSize');
    });
  });

  describe('Import Extraction', () => {
    it('should identify import_declaration as import node type', () => {
      expect(importExtractor.importNodeTypes).toContain('import_declaration');
    });

    it('should return null for stdlib imports', () => {
      const code = 'package main\nimport "fmt"';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(1)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBeNull();
    });

    it('should return null for stdlib imports in groups', () => {
      const code = 'package main\nimport (\n  "fmt"\n  "net/http"\n)';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(1)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBeNull();
    });

    it('should extract external module import path', () => {
      const code = 'package main\nimport "github.com/gin-gonic/gin"';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(1)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBe('github.com/gin-gonic/gin');
    });

    it('should extract first external path from grouped imports', () => {
      const code = `package main
import (
  "fmt"
  "github.com/gin-gonic/gin"
  "github.com/pkg/errors"
)`;
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(1)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBe('github.com/gin-gonic/gin');
    });

    it('should process import symbols for external packages', () => {
      const code = 'package main\nimport "github.com/gin-gonic/gin"';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(1)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('github.com/gin-gonic/gin');
      expect(result!.symbols).toEqual(['gin']);
    });

    it('should process aliased import symbols', () => {
      const code = 'package main\nimport router "github.com/gin-gonic/gin"';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(1)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.symbols).toEqual(['router']);
    });

    it('should return null for stdlib import symbols', () => {
      const code = 'package main\nimport "fmt"';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(1)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).toBeNull();
    });

    it('should handle dot imports (skip alias)', () => {
      const code = 'package main\nimport . "github.com/onsi/gomega"';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(1)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('github.com/onsi/gomega');
      // Dot imports have no alias, use last path component
      expect(result!.symbols).toEqual(['gomega']);
    });

    it('should handle blank imports (skip alias)', () => {
      const code = 'package main\nimport _ "github.com/lib/pq"';
      const tree = parser.parse(code);
      const importNode = tree.rootNode.namedChild(1)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('github.com/lib/pq');
      expect(result!.symbols).toEqual(['pq']);
    });
  });

  describe('Symbol Extraction', () => {
    it('should extract function_declaration info', () => {
      const code = 'package main\nfunc NewUser(name string, age int) *User { return nil }';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(1)!;
      const symbol = symbolExtractor.extractSymbol(funcNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('NewUser');
      expect(symbol!.type).toBe('function');
      expect(symbol!.signature).toContain('NewUser');
    });

    it('should extract method with pointer receiver and parentClass', () => {
      const code = 'package main\nfunc (u *User) GetName() string { return u.Name }';
      const tree = parser.parse(code);
      const methodNode = tree.rootNode.namedChild(1)!;
      const symbol = symbolExtractor.extractSymbol(methodNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('GetName');
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('User');
    });

    it('should extract method with value receiver and parentClass', () => {
      const code = 'package main\nfunc (u User) String() string { return u.Name }';
      const tree = parser.parse(code);
      const methodNode = tree.rootNode.namedChild(1)!;
      const symbol = symbolExtractor.extractSymbol(methodNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('String');
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('User');
    });

    it('should extract struct as class', () => {
      const code = 'package main\ntype User struct { Name string }';
      const tree = parser.parse(code);
      const typeNode = tree.rootNode.namedChild(1)!;
      const symbol = symbolExtractor.extractSymbol(typeNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('User');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('type User struct');
    });

    it('should use actual type text for type alias signatures', () => {
      const code = 'package main\ntype UserID int64';
      const tree = parser.parse(code);
      const typeNode = tree.rootNode.namedChild(1)!;
      const symbol = symbolExtractor.extractSymbol(typeNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('UserID');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('type UserID int64');
    });

    it('should extract interface as interface', () => {
      const code = 'package main\ntype Validator interface { Validate() error }';
      const tree = parser.parse(code);
      const typeNode = tree.rootNode.namedChild(1)!;
      const symbol = symbolExtractor.extractSymbol(typeNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Validator');
      expect(symbol!.type).toBe('interface');
      expect(symbol!.signature).toBe('type Validator interface');
    });

    it('should extract return type from result field', () => {
      const code = 'package main\nfunc GetName() string { return "" }';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(1)!;
      const symbol = symbolExtractor.extractSymbol(funcNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.returnType).toBe('string');
    });

    it('should handle functions with no return type', () => {
      const code = 'package main\nfunc doWork() {}';
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(1)!;
      const symbol = symbolExtractor.extractSymbol(funcNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.returnType).toBeUndefined();
    });

    it('should extract call site from direct function call', () => {
      const code = 'package main\nfunc main() { doSomething() }';
      const tree = parser.parse(code);

      const callNode = findNode(tree.rootNode, 'call_expression');
      expect(callNode).not.toBeNull();
      const callSite = symbolExtractor.extractCallSite(callNode!);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('doSomething');
    });

    it('should extract call site from selector expression (method call)', () => {
      const code = 'package main\nfunc main() { user.GetName() }';
      const tree = parser.parse(code);

      const callNode = findNode(tree.rootNode, 'call_expression');
      expect(callNode).not.toBeNull();
      const callSite = symbolExtractor.extractCallSite(callNode!);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('GetName');
    });

    it('should extract call site from package function call', () => {
      const code = 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }';
      const tree = parser.parse(code);

      const callNode = findNode(tree.rootNode, 'call_expression');
      expect(callNode).not.toBeNull();
      const callSite = symbolExtractor.extractCallSite(callNode!);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('Println');
    });
  });

  describe('AST Chunking Integration', () => {
    it('should chunk Go functions', () => {
      const content = `package main

func greet(name string) string {
    return "Hello " + name
}

func add(a int, b int) int {
    return a + b
}`;

      const chunks = chunkByAST('test.go', content);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      const greetChunk = chunks.find(c => c.metadata.symbolName === 'greet');
      expect(greetChunk).toBeDefined();
      expect(greetChunk?.metadata.symbolType).toBe('function');

      const addChunk = chunks.find(c => c.metadata.symbolName === 'add');
      expect(addChunk).toBeDefined();
      expect(addChunk?.metadata.symbolType).toBe('function');
    });

    it('should chunk Go methods with receiver parentClass', () => {
      const content = `package main

type Calculator struct{}

func (c *Calculator) Add(a, b int) int {
    return a + b
}

func (c *Calculator) Subtract(a, b int) int {
    return a - b
}`;

      const chunks = chunkByAST('test.go', content);
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      const typeChunk = chunks.find(
        c => c.metadata.symbolName === 'Calculator' && c.metadata.symbolType === 'class',
      );
      expect(typeChunk).toBeDefined();

      const addMethod = chunks.find(c => c.metadata.symbolName === 'Add');
      expect(addMethod).toBeDefined();
      expect(addMethod?.metadata.symbolType).toBe('method');
      expect(addMethod?.metadata.parentClass).toBe('Calculator');
    });

    it('should chunk Go interfaces', () => {
      const content = `package main

type Drawable interface {
    Draw()
    Area() float64
}`;

      const chunks = chunkByAST('test.go', content);
      const ifaceChunk = chunks.find(c => c.metadata.symbolName === 'Drawable');
      expect(ifaceChunk).toBeDefined();
      expect(ifaceChunk?.metadata.symbolType).toBe('interface');
    });

    it('should extract exports based on capitalization', () => {
      const content = `package main

func PublicHelper() bool {
    return true
}

func privateHelper() bool {
    return false
}`;

      const chunks = chunkByAST('test.go', content);
      const pubChunk = chunks.find(c => c.metadata.symbolName === 'PublicHelper');
      expect(pubChunk).toBeDefined();
      expect(pubChunk?.metadata.exports).toContain('PublicHelper');
      expect(pubChunk?.metadata.exports).not.toContain('privateHelper');
    });

    it('should calculate complexity for Go functions', () => {
      const content = `package main

func classify(x int) string {
    if x > 0 {
        return "positive"
    } else if x < 0 {
        return "negative"
    } else {
        return "zero"
    }
}`;

      const chunks = chunkByAST('test.go', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'classify');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeGreaterThanOrEqual(2);
    });

    it('should handle Go for loops', () => {
      const content = `package main

func sumRange(n int) int {
    total := 0
    for i := 0; i < n; i++ {
        total += i
    }
    return total
}`;

      const chunks = chunkByAST('test.go', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'sumRange');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeGreaterThanOrEqual(1);
    });

    it('should handle Go switch statements', () => {
      const content = `package main

func describe(x int) string {
    switch {
    case x > 0:
        return "positive"
    case x < 0:
        return "negative"
    default:
        return "zero"
    }
}`;

      const chunks = chunkByAST('test.go', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'describe');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeGreaterThanOrEqual(1);
    });

    it('should extract function parameters', () => {
      const content = `package main

func greet(name string, age int) string {
    return name
}`;

      const chunks = chunkByAST('test.go', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'greet');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.parameters).toBeDefined();
      expect(funcChunk?.metadata.parameters?.length).toBe(2);
    });

    it('should handle Go imports in metadata', () => {
      const content = `package main

import "github.com/gin-gonic/gin"

func Serve() {
    r := gin.Default()
    r.Run()
}`;

      const chunks = chunkByAST('test.go', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'Serve');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.imports).toBeDefined();
      expect(funcChunk?.metadata.imports?.length).toBeGreaterThan(0);
    });
  });
});

/** Helper to recursively find a node of a given type */
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

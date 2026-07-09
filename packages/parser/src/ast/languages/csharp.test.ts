import { describe, it, expect } from 'vitest';
import { mustParse } from '../test/helpers/parse-fixture.js';
import type { SyntaxNode } from '../types.js';
import { chunkByAST } from '../chunker.js';
import {
  CSharpTraverser,
  CSharpExportExtractor,
  CSharpImportExtractor,
  CSharpSymbolExtractor,
} from './csharp.js';

describe('C# Language', () => {
  const traverser = new CSharpTraverser();
  const exportExtractor = new CSharpExportExtractor();
  const importExtractor = new CSharpImportExtractor();
  const symbolExtractor = new CSharpSymbolExtractor();

  describe('Traverser', () => {
    it('should identify method_declaration and constructor_declaration as target nodes', () => {
      expect(traverser.targetNodeTypes).toContain('method_declaration');
      expect(traverser.targetNodeTypes).toContain('constructor_declaration');
    });

    it('should identify class/interface/struct/record/enum as container types', () => {
      expect(traverser.containerTypes).toContain('class_declaration');
      expect(traverser.containerTypes).toContain('interface_declaration');
      expect(traverser.containerTypes).toContain('struct_declaration');
      expect(traverser.containerTypes).toContain('record_declaration');
      expect(traverser.containerTypes).toContain('enum_declaration');
    });

    it('should extract children from class declarations', () => {
      const code = 'public class Foo { public void Bar() {} }';
      const root = mustParse(code, 'csharp');
      const classNode = root.namedChild(0)!;
      expect(traverser.shouldExtractChildren(classNode)).toBe(true);
    });

    it('should get declaration_list body from class declaration', () => {
      const code = 'public class Foo { public void Bar() {} }';
      const root = mustParse(code, 'csharp');
      const classNode = root.namedChild(0)!;
      const body = traverser.getContainerBody(classNode);
      expect(body).not.toBeNull();
      expect(body!.type).toBe('declaration_list');
    });

    it('should traverse compilation_unit root', () => {
      const code = 'public class Foo {}';
      const root = mustParse(code, 'csharp');
      expect(traverser.shouldTraverseChildren(root)).toBe(true);
      expect(root.type).toBe('compilation_unit');
    });

    it('should traverse namespace_declaration', () => {
      const code = 'namespace MyApp { public class Foo {} }';
      const root = mustParse(code, 'csharp');
      const nsNode = root.namedChild(0)!;
      expect(nsNode.type).toBe('namespace_declaration');
      expect(traverser.shouldTraverseChildren(nsNode)).toBe(true);
    });

    it('should traverse declaration_list', () => {
      const code = 'public class Foo { public void Bar() {} }';
      const root = mustParse(code, 'csharp');
      const classNode = root.namedChild(0)!;
      const body = classNode.childForFieldName('body')!;
      expect(body.type).toBe('declaration_list');
      expect(traverser.shouldTraverseChildren(body)).toBe(true);
    });

    it('should not traverse method declarations', () => {
      const code = 'public class Foo { public void Bar() {} }';
      const root = mustParse(code, 'csharp');
      const classNode = root.namedChild(0)!;
      const body = classNode.childForFieldName('body')!;
      const methodNode = body.namedChild(0)!;
      expect(traverser.shouldTraverseChildren(methodNode)).toBe(false);
    });

    it('should find parent container name for methods', () => {
      const code = 'public class Calculator { public int Add(int a, int b) { return a + b; } }';
      const root = mustParse(code, 'csharp');
      const classNode = root.namedChild(0)!;
      const body = classNode.childForFieldName('body')!;
      const methodNode = body.namedChild(0)!;
      expect(traverser.findParentContainerName(methodNode)).toBe('Calculator');
    });

    it('should return undefined for top-level parent container name', () => {
      const code = 'public class Foo {}';
      const root = mustParse(code, 'csharp');
      const classNode = root.namedChild(0)!;
      expect(traverser.findParentContainerName(classNode)).toBeUndefined();
    });

    it('should find parent struct container name', () => {
      const code = 'public struct Point { public double Distance() { return 0; } }';
      const root = mustParse(code, 'csharp');
      const structNode = root.namedChild(0)!;
      const body = structNode.childForFieldName('body')!;
      const methodNode = body.namedChild(0)!;
      expect(traverser.findParentContainerName(methodNode)).toBe('Point');
    });

    it('should detect lambda in local declaration statement', () => {
      const code = 'public class Foo { void Bar() { Action a = () => Console.WriteLine("hi"); } }';
      const root = mustParse(code, 'csharp');
      const localVarDecl = findNode(root, 'local_declaration_statement');
      expect(localVarDecl).not.toBeNull();
      expect(traverser.isDeclarationWithFunction(localVarDecl!)).toBe(true);
      const result = traverser.findFunctionInDeclaration(localVarDecl!);
      expect(result.hasFunction).toBe(true);
      expect(result.functionNode).not.toBeNull();
      expect(result.functionNode!.type).toBe('lambda_expression');
    });

    it('should not detect function in non-lambda variable declaration', () => {
      const code = 'public class Foo { void Bar() { int x = 42; } }';
      const root = mustParse(code, 'csharp');
      const localVarDecl = findNode(root, 'local_declaration_statement');
      expect(localVarDecl).not.toBeNull();
      expect(traverser.isDeclarationWithFunction(localVarDecl!)).toBe(false);
    });
  });

  describe('Export Extraction', () => {
    it('should extract public class', () => {
      const code = 'public class UserService {}';
      const root = mustParse(code, 'csharp');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('UserService');
    });

    it('should not export internal class', () => {
      const code = 'internal class InternalHelper {}';
      const root = mustParse(code, 'csharp');
      const exports = exportExtractor.extractExports(root);
      expect(exports).not.toContain('InternalHelper');
    });

    it('should not export class without modifier', () => {
      const code = 'class DefaultAccess {}';
      const root = mustParse(code, 'csharp');
      const exports = exportExtractor.extractExports(root);
      expect(exports).not.toContain('DefaultAccess');
    });

    it('should extract public struct', () => {
      const code = 'public struct Point {}';
      const root = mustParse(code, 'csharp');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('Point');
    });

    it('should extract public interface', () => {
      const code = 'public interface IRepository { void Save(); }';
      const root = mustParse(code, 'csharp');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('IRepository');
    });

    it('should treat interface methods as implicitly public', () => {
      const code = `public interface IRepository {
    void Save();
    void Delete();
}`;
      const root = mustParse(code, 'csharp');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('Save');
      expect(exports).toContain('Delete');
    });

    it('should not export explicitly non-public interface members', () => {
      const code = `public interface IService {
    void PublicMethod();
    private void PrivateHelper() {}
    protected void ProtectedMethod();
}`;
      const root = mustParse(code, 'csharp');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('PublicMethod');
      expect(exports).not.toContain('PrivateHelper');
      expect(exports).not.toContain('ProtectedMethod');
    });

    it('should extract public enum', () => {
      const code = 'public enum Status { Active, Inactive }';
      const root = mustParse(code, 'csharp');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('Status');
    });

    it('should extract public methods from class', () => {
      const code = `public class UserService {
    public string GetName() { return ""; }
    private void Helper() {}
    void PackagePrivate() {}
}`;
      const root = mustParse(code, 'csharp');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('UserService');
      expect(exports).toContain('GetName');
      expect(exports).not.toContain('Helper');
      expect(exports).not.toContain('PackagePrivate');
    });

    it('should extract public properties', () => {
      const code = `public class Person {
    public string Name { get; set; }
    private int age { get; set; }
}`;
      const root = mustParse(code, 'csharp');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('Name');
      expect(exports).not.toContain('age');
    });

    it('should extract from namespace-wrapped declarations', () => {
      const code = `namespace MyApp {
    public class Foo {
        public void Run() {}
    }
}`;
      const root = mustParse(code, 'csharp');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('Foo');
      expect(exports).toContain('Run');
    });
  });

  describe('Import Extraction', () => {
    it('should identify using_directive as import node type', () => {
      expect(importExtractor.importNodeTypes).toContain('using_directive');
    });

    it('should return null for System stdlib imports', () => {
      const code = 'using System;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBeNull();
    });

    it('should return null for System.* stdlib imports', () => {
      const code = 'using System.Collections.Generic;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBeNull();
    });

    it('should return null for Microsoft.* stdlib imports', () => {
      const code = 'using Microsoft.Extensions.Logging;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBeNull();
    });

    it('should extract external import path', () => {
      const code = 'using Newtonsoft.Json;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBe('Newtonsoft.Json');
    });

    it('should handle static using', () => {
      const code = 'using static MyLib.Utils;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBe('MyLib.Utils');
    });

    it('should filter static stdlib imports', () => {
      const code = 'using static System.Math;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBeNull();
    });

    it('should handle alias using', () => {
      const code = 'using Json = Newtonsoft.Json;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBe('Newtonsoft.Json');
    });

    it('should process import symbols for external packages', () => {
      const code = 'using Newtonsoft.Json;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('Newtonsoft.Json');
      expect(result!.symbols).toEqual(['Json']);
    });

    it('should use alias name as symbol for alias using', () => {
      const code = 'using Json = Newtonsoft.Json;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('Newtonsoft.Json');
      expect(result!.symbols).toEqual(['Json']);
    });

    it('should return null for stdlib import symbols', () => {
      const code = 'using System.IO;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).toBeNull();
    });
  });

  describe('Symbol Extraction', () => {
    it('should extract method_declaration info', () => {
      const code = `public class Foo {
    public string GetName(string prefix, int id) { return prefix + id; }
}`;
      const root = mustParse(code, 'csharp');
      const methodNode = findNode(root, 'method_declaration')!;
      const symbol = symbolExtractor.extractSymbol(methodNode, code, 'Foo');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('GetName');
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('Foo');
      expect(symbol!.signature).toContain('GetName');
    });

    it('should extract constructor_declaration info', () => {
      const code = `public class User {
    public User(string name) { }
}`;
      const root = mustParse(code, 'csharp');
      const ctorNode = findNode(root, 'constructor_declaration')!;
      const symbol = symbolExtractor.extractSymbol(ctorNode, code, 'User');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('User');
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('User');
    });

    it('should extract class_declaration info', () => {
      const code = 'public class Calculator {}';
      const root = mustParse(code, 'csharp');
      const classNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(classNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Calculator');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('class Calculator');
    });

    it('should extract interface_declaration info', () => {
      const code = 'public interface IRepository {}';
      const root = mustParse(code, 'csharp');
      const ifaceNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(ifaceNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('IRepository');
      expect(symbol!.type).toBe('interface');
      expect(symbol!.signature).toBe('interface IRepository');
    });

    it('should extract struct_declaration info', () => {
      const code = 'public struct Point {}';
      const root = mustParse(code, 'csharp');
      const structNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(structNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Point');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('struct Point');
    });

    it('should extract record_declaration info', () => {
      const code = 'public record Person(string Name) {}';
      const root = mustParse(code, 'csharp');
      const recordNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(recordNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Person');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('record Person');
    });

    it('should extract enum_declaration info', () => {
      const code = 'public enum Color { Red, Green, Blue }';
      const root = mustParse(code, 'csharp');
      const enumNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(enumNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Color');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('enum Color');
    });

    it('should extract return type from method', () => {
      const code = `public class Foo {
    public string GetName() { return ""; }
}`;
      const root = mustParse(code, 'csharp');
      const methodNode = findNode(root, 'method_declaration')!;
      const symbol = symbolExtractor.extractSymbol(methodNode, code, 'Foo');
      expect(symbol).not.toBeNull();
      expect(symbol!.returnType).toBe('string');
    });

    it('should handle void return type', () => {
      const code = `public class Foo {
    public void DoWork() {}
}`;
      const root = mustParse(code, 'csharp');
      const methodNode = findNode(root, 'method_declaration')!;
      const symbol = symbolExtractor.extractSymbol(methodNode, code, 'Foo');
      expect(symbol).not.toBeNull();
      expect(symbol!.returnType).toBe('void');
    });

    it('should extract call site from direct invocation', () => {
      const code = `public class Foo {
    void Bar() { DoSomething(); }
}`;
      const root = mustParse(code, 'csharp');
      const callNode = findNode(root, 'invocation_expression');
      expect(callNode).not.toBeNull();
      const callSite = symbolExtractor.extractCallSite(callNode!);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('DoSomething');
    });

    it('should extract call site from member access invocation', () => {
      const code = `public class Foo {
    void Bar() { user.GetName(); }
}`;
      const root = mustParse(code, 'csharp');
      const callNode = findNode(root, 'invocation_expression');
      expect(callNode).not.toBeNull();
      const callSite = symbolExtractor.extractCallSite(callNode!);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('GetName');
    });

    it('should extract call site from chained invocation', () => {
      const code = `public class Foo {
    void Bar() { list.Where(x => true).Select(x => x).ToList(); }
}`;
      const root = mustParse(code, 'csharp');
      const callNodes = findAllNodes(root, 'invocation_expression');
      expect(callNodes.length).toBeGreaterThanOrEqual(3);

      const symbols = callNodes.map(n => symbolExtractor.extractCallSite(n)!.symbol);
      expect(symbols).toContain('Where');
      expect(symbols).toContain('Select');
      expect(symbols).toContain('ToList');
    });
  });

  describe('AST Chunking Integration', () => {
    it('should chunk C# methods with parentClass', () => {
      const content = `public class Calculator {
    public int Add(int a, int b) {
        return a + b;
    }

    public int Subtract(int a, int b) {
        return a - b;
    }
}`;

      const chunks = chunkByAST('Calculator.cs', content);
      expect(chunks.length).toBeGreaterThanOrEqual(3); // class + 2 methods

      const addChunk = chunks.find(c => c.metadata.symbolName === 'Add');
      expect(addChunk).toBeDefined();
      expect(addChunk?.metadata.symbolType).toBe('method');
      expect(addChunk?.metadata.parentClass).toBe('Calculator');

      const subChunk = chunks.find(c => c.metadata.symbolName === 'Subtract');
      expect(subChunk).toBeDefined();
      expect(subChunk?.metadata.symbolType).toBe('method');
      expect(subChunk?.metadata.parentClass).toBe('Calculator');
    });

    it('should chunk C# constructors with parentClass', () => {
      const content = `public class User {
    private string name;

    public User(string name) {
        this.name = name;
    }

    public string GetName() {
        return name;
    }
}`;

      const chunks = chunkByAST('User.cs', content);
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      const ctorChunk = chunks.find(
        c => c.metadata.symbolName === 'User' && c.metadata.symbolType === 'method',
      );
      expect(ctorChunk).toBeDefined();
      expect(ctorChunk?.metadata.parentClass).toBe('User');
    });

    it('should chunk C# interfaces', () => {
      const content = `public interface IDrawable {
    void Draw();
    double Area();
}`;

      const chunks = chunkByAST('IDrawable.cs', content);
      const ifaceChunk = chunks.find(c => c.metadata.symbolName === 'IDrawable');
      expect(ifaceChunk).toBeDefined();
      expect(ifaceChunk?.metadata.symbolType).toBe('interface');
    });

    it('should chunk C# structs', () => {
      const content = `public struct Point {
    public double X;
    public double Y;

    public double Distance() {
        return Math.Sqrt(X * X + Y * Y);
    }
}`;

      const chunks = chunkByAST('Point.cs', content);
      const structChunk = chunks.find(
        c => c.metadata.symbolName === 'Point' && c.metadata.symbolType === 'class',
      );
      expect(structChunk).toBeDefined();

      const distanceChunk = chunks.find(c => c.metadata.symbolName === 'Distance');
      expect(distanceChunk).toBeDefined();
      expect(distanceChunk?.metadata.symbolType).toBe('method');
      expect(distanceChunk?.metadata.parentClass).toBe('Point');
    });

    it('should extract exports based on public modifier', () => {
      const content = `public class Service {
    public void Start() {}
    private void Stop() {}
}`;

      const chunks = chunkByAST('Service.cs', content);
      const serviceChunk = chunks.find(
        c => c.metadata.symbolName === 'Service' && c.metadata.symbolType === 'class',
      );
      expect(serviceChunk).toBeDefined();
      expect(serviceChunk?.metadata.exports).toContain('Service');
      expect(serviceChunk?.metadata.exports).toContain('Start');
      expect(serviceChunk?.metadata.exports).not.toContain('Stop');
    });

    it('should calculate complexity for C# methods', () => {
      const content = `public class Classifier {
    public string Classify(int x) {
        if (x > 0) {
            return "positive";
        } else if (x < 0) {
            return "negative";
        } else {
            return "zero";
        }
    }
}`;

      const chunks = chunkByAST('Classifier.cs', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'Classify');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeGreaterThanOrEqual(2);
    });

    it('should handle C# foreach loops', () => {
      const content = `public class Processor {
    public int SumItems(int[] items) {
        int total = 0;
        foreach (var item in items) {
            total += item;
        }
        return total;
    }
}`;

      const chunks = chunkByAST('Processor.cs', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'SumItems');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeGreaterThanOrEqual(1);
    });

    it('should extract function parameters', () => {
      const content = `public class Greeter {
    public string Greet(string name, int age) {
        return name;
    }
}`;

      const chunks = chunkByAST('Greeter.cs', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'Greet');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.parameters).toBeDefined();
      expect(funcChunk?.metadata.parameters?.length).toBe(2);
    });

    it('should handle C# imports in metadata', () => {
      const content = `using Newtonsoft.Json;

public class App {
    public void Run() {
        JsonConvert.SerializeObject(null);
    }
}`;

      const chunks = chunkByAST('App.cs', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'Run');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.imports).toBeDefined();
      expect(funcChunk?.metadata.imports?.length).toBeGreaterThan(0);
    });

    it('should chunk records and their methods', () => {
      const content = `public record Point(int X, int Y) {
    public double Distance() {
        return Math.Sqrt(X * X + Y * Y);
    }
}`;

      const chunks = chunkByAST('Point.cs', content);
      const recordChunk = chunks.find(
        c => c.metadata.symbolName === 'Point' && c.metadata.symbolType === 'class',
      );
      expect(recordChunk).toBeDefined();

      const distanceChunk = chunks.find(c => c.metadata.symbolName === 'Distance');
      expect(distanceChunk).toBeDefined();
      expect(distanceChunk?.metadata.symbolType).toBe('method');
      expect(distanceChunk?.metadata.parentClass).toBe('Point');
    });

    it('should chunk enums', () => {
      const content = `public enum Status {
    Active,
    Inactive
}`;

      const chunks = chunkByAST('Status.cs', content);
      const enumChunk = chunks.find(
        c => c.metadata.symbolName === 'Status' && c.metadata.symbolType === 'class',
      );
      expect(enumChunk).toBeDefined();
    });

    it('should chunk classes inside namespaces', () => {
      const content = `namespace MyApp {
    public class Service {
        public void Execute() {}
    }
}`;

      const chunks = chunkByAST('Service.cs', content);
      const serviceChunk = chunks.find(c => c.metadata.symbolName === 'Service');
      expect(serviceChunk).toBeDefined();
      expect(serviceChunk?.metadata.symbolType).toBe('class');

      const executeChunk = chunks.find(c => c.metadata.symbolName === 'Execute');
      expect(executeChunk).toBeDefined();
      expect(executeChunk?.metadata.parentClass).toBe('Service');
    });
  });
});

/** Helper to recursively find a node of a given type (depth-first) */
function findNode(node: SyntaxNode, type: string): SyntaxNode | null {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    const result = findNode(child, type);
    if (result) return result;
  }
  return null;
}

/** Helper to recursively find all nodes of a given type */
function findAllNodes(node: SyntaxNode, type: string): SyntaxNode[] {
  const results: SyntaxNode[] = [];
  if (node.type === type) results.push(node);
  for (const child of node.namedChildren) {
    results.push(...findAllNodes(child, type));
  }
  return results;
}

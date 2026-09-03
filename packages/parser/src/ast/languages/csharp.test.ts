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

    it('should identify property_declaration and indexer_declaration as target nodes (#871)', () => {
      expect(traverser.targetNodeTypes).toContain('property_declaration');
      expect(traverser.targetNodeTypes).toContain('indexer_declaration');
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

    it('extractImportPaths wraps the single extractImportPath result in an array (default shape, #863)', () => {
      const code = 'using Newtonsoft.Json;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      expect(importExtractor.extractImportPaths(importNode)).toEqual(['Newtonsoft.Json']);

      const stdlibCode = 'using System;';
      const stdlibRoot = mustParse(stdlibCode, 'csharp');
      const stdlibNode = stdlibRoot.namedChild(0)!;
      expect(importExtractor.extractImportPaths(stdlibNode)).toEqual([]);
    });

    // A `global using` applies project-wide, not to the file that declares
    // it — its declaring file has no real dependency on the namespaces it
    // lists (issue #930). This is the same shape as GlobalUsings.cs in
    // real-world .NET 6+ projects (e.g. serilog/serilog).
    it('should return null for a global using (#930)', () => {
      const code = 'global using Serilog.Parsing;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      expect(importExtractor.extractImportPath(importNode)).toBeNull();
    });

    it('should return an empty array from extractImportPaths for a global using (#930)', () => {
      const code = 'global using Serilog.Parsing;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      expect(importExtractor.extractImportPaths(importNode)).toEqual([]);
    });

    it('should return null from processImportSymbols for a global using (#930)', () => {
      const code = 'global using Serilog.Parsing;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      expect(importExtractor.processImportSymbols(importNode)).toBeNull();
    });

    it('should return null for a global static using of a non-stdlib namespace (#930)', () => {
      const code = 'global using static MyLib.Utils;';
      const root = mustParse(code, 'csharp');
      const importNode = root.namedChild(0)!;
      expect(importExtractor.extractImportPath(importNode)).toBeNull();
    });

    it('should still extract a regular using in the same file as a global using (#930)', () => {
      const code = `global using Serilog.Parsing;
using Newtonsoft.Json;
`;
      const root = mustParse(code, 'csharp');
      const globalNode = root.namedChild(0)!;
      const regularNode = root.namedChild(1)!;
      expect(importExtractor.extractImportPath(globalNode)).toBeNull();
      expect(importExtractor.extractImportPath(regularNode)).toBe('Newtonsoft.Json');
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

    // Post-release audit of 0.72.0: `signature` dropped generic type
    // parameters and the base-type/interface list entirely, e.g.
    // `LogEventPropertyValueVisitor<TState, TResult>` and
    // `Logger : ILogger, ILogEventSink, IDisposable` both came back as just
    // `class Logger`/`class LogEventPropertyValueVisitor` — the single most
    // useful fact about a class for deciding whether it's the one you want.
    it('should include generic type parameters in a class signature', () => {
      const code = 'public class LogEventPropertyValueVisitor<TState, TResult> {}';
      const root = mustParse(code, 'csharp');
      const classNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(classNode, code);
      expect(symbol!.signature).toBe('class LogEventPropertyValueVisitor<TState, TResult>');
    });

    it('should include the base-type/interface list in a class signature', () => {
      const code = 'public class Logger : ILogger, ILogEventSink, IDisposable {}';
      const root = mustParse(code, 'csharp');
      const classNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(classNode, code);
      expect(symbol!.signature).toBe('class Logger : ILogger, ILogEventSink, IDisposable');
    });

    it('should exclude generic constraints (`where`) from a class signature', () => {
      const code = 'public class Constrained<T> : Base where T : class, new() {}';
      const root = mustParse(code, 'csharp');
      const classNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(classNode, code);
      expect(symbol!.signature).toBe('class Constrained<T> : Base');
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

    it('should include generic type parameters and base interfaces in an interface signature', () => {
      const code = 'public interface IFoo<T> : IBar<T>, IBaz {}';
      const root = mustParse(code, 'csharp');
      const ifaceNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(ifaceNode, code);
      expect(symbol!.signature).toBe('interface IFoo<T> : IBar<T>, IBaz');
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

    it('should include the base-interface list in a struct signature', () => {
      const code = 'public readonly struct Vec3 : IVec {}';
      const root = mustParse(code, 'csharp');
      const structNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(structNode, code);
      expect(symbol!.signature).toBe('struct Vec3 : IVec');
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

    it('should include the base-interface list in a record signature, including record struct', () => {
      const code = 'public record struct Point(int X, int Y) : IPoint;';
      const root = mustParse(code, 'csharp');
      const recordNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(recordNode, code);
      expect(symbol!.name).toBe('Point');
      expect(symbol!.signature).toBe('record Point : IPoint');
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

    it('should include the base (underlying integer) type in an enum signature', () => {
      const code = 'public enum Status : byte { A, B }';
      const root = mustParse(code, 'csharp');
      const enumNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(enumNode, code);
      expect(symbol!.signature).toBe('enum Status : byte');
    });

    // #949: a nested type declaration (class/interface/struct/record/enum
    // declared directly inside another type) previously reported
    // parentClass: undefined regardless of nesting — only the
    // method/property handlers accepted the parameter. These pin that every
    // type-declaration handler now carries it through, the same way it
    // already worked for methods.
    it('should attach the enclosing type as parentClass for a nested class_declaration', () => {
      const code = 'public class Outer { public class Inner {} }';
      const root = mustParse(code, 'csharp');
      const innerNode = findAllNodes(root, 'class_declaration')[1]!;
      const symbol = symbolExtractor.extractSymbol(innerNode, code, 'Outer');
      expect(symbol!.name).toBe('Inner');
      expect(symbol!.type).toBe('class');
      expect(symbol!.parentClass).toBe('Outer');
    });

    it('should attach the enclosing type as parentClass for a nested interface_declaration', () => {
      const code = 'public class Outer { public interface IInner {} }';
      const root = mustParse(code, 'csharp');
      const ifaceNode = findNode(root, 'interface_declaration')!;
      const symbol = symbolExtractor.extractSymbol(ifaceNode, code, 'Outer');
      expect(symbol!.parentClass).toBe('Outer');
    });

    it('should attach the enclosing type as parentClass for a nested struct/record/enum', () => {
      const structCode = 'public class Outer { public struct Inner {} }';
      const structSymbol = symbolExtractor.extractSymbol(
        findNode(mustParse(structCode, 'csharp'), 'struct_declaration')!,
        structCode,
        'Outer',
      );
      expect(structSymbol!.parentClass).toBe('Outer');

      const recordCode = 'public class Outer { public record Inner(string Name) {} }';
      const recordSymbol = symbolExtractor.extractSymbol(
        findNode(mustParse(recordCode, 'csharp'), 'record_declaration')!,
        recordCode,
        'Outer',
      );
      expect(recordSymbol!.parentClass).toBe('Outer');

      const enumCode = 'public class Outer { public enum Inner { A, B } }';
      const enumSymbol = symbolExtractor.extractSymbol(
        findNode(mustParse(enumCode, 'csharp'), 'enum_declaration')!,
        enumCode,
        'Outer',
      );
      expect(enumSymbol!.parentClass).toBe('Outer');
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

  describe('Property/Indexer Extraction (#871)', () => {
    it('should extract an accessor-list property ({ get; set; }) as a method-typed symbol', () => {
      const code = `public class Person {
    public string Name { get; set; }
}`;
      const root = mustParse(code, 'csharp');
      const propNode = findNode(root, 'property_declaration')!;
      const symbol = symbolExtractor.extractSymbol(propNode, code, 'Person');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Name');
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('Person');
      expect(symbol!.signature).toContain('string Name');
      expect(symbol!.signature).toContain('get;');
      expect(symbol!.signature).toContain('set;');
    });

    it('should extract an expression-bodied property (=> …) as a method-typed symbol, contract-only', () => {
      const code = `public class Features {
    public int Count => _features?.Count ?? 0;
}`;
      const root = mustParse(code, 'csharp');
      const propNode = findNode(root, 'property_declaration')!;
      const symbol = symbolExtractor.extractSymbol(propNode, code, 'Features');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Count');
      expect(symbol!.type).toBe('method');
      expect(symbol!.signature).toContain('int Count');
      expect(symbol!.signature).toContain('get;');
      // Contract-only: the getter's expression is excluded, same principle as a
      // method body being excluded from its signature.
      expect(symbol!.signature).not.toContain('_features');
    });

    it('should extract a static property as a method-typed symbol', () => {
      const code = `public class Config {
    public static string StaticProp { get; set; }
}`;
      const root = mustParse(code, 'csharp');
      const propNode = findNode(root, 'property_declaration')!;
      const symbol = symbolExtractor.extractSymbol(propNode, code, 'Config');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('StaticProp');
      expect(symbol!.type).toBe('method');
      expect(symbol!.signature).toContain('static string StaticProp');
    });

    it('should extract an interface property as a method-typed symbol', () => {
      const code = `public interface IRepository {
    string Name { get; set; }
}`;
      const root = mustParse(code, 'csharp');
      const propNode = findNode(root, 'property_declaration')!;
      const symbol = symbolExtractor.extractSymbol(propNode, code, 'IRepository');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Name');
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('IRepository');
    });

    it('should extract a get-only property as a method-typed symbol', () => {
      const code = `public class InitOnly {
    public int InitProp { get; init; }
}`;
      const root = mustParse(code, 'csharp');
      const propNode = findNode(root, 'property_declaration')!;
      const symbol = symbolExtractor.extractSymbol(propNode, code, 'InitOnly');
      expect(symbol).not.toBeNull();
      expect(symbol!.signature).toContain('get;');
      expect(symbol!.signature).toContain('init;');
    });

    it('should extract a multi-line accessor-list property as a method-typed symbol', () => {
      const code = `public class Wide {
    public int Multi
    {
        get { return _x; }
        set { _x = value; }
    }
}`;
      const root = mustParse(code, 'csharp');
      const propNode = findNode(root, 'property_declaration')!;
      const symbol = symbolExtractor.extractSymbol(propNode, code, 'Wide');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Multi');
      expect(symbol!.signature).toContain('int Multi');
      expect(symbol!.signature).toContain('get;');
      expect(symbol!.signature).toContain('set;');
      // Contract-only: accessor bodies are excluded.
      expect(symbol!.signature).not.toContain('_x');
    });

    it('should extract an indexer as a method-typed symbol named "this"', () => {
      const code = `public class Container {
    public int this[int index] { get { return 0; } set { } }
}`;
      const root = mustParse(code, 'csharp');
      const indexerNode = findNode(root, 'indexer_declaration')!;
      const symbol = symbolExtractor.extractSymbol(indexerNode, code, 'Container');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('this');
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('Container');
      expect(symbol!.signature).toContain('this[int index]');
      expect(symbol!.signature).toContain('get;');
      expect(symbol!.signature).toContain('set;');
    });

    it('should not treat record primary-constructor properties as property_declaration nodes', () => {
      // Documents a deliberate non-coverage boundary: record positional
      // properties (`record Person(string Name)`) are `parameter` nodes
      // inside the record's `parameter_list`, not `property_declaration` —
      // a different grammar shape, out of scope for #871.
      const code = `public record Person(string Name, int Age);`;
      const root = mustParse(code, 'csharp');
      const propNode = findNode(root, 'property_declaration');
      expect(propNode).toBeNull();
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

    // #949 end-to-end repro: a nested class (`public static class Builder`
    // inside `public class Retrofit`) previously reported parentClass: null,
    // making it indistinguishable from an unrelated same-named nested
    // `Builder` in a different file.
    it('should attach the enclosing class as parentClass for a nested class chunk', () => {
      const content = `public class Retrofit {
    public static class Builder {
        public Retrofit Build() { return null; }
    }
}`;

      const chunks = chunkByAST('Retrofit.cs', content);
      const builderChunk = chunks.find(c => c.metadata.symbolName === 'Builder');
      expect(builderChunk).toBeDefined();
      expect(builderChunk?.metadata.symbolType).toBe('class');
      expect(builderChunk?.metadata.parentClass).toBe('Retrofit');
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

    it('should chunk a property as a method-typed symbol, distinct from the class chunk (#871)', () => {
      const content = `public class Person {
    public string Name { get; set; }
    public int Age { get; set; }
}`;

      const chunks = chunkByAST('Person.cs', content);
      // class + 2 properties, each its own chunk.
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      const nameChunk = chunks.find(c => c.metadata.symbolName === 'Name');
      expect(nameChunk).toBeDefined();
      expect(nameChunk?.metadata.symbolType).toBe('method');
      expect(nameChunk?.metadata.parentClass).toBe('Person');

      const ageChunk = chunks.find(c => c.metadata.symbolName === 'Age');
      expect(ageChunk).toBeDefined();
      expect(ageChunk?.metadata.symbolType).toBe('method');
    });

    it('should chunk an expression-bodied property distinctly from an accessor-list one (#871)', () => {
      const content = `public class Features {
    private readonly List<string> _features;

    public int Count => _features?.Count ?? 0;
}`;

      const chunks = chunkByAST('Features.cs', content);
      const countChunk = chunks.find(c => c.metadata.symbolName === 'Count');
      expect(countChunk).toBeDefined();
      expect(countChunk?.metadata.symbolType).toBe('method');
      expect(countChunk?.metadata.parentClass).toBe('Features');
    });

    it('should chunk an indexer as a method-typed symbol (#871)', () => {
      const content = `public class Container {
    public int this[int index] { get { return 0; } set { } }
}`;

      const chunks = chunkByAST('Container.cs', content);
      const indexerChunk = chunks.find(
        c => c.metadata.symbolName === 'this' && c.metadata.symbolType === 'method',
      );
      expect(indexerChunk).toBeDefined();
      expect(indexerChunk?.metadata.parentClass).toBe('Container');
    });

    it('should NOT chunk record primary-constructor properties as separate symbols (#871, deliberate)', () => {
      const content = `public record Point(int X, int Y) {
    public double Distance() {
        return Math.Sqrt(X * X + Y * Y);
    }
}`;

      const chunks = chunkByAST('Point.cs', content);
      // Only the record itself and its one real method are chunked; X/Y have
      // no property_declaration chunk of their own (see the "should not treat
      // record primary-constructor properties..." symbol-extraction test).
      const propertyLikeChunks = chunks.filter(
        c =>
          c.metadata.symbolType === 'method' &&
          (c.metadata.symbolName === 'X' || c.metadata.symbolName === 'Y'),
      );
      expect(propertyLikeChunks).toEqual([]);
    });
  });

  describe('preprocessor directives (#970)', () => {
    it('extracts a declaration wholly inside #if ... #endif', () => {
      // The bug: the grammar wraps this in a `preproc_if`, which was not a
      // transparent node, so `findTopLevelNodes` never descended and the
      // class produced NO chunk and NO symbol. Measured on serilog/serilog:
      // 7 files collapsed to a single symbol-less whole-file chunk.
      const content = `namespace A;
#if NET8_0
class OnlyInIf { void M() {} }
#endif
`;
      const chunks = chunkByAST('OnlyInIf.cs', content);
      const symbols = chunks.map(c => c.metadata.symbolName).filter(Boolean);

      expect(symbols).toContain('OnlyInIf');
      expect(symbols).toContain('M');
    });

    it('extracts a MEMBER inside #if, not just a top-level declaration', () => {
      // Not in #970's write-up, which only documents whole declarations at
      // top level. `declaration_list > preproc_if > method_declaration` is
      // the same blindness for a conditionally compiled method, and that
      // shape is far more common in real C#.
      const content = `namespace A;
class Outer
{
    void Always() {}
#if FEATURE
    void OnlyWhenFeature() {}
#endif
}
`;
      const chunks = chunkByAST('Outer.cs', content);
      const symbols = chunks.map(c => c.metadata.symbolName).filter(Boolean);

      expect(symbols).toContain('Always');
      expect(symbols).toContain('OnlyWhenFeature');
    });

    it('takes only the #if branch of an #if/#else, never both', () => {
      // THE SAFETY PROPERTY. `preproc_else` NESTS inside `preproc_if`, so
      // making it transparent too would extract `Impl` twice -- two symbols
      // with the same name from one file. Duplicate symbols are fabrication,
      // and this repo has already paid for that once (#1056). Omission is
      // the cheaper error, so `preproc_else` is deliberately not traversed.
      const content = `namespace A;
#if NET8_0
class Impl { void Modern() {} }
#else
class Impl { void Legacy() {} }
#endif
`;
      const chunks = chunkByAST('Impl.cs', content);
      const symbols = chunks.map(c => c.metadata.symbolName).filter(Boolean);

      expect(symbols).toContain('Modern');
      expect(symbols).not.toContain('Legacy');
      expect(symbols.filter(s => s === 'Impl')).toHaveLength(1);
    });

    it('takes only the first branch of an #if/#elif/#else chain', () => {
      // `preproc_else` nests inside `preproc_elif`, which nests inside
      // `preproc_if` -- so a naive fix triplicates here rather than merely
      // doubling.
      const content = `namespace A;
#if A
class T { void One() {} }
#elif B
class T { void Two() {} }
#else
class T { void Three() {} }
#endif
`;
      const chunks = chunkByAST('T.cs', content);
      const symbols = chunks.map(c => c.metadata.symbolName).filter(Boolean);

      expect(symbols).toContain('One');
      expect(symbols).not.toContain('Two');
      expect(symbols).not.toContain('Three');
      expect(symbols.filter(s => s === 'T')).toHaveLength(1);
    });

    it('leaves a file with no preprocessor directives unchanged', () => {
      // Regression guard: the fix must not alter the ordinary path.
      const content = `namespace A;
class Plain { void One() {} void Two() {} }
`;
      const chunks = chunkByAST('Plain.cs', content);
      const symbols = chunks.map(c => c.metadata.symbolName).filter(Boolean);

      expect(symbols).toEqual(['Plain', 'One', 'Two']);
    });

    it('does not need #region handling — those nodes are siblings, not parents', () => {
      // Verified against the grammar: `preproc_region`/`preproc_endregion`
      // sit BESIDE the declarations they visually wrap, so they never hid
      // anything. Pinned so nobody "fixes" it by adding them to the
      // transparent set and reintroducing branch-duplication risk for no
      // gain.
      expect(traverser.shouldTraverseChildren({ type: 'preproc_region' } as SyntaxNode)).toBe(
        false,
      );
      expect(traverser.shouldTraverseChildren({ type: 'preproc_endregion' } as SyntaxNode)).toBe(
        false,
      );

      const content = `namespace A;
#region Core
class InRegion { void M() {} }
#endregion
`;
      const symbols = chunkByAST('InRegion.cs', content)
        .map(c => c.metadata.symbolName)
        .filter(Boolean);
      expect(symbols).toContain('InRegion');
      expect(symbols).toContain('M');
    });

    it('treats preproc_if as transparent but not preproc_elif/preproc_else', () => {
      expect(traverser.shouldTraverseChildren({ type: 'preproc_if' } as SyntaxNode)).toBe(true);
      expect(traverser.shouldTraverseChildren({ type: 'preproc_elif' } as SyntaxNode)).toBe(false);
      expect(traverser.shouldTraverseChildren({ type: 'preproc_else' } as SyntaxNode)).toBe(false);
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

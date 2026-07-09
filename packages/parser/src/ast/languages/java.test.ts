import { describe, it, expect } from 'vitest';
import { mustParse } from '../test/helpers/parse-fixture.js';
import type { SyntaxNode } from '../types.js';
import { chunkByAST } from '../chunker.js';
import {
  JavaTraverser,
  JavaExportExtractor,
  JavaImportExtractor,
  JavaSymbolExtractor,
} from './java.js';

describe('Java Language', () => {
  const traverser = new JavaTraverser();
  const exportExtractor = new JavaExportExtractor();
  const importExtractor = new JavaImportExtractor();
  const symbolExtractor = new JavaSymbolExtractor();

  describe('Traverser', () => {
    it('should identify method_declaration and constructor_declaration as target nodes', () => {
      expect(traverser.targetNodeTypes).toContain('method_declaration');
      expect(traverser.targetNodeTypes).toContain('constructor_declaration');
    });

    it('should identify class/interface/enum/record as container types', () => {
      expect(traverser.containerTypes).toContain('class_declaration');
      expect(traverser.containerTypes).toContain('interface_declaration');
      expect(traverser.containerTypes).toContain('enum_declaration');
      expect(traverser.containerTypes).toContain('record_declaration');
    });

    it('should extract children from class declarations', () => {
      const code = 'public class Foo { public void bar() {} }';
      const root = mustParse(code, 'java');
      const classNode = root.namedChild(0)!;
      expect(traverser.shouldExtractChildren(classNode)).toBe(true);
    });

    it('should not extract children from method declarations', () => {
      const code = 'public class Foo { public void bar() {} }';
      const root = mustParse(code, 'java');
      const classNode = root.namedChild(0)!;
      const body = classNode.childForFieldName('body')!;
      const methodNode = body.namedChild(0)!;
      expect(traverser.shouldExtractChildren(methodNode)).toBe(false);
    });

    it('should get class body from class declaration', () => {
      const code = 'public class Foo { public void bar() {} }';
      const root = mustParse(code, 'java');
      const classNode = root.namedChild(0)!;
      const body = traverser.getContainerBody(classNode);
      expect(body).not.toBeNull();
      expect(body!.type).toBe('class_body');
    });

    it('should traverse program root', () => {
      const code = 'public class Foo {}';
      const root = mustParse(code, 'java');
      expect(traverser.shouldTraverseChildren(root)).toBe(true);
    });

    it('should not traverse non-root nodes', () => {
      const code = 'public class Foo { public void bar() {} }';
      const root = mustParse(code, 'java');
      const classNode = root.namedChild(0)!;
      expect(traverser.shouldTraverseChildren(classNode)).toBe(false);
    });

    it('should find parent container name for methods', () => {
      const code = 'public class Calculator { public int add(int a, int b) { return a + b; } }';
      const root = mustParse(code, 'java');
      const classNode = root.namedChild(0)!;
      const body = classNode.childForFieldName('body')!;
      const methodNode = body.namedChild(0)!;
      expect(traverser.findParentContainerName(methodNode)).toBe('Calculator');
    });

    it('should return undefined for top-level parent container name', () => {
      const code = 'public class Foo {}';
      const root = mustParse(code, 'java');
      const classNode = root.namedChild(0)!;
      expect(traverser.findParentContainerName(classNode)).toBeUndefined();
    });

    it('should detect lambda in local variable declaration', () => {
      const code =
        'public class Foo { void bar() { Runnable r = () -> System.out.println("hi"); } }';
      const root = mustParse(code, 'java');
      // Navigate to the local_variable_declaration inside the method body
      const localVarDecl = findNode(root, 'local_variable_declaration');
      if (localVarDecl) {
        expect(traverser.isDeclarationWithFunction(localVarDecl)).toBe(true);
        const result = traverser.findFunctionInDeclaration(localVarDecl);
        expect(result.hasFunction).toBe(true);
        expect(result.functionNode).not.toBeNull();
        expect(result.functionNode!.type).toBe('lambda_expression');
      }
    });

    it('should not detect function in non-lambda variable declaration', () => {
      const code = 'public class Foo { void bar() { int x = 42; } }';
      const root = mustParse(code, 'java');
      const localVarDecl = findNode(root, 'local_variable_declaration');
      if (localVarDecl) {
        expect(traverser.isDeclarationWithFunction(localVarDecl)).toBe(false);
      }
    });
  });

  describe('Export Extraction', () => {
    it('should extract public class', () => {
      const code = 'public class UserService {}';
      const root = mustParse(code, 'java');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('UserService');
    });

    it('should not export package-private class', () => {
      const code = 'class InternalHelper {}';
      const root = mustParse(code, 'java');
      const exports = exportExtractor.extractExports(root);
      expect(exports).not.toContain('InternalHelper');
    });

    it('should extract public methods from class', () => {
      const code = `public class UserService {
    public String getName() { return ""; }
    private void helper() {}
    void packagePrivate() {}
}`;
      const root = mustParse(code, 'java');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('UserService');
      expect(exports).toContain('getName');
      expect(exports).not.toContain('helper');
      expect(exports).not.toContain('packagePrivate');
    });

    it('should extract public interface', () => {
      const code = 'public interface Repository { void save(); }';
      const root = mustParse(code, 'java');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('Repository');
    });

    it('should treat interface methods as implicitly public', () => {
      const code = `public interface Repository {
    void save();
    void delete();
}`;
      const root = mustParse(code, 'java');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('save');
      expect(exports).toContain('delete');
    });

    it('should extract public enum', () => {
      const code = 'public enum Status { ACTIVE, INACTIVE }';
      const root = mustParse(code, 'java');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('Status');
    });

    it('should extract public static methods', () => {
      const code = `public class Utils {
    public static String format(String s) { return s; }
}`;
      const root = mustParse(code, 'java');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('Utils');
      expect(exports).toContain('format');
    });

    it('should extract mixed exported items', () => {
      const code = `public class App {
    public void run() {}
    private void init() {}
    public String status() { return "ok"; }
}`;
      const root = mustParse(code, 'java');
      const exports = exportExtractor.extractExports(root);
      expect(exports).toContain('App');
      expect(exports).toContain('run');
      expect(exports).toContain('status');
      expect(exports).not.toContain('init');
    });
  });

  describe('Import Extraction', () => {
    it('should identify import_declaration as import node type', () => {
      expect(importExtractor.importNodeTypes).toContain('import_declaration');
    });

    it('should return null for stdlib imports', () => {
      const code = 'import java.util.List;';
      const root = mustParse(code, 'java');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBeNull();
    });

    it('should return null for javax stdlib imports', () => {
      const code = 'import javax.swing.JFrame;';
      const root = mustParse(code, 'java');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBeNull();
    });

    it('should extract external import path', () => {
      const code = 'import com.google.common.collect.ImmutableList;';
      const root = mustParse(code, 'java');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBe('com.google.common.collect.ImmutableList');
    });

    it('should handle wildcard imports', () => {
      const code = 'import com.google.common.collect.*;';
      const root = mustParse(code, 'java');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBe('com.google.common.collect.*');
    });

    it('should handle static imports', () => {
      const code = 'import static com.google.common.base.Preconditions.checkNotNull;';
      const root = mustParse(code, 'java');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBe('com.google.common.base.Preconditions.checkNotNull');
    });

    it('should filter out static stdlib imports', () => {
      const code = 'import static java.lang.Math.PI;';
      const root = mustParse(code, 'java');
      const importNode = root.namedChild(0)!;
      const path = importExtractor.extractImportPath(importNode);
      expect(path).toBeNull();
    });

    it('should process import symbols for external packages', () => {
      const code = 'import com.google.common.collect.ImmutableList;';
      const root = mustParse(code, 'java');
      const importNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('com.google.common.collect.ImmutableList');
      expect(result!.symbols).toEqual(['ImmutableList']);
    });

    it('should process wildcard import symbols', () => {
      const code = 'import com.google.common.collect.*;';
      const root = mustParse(code, 'java');
      const importNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).not.toBeNull();
      expect(result!.importPath).toBe('com.google.common.collect');
      expect(result!.symbols).toEqual(['collect']);
    });

    it('should return null for stdlib import symbols', () => {
      const code = 'import java.util.List;';
      const root = mustParse(code, 'java');
      const importNode = root.namedChild(0)!;
      const result = importExtractor.processImportSymbols(importNode);
      expect(result).toBeNull();
    });
  });

  describe('Symbol Extraction', () => {
    it('should extract method_declaration info', () => {
      const code = `public class Foo {
    public String getName(String prefix, int id) { return prefix + id; }
}`;
      const root = mustParse(code, 'java');
      const methodNode = findNode(root, 'method_declaration')!;
      const symbol = symbolExtractor.extractSymbol(methodNode, code, 'Foo');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('getName');
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('Foo');
      expect(symbol!.signature).toContain('getName');
    });

    it('should extract constructor_declaration info', () => {
      const code = `public class User {
    public User(String name) { this.name = name; }
}`;
      const root = mustParse(code, 'java');
      const ctorNode = findNode(root, 'constructor_declaration')!;
      const symbol = symbolExtractor.extractSymbol(ctorNode, code, 'User');
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('User');
      expect(symbol!.type).toBe('method');
      expect(symbol!.parentClass).toBe('User');
    });

    it('should extract class_declaration info', () => {
      const code = 'public class Calculator {}';
      const root = mustParse(code, 'java');
      const classNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(classNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Calculator');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('class Calculator');
    });

    it('should extract interface_declaration info', () => {
      const code = 'public interface Repository {}';
      const root = mustParse(code, 'java');
      const ifaceNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(ifaceNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Repository');
      expect(symbol!.type).toBe('interface');
      expect(symbol!.signature).toBe('interface Repository');
    });

    it('should extract enum_declaration info', () => {
      const code = 'public enum Color { RED, GREEN, BLUE }';
      const root = mustParse(code, 'java');
      const enumNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(enumNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Color');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('enum Color');
    });

    it('should extract record_declaration info', () => {
      const code = 'public record Point(int x, int y) {}';
      const root = mustParse(code, 'java');
      const recordNode = root.namedChild(0)!;
      const symbol = symbolExtractor.extractSymbol(recordNode, code);
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('Point');
      expect(symbol!.type).toBe('class');
      expect(symbol!.signature).toBe('record Point');
    });

    it('should extract return type from method', () => {
      const code = `public class Foo {
    public String getName() { return ""; }
}`;
      const root = mustParse(code, 'java');
      const methodNode = findNode(root, 'method_declaration')!;
      const symbol = symbolExtractor.extractSymbol(methodNode, code, 'Foo');
      expect(symbol).not.toBeNull();
      expect(symbol!.returnType).toBe('String');
    });

    it('should handle void return type', () => {
      const code = `public class Foo {
    public void doWork() {}
}`;
      const root = mustParse(code, 'java');
      const methodNode = findNode(root, 'method_declaration')!;
      const symbol = symbolExtractor.extractSymbol(methodNode, code, 'Foo');
      expect(symbol).not.toBeNull();
      expect(symbol!.returnType).toBe('void');
    });

    it('should extract call site from direct method invocation', () => {
      const code = `public class Foo {
    void bar() { doSomething(); }
}`;
      const root = mustParse(code, 'java');
      const callNode = findNode(root, 'method_invocation');
      expect(callNode).not.toBeNull();
      const callSite = symbolExtractor.extractCallSite(callNode!);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('doSomething');
    });

    it('should extract call site from object method invocation', () => {
      const code = `public class Foo {
    void bar() { user.getName(); }
}`;
      const root = mustParse(code, 'java');
      const callNode = findNode(root, 'method_invocation');
      expect(callNode).not.toBeNull();
      const callSite = symbolExtractor.extractCallSite(callNode!);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('getName');
    });

    it('should extract call site from chained method invocation', () => {
      const code = `public class Foo {
    void bar() { list.stream().filter(x -> true).collect(null); }
}`;
      const root = mustParse(code, 'java');
      // Find the outermost method_invocation (collect)
      const callNodes = findAllNodes(root, 'method_invocation');
      expect(callNodes.length).toBeGreaterThanOrEqual(3);

      const symbols = callNodes.map(n => symbolExtractor.extractCallSite(n)!.symbol);
      expect(symbols).toContain('stream');
      expect(symbols).toContain('filter');
      expect(symbols).toContain('collect');
    });

    it('should extract call site from method reference', () => {
      const code = `public class Foo {
    void bar() { list.stream().map(String::valueOf).collect(null); }
}`;
      const root = mustParse(code, 'java');
      const refNodes = findAllNodes(root, 'method_reference');
      expect(refNodes.length).toBeGreaterThanOrEqual(1);
      const callSite = symbolExtractor.extractCallSite(refNodes[0]);
      expect(callSite).not.toBeNull();
      expect(callSite!.symbol).toBe('valueOf');
    });
  });

  describe('AST Chunking Integration', () => {
    it('should chunk Java methods', () => {
      const content = `public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }

    public int subtract(int a, int b) {
        return a - b;
    }
}`;

      const chunks = chunkByAST('Calculator.java', content);
      expect(chunks.length).toBeGreaterThanOrEqual(3); // class + 2 methods

      const addChunk = chunks.find(c => c.metadata.symbolName === 'add');
      expect(addChunk).toBeDefined();
      expect(addChunk?.metadata.symbolType).toBe('method');
      expect(addChunk?.metadata.parentClass).toBe('Calculator');

      const subChunk = chunks.find(c => c.metadata.symbolName === 'subtract');
      expect(subChunk).toBeDefined();
      expect(subChunk?.metadata.symbolType).toBe('method');
      expect(subChunk?.metadata.parentClass).toBe('Calculator');
    });

    it('should chunk Java constructors with parentClass', () => {
      const content = `public class User {
    private String name;

    public User(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }
}`;

      const chunks = chunkByAST('User.java', content);
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      const ctorChunk = chunks.find(
        c => c.metadata.symbolName === 'User' && c.metadata.symbolType === 'method',
      );
      expect(ctorChunk).toBeDefined();
      expect(ctorChunk?.metadata.parentClass).toBe('User');
    });

    it('should chunk Java interfaces', () => {
      const content = `public interface Drawable {
    void draw();
    double area();
}`;

      const chunks = chunkByAST('Drawable.java', content);
      const ifaceChunk = chunks.find(c => c.metadata.symbolName === 'Drawable');
      expect(ifaceChunk).toBeDefined();
      expect(ifaceChunk?.metadata.symbolType).toBe('interface');
    });

    it('should extract exports based on public modifier', () => {
      const content = `public class Service {
    public void start() {}
    private void stop() {}
}`;

      const chunks = chunkByAST('Service.java', content);
      const serviceChunk = chunks.find(
        c => c.metadata.symbolName === 'Service' && c.metadata.symbolType === 'class',
      );
      expect(serviceChunk).toBeDefined();
      expect(serviceChunk?.metadata.exports).toContain('Service');
      expect(serviceChunk?.metadata.exports).toContain('start');
      expect(serviceChunk?.metadata.exports).not.toContain('stop');
    });

    it('should calculate complexity for Java methods', () => {
      const content = `public class Classifier {
    public String classify(int x) {
        if (x > 0) {
            return "positive";
        } else if (x < 0) {
            return "negative";
        } else {
            return "zero";
        }
    }
}`;

      const chunks = chunkByAST('Classifier.java', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'classify');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeGreaterThanOrEqual(2);
    });

    it('should handle Java for loops', () => {
      const content = `public class MathUtils {
    public int sumRange(int n) {
        int total = 0;
        for (int i = 0; i < n; i++) {
            total += i;
        }
        return total;
    }
}`;

      const chunks = chunkByAST('MathUtils.java', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'sumRange');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.complexity).toBeGreaterThanOrEqual(1);
    });

    it('should extract function parameters', () => {
      const content = `public class Greeter {
    public String greet(String name, int age) {
        return name;
    }
}`;

      const chunks = chunkByAST('Greeter.java', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'greet');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.parameters).toBeDefined();
      expect(funcChunk?.metadata.parameters?.length).toBe(2);
    });

    it('should handle Java imports in metadata', () => {
      const content = `import com.google.common.collect.ImmutableList;

public class App {
    public void run() {
        ImmutableList.of();
    }
}`;

      const chunks = chunkByAST('App.java', content);
      const funcChunk = chunks.find(c => c.metadata.symbolName === 'run');
      expect(funcChunk).toBeDefined();
      expect(funcChunk?.metadata.imports).toBeDefined();
      expect(funcChunk?.metadata.imports?.length).toBeGreaterThan(0);
    });

    it('should chunk enums', () => {
      const content = `public enum Status {
    ACTIVE,
    INACTIVE;

    public boolean isActive() {
        return this == ACTIVE;
    }
}`;

      const chunks = chunkByAST('Status.java', content);
      const enumChunk = chunks.find(
        c => c.metadata.symbolName === 'Status' && c.metadata.symbolType === 'class',
      );
      expect(enumChunk).toBeDefined();
    });

    it('should chunk records and their methods', () => {
      const content = `public record Point(int x, int y) {
    public double distance() {
        return Math.sqrt(x * x + y * y);
    }
}`;

      const chunks = chunkByAST('Point.java', content);
      const recordChunk = chunks.find(
        c => c.metadata.symbolName === 'Point' && c.metadata.symbolType === 'class',
      );
      expect(recordChunk).toBeDefined();

      // Record bodies use class_body in tree-sitter-java, so methods are extracted
      const distanceChunk = chunks.find(c => c.metadata.symbolName === 'distance');
      expect(distanceChunk).toBeDefined();
      expect(distanceChunk?.metadata.symbolType).toBe('method');
      expect(distanceChunk?.metadata.parentClass).toBe('Point');
    });
  });
});

/** Helper to recursively find a node of a given type */
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

import CSharp from 'tree-sitter-c-sharp';
import type Parser from 'tree-sitter';
import type { SymbolInfo } from '../types.js';
import type { LanguageDefinition } from './types.js';
import type { LanguageTraverser, DeclarationFunctionInfo } from '../traversers/types.js';
import type {
  LanguageExportExtractor,
  LanguageImportExtractor,
  LanguageSymbolExtractor,
} from '../extractors/types.js';
import { extractSignature, extractParameters } from '../extractors/symbol-helpers.js';
import { calculateComplexity } from '../complexity/index.js';

// =============================================================================
// TRAVERSER
// =============================================================================

/**
 * C# AST traverser
 *
 * C# has a class-based container structure similar to Java, with methods
 * inside class, interface, struct, record, and enum declarations. Unlike Java,
 * C# has namespaces that can nest declarations, and uses `declaration_list`
 * as the unified body node type for all containers.
 *
 * Lambda expressions can appear in variable declarations:
 *   Action a = () => { ... };
 */
export class CSharpTraverser implements LanguageTraverser {
  targetNodeTypes = ['method_declaration', 'constructor_declaration'];

  containerTypes = [
    'class_declaration',
    'interface_declaration',
    'struct_declaration',
    'record_declaration',
    'enum_declaration',
  ];

  declarationTypes = ['local_declaration_statement'];

  functionTypes = ['lambda_expression'];

  shouldExtractChildren(node: Parser.SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(node: Parser.SyntaxNode): boolean {
    if (node.type !== 'local_declaration_statement') return false;
    return findDescendant(node, 'lambda_expression') !== null;
  }

  getContainerBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (this.containerTypes.includes(node.type)) {
      return node.childForFieldName('body');
    }
    return null;
  }

  shouldTraverseChildren(node: Parser.SyntaxNode): boolean {
    return (
      node.type === 'compilation_unit' ||
      node.type === 'declaration_list' ||
      node.type === 'namespace_declaration' ||
      node.type === 'file_scoped_namespace_declaration'
    );
  }

  findParentContainerName(node: Parser.SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (
        current.type === 'class_declaration' ||
        current.type === 'interface_declaration' ||
        current.type === 'struct_declaration' ||
        current.type === 'record_declaration' ||
        current.type === 'enum_declaration'
      ) {
        const nameNode = current.childForFieldName('name');
        return nameNode?.text;
      }
      current = current.parent;
    }
    return undefined;
  }

  findFunctionInDeclaration(node: Parser.SyntaxNode): DeclarationFunctionInfo {
    if (node.type !== 'local_declaration_statement') {
      return { hasFunction: false, functionNode: null };
    }
    const lambda = findDescendant(node, 'lambda_expression');
    return lambda
      ? { hasFunction: true, functionNode: lambda }
      : { hasFunction: false, functionNode: null };
  }
}

// =============================================================================
// EXPORT EXTRACTOR
// =============================================================================

/**
 * C# export extractor
 *
 * C# uses the `public` modifier for visibility — public declarations are
 * accessible outside the assembly. Unlike Java's `modifiers` wrapper node,
 * C# has individual `modifier` nodes as direct children of declarations.
 *
 * Exportable items:
 * - public class User {}
 * - public struct Point {}
 * - public interface IRepository {}
 * - public enum Status {}
 * - public record Person(string Name) {}
 * - public void Method() {}   (inside a class)
 * - Interface methods are implicitly public
 * - public string Name { get; set; }  (property)
 *
 * Internal (default access) declarations are NOT exported.
 */
export class CSharpExportExtractor implements LanguageExportExtractor {
  extractExports(rootNode: Parser.SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();

    const addExport = (name: string) => {
      if (name && !seen.has(name)) {
        seen.add(name);
        exports.push(name);
      }
    };

    this.walkDeclarations(rootNode, addExport);

    return exports;
  }

  private walkDeclarations(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
    node.namedChildren.forEach(child => {
      // Recurse into namespaces to find type declarations
      if (child.type === 'namespace_declaration') {
        const body = child.childForFieldName('body');
        if (body) this.walkDeclarations(body, addExport);
        return;
      }

      // File-scoped namespaces: declarations are children of the namespace node
      if (child.type === 'file_scoped_namespace_declaration') {
        this.walkDeclarations(child, addExport);
        return;
      }

      this.extractFromNode(child, addExport);
    });
  }

  private extractFromNode(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
    switch (node.type) {
      case 'class_declaration':
      case 'interface_declaration':
      case 'struct_declaration':
      case 'record_declaration':
      case 'enum_declaration': {
        if (hasPublicModifier(node)) {
          const nameNode = node.childForFieldName('name');
          if (nameNode) addExport(nameNode.text);
        }
        this.extractPublicMembers(node, addExport);
        break;
      }
    }
  }

  private extractPublicMembers(
    container: Parser.SyntaxNode,
    addExport: (name: string) => void,
  ): void {
    const body = container.childForFieldName('body');
    if (!body) return;

    const isInterface = container.type === 'interface_declaration';
    body.namedChildren.forEach(child => this.extractMemberExport(child, isInterface, addExport));
  }

  private extractMemberExport(
    member: Parser.SyntaxNode,
    isInterface: boolean,
    addExport: (name: string) => void,
  ): void {
    if (
      member.type === 'method_declaration' ||
      member.type === 'constructor_declaration' ||
      member.type === 'property_declaration'
    ) {
      if (isInterface || hasPublicModifier(member)) {
        const nameNode = member.childForFieldName('name');
        if (nameNode) addExport(nameNode.text);
      }
      return;
    }

    if (member.type === 'field_declaration' && hasPublicModifier(member)) {
      this.extractFieldNames(member, addExport);
    }
  }

  private extractFieldNames(fieldDecl: Parser.SyntaxNode, addExport: (name: string) => void): void {
    // C# field_declaration contains variable_declaration → variable_declarator(s)
    fieldDecl.namedChildren
      .filter(child => child.type === 'variable_declaration')
      .flatMap(varDecl => varDecl.namedChildren)
      .filter(declarator => declarator.type === 'variable_declarator')
      .forEach(declarator => {
        const nameNode = declarator.childForFieldName('name');
        if (nameNode) addExport(nameNode.text);
      });
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/**
 * Check if a C# import path is a standard library namespace.
 * Standard library namespaces start with System. or Microsoft.
 */
function isCSharpStdLib(importPath: string): boolean {
  return (
    importPath === 'System' ||
    importPath.startsWith('System.') ||
    importPath === 'Microsoft' ||
    importPath.startsWith('Microsoft.')
  );
}

/**
 * C# import extractor
 *
 * Handles all C# using patterns:
 * - using Newtonsoft.Json;             (regular using)
 * - using static MyLib.Utils;          (static using)
 * - using Json = Newtonsoft.Json;      (alias using)
 *
 * Standard library usings (System.*, Microsoft.*) are filtered out.
 */
export class CSharpImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['using_directive'];

  extractImportPath(node: Parser.SyntaxNode): string | null {
    const path = this.getImportPath(node);
    if (!path || isCSharpStdLib(path)) return null;
    return path;
  }

  processImportSymbols(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    const path = this.getImportPath(node);
    if (!path || isCSharpStdLib(path)) return null;

    // Check for alias using: using Json = Newtonsoft.Json;
    // In alias using, the alias identifier has the 'name' field
    const aliasNode = node.childForFieldName('name');
    if (aliasNode?.type === 'identifier') {
      return { importPath: path, symbols: [aliasNode.text] };
    }

    const parts = path.split('.');
    const lastPart = parts[parts.length - 1];
    return { importPath: path, symbols: [lastPart] };
  }

  private getImportPath(node: Parser.SyntaxNode): string | null {
    // qualified_name is always the import path when present
    const qualifiedName = node.namedChildren.find(c => c.type === 'qualified_name');
    if (qualifiedName) return qualifiedName.text;

    // For simple using (e.g., `using System;`), the identifier is the path
    // Skip the alias identifier (it has the 'name' field in alias using)
    const aliasNode = node.childForFieldName('name');
    const identifier = node.namedChildren.find(c => c.type === 'identifier' && c !== aliasNode);
    return identifier?.text ?? null;
  }
}

// =============================================================================
// SYMBOL EXTRACTOR
// =============================================================================

/**
 * C# symbol extractor
 *
 * Handles:
 * - method_declaration (public void Method() {})
 * - constructor_declaration (public MyClass() {})
 * - class_declaration (class MyClass {})
 * - interface_declaration (interface IMyInterface {})
 * - struct_declaration (struct MyStruct {})
 * - record_declaration (record MyRecord(int X) {})
 * - enum_declaration (enum MyEnum {})
 *
 * Call sites: invocation_expression (direct calls and obj.Method() calls)
 */
export class CSharpSymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = [
    'method_declaration',
    'constructor_declaration',
    'class_declaration',
    'interface_declaration',
    'struct_declaration',
    'record_declaration',
    'enum_declaration',
  ];

  extractSymbol(node: Parser.SyntaxNode, content: string, parentClass?: string): SymbolInfo | null {
    switch (node.type) {
      case 'method_declaration':
        return this.extractMethodInfo(node, content, parentClass);
      case 'constructor_declaration':
        return this.extractConstructorInfo(node, content, parentClass);
      case 'class_declaration':
        return this.extractClassInfo(node);
      case 'interface_declaration':
        return this.extractInterfaceInfo(node);
      case 'struct_declaration':
        return this.extractStructInfo(node);
      case 'record_declaration':
        return this.extractRecordInfo(node);
      case 'enum_declaration':
        return this.extractEnumInfo(node);
      default:
        return null;
    }
  }

  extractCallSite(node: Parser.SyntaxNode): { symbol: string; line: number; key: string } | null {
    if (node.type !== 'invocation_expression') return null;

    const funcNode = node.childForFieldName('function');
    if (!funcNode) return null;

    const line = node.startPosition.row + 1;

    // Direct call: DoSomething()
    if (funcNode.type === 'identifier') {
      return { symbol: funcNode.text, line, key: `${funcNode.text}:${line}` };
    }

    // Member access call: obj.DoSomething()
    if (funcNode.type === 'member_access_expression') {
      const nameNode = funcNode.childForFieldName('name');
      if (nameNode) {
        return { symbol: nameNode.text, line, key: `${nameNode.text}:${line}` };
      }
    }

    return null;
  }

  private extractMethodInfo(
    node: Parser.SyntaxNode,
    content: string,
    parentClass?: string,
  ): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: parentClass ? 'method' : 'function',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: extractSignature(node, content),
      parameters: extractParameters(node, content),
      returnType: extractCSharpReturnType(node),
      complexity: calculateComplexity(node),
    };
  }

  private extractConstructorInfo(
    node: Parser.SyntaxNode,
    content: string,
    parentClass?: string,
  ): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'method',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: extractSignature(node, content),
      parameters: extractParameters(node, content),
      complexity: calculateComplexity(node),
    };
  }

  private extractClassInfo(node: Parser.SyntaxNode): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: `class ${nameNode.text}`,
    };
  }

  private extractInterfaceInfo(node: Parser.SyntaxNode): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'interface',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: `interface ${nameNode.text}`,
    };
  }

  private extractStructInfo(node: Parser.SyntaxNode): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: `struct ${nameNode.text}`,
    };
  }

  private extractRecordInfo(node: Parser.SyntaxNode): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: `record ${nameNode.text}`,
    };
  }

  private extractEnumInfo(node: Parser.SyntaxNode): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: `enum ${nameNode.text}`,
    };
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Check if a node has a `public` modifier.
 * C# uses individual `modifier` nodes as direct children (not a `modifiers`
 * wrapper like Java). Iterates children for an exact `public` modifier.
 */
function hasPublicModifier(node: Parser.SyntaxNode): boolean {
  return node.children.some(child => child.type === 'modifier' && child.text === 'public');
}

/**
 * Extract return type from a C# method_declaration.
 * C# uses a 'returns' field instead of 'type'.
 */
function extractCSharpReturnType(node: Parser.SyntaxNode): string | undefined {
  if (node.type !== 'method_declaration') return undefined;
  const typeNode = node.childForFieldName('returns');
  if (!typeNode) return undefined;
  return typeNode.text;
}

/**
 * Find the first descendant of a specific type (breadth-first among children).
 */
function findDescendant(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (child.type === type) return child;
    const found = findDescendant(child, type);
    if (found) return found;
  }
  return null;
}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const csharpDefinition: LanguageDefinition = {
  id: 'csharp',
  extensions: ['cs'],
  grammar: CSharp,
  traverser: new CSharpTraverser(),
  exportExtractor: new CSharpExportExtractor(),
  importExtractor: new CSharpImportExtractor(),
  symbolExtractor: new CSharpSymbolExtractor(),

  complexity: {
    decisionPoints: [
      'if_statement',
      'while_statement',
      'for_statement',
      'foreach_statement',
      'do_statement',
      'catch_clause',
      'conditional_expression',
      'binary_expression',
      'switch_section',
      'switch_expression_arm',
    ],
    nestingTypes: [
      'if_statement',
      'while_statement',
      'for_statement',
      'foreach_statement',
      'do_statement',
      'switch_expression',
      'catch_clause',
      'lambda_expression',
    ],
    nonNestingTypes: ['switch_section', 'switch_expression_arm', 'conditional_expression'],
    lambdaTypes: ['lambda_expression'],
    operatorSymbols: new Set([
      '+',
      '-',
      '*',
      '/',
      '%',
      '==',
      '!=',
      '<',
      '>',
      '<=',
      '>=',
      '=',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
      '&=',
      '|=',
      '^=',
      '<<=',
      '>>=',
      '&&',
      '||',
      '!',
      '&',
      '|',
      '^',
      '~',
      '<<',
      '>>',
      '.',
      '?',
      ':',
      '=>',
      '??',
      '??=',
      '?.',
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
    ]),
    operatorKeywords: new Set([
      'if',
      'else',
      'for',
      'foreach',
      'while',
      'do',
      'switch',
      'case',
      'default',
      'return',
      'throw',
      'try',
      'catch',
      'finally',
      'new',
      'is',
      'as',
      'typeof',
      'sizeof',
      'nameof',
      'break',
      'continue',
      'class',
      'struct',
      'interface',
      'enum',
      'record',
      'namespace',
      'using',
      'public',
      'private',
      'protected',
      'internal',
      'static',
      'readonly',
      'const',
      'abstract',
      'virtual',
      'override',
      'sealed',
      'void',
      'base',
      'this',
      'var',
      'async',
      'await',
      'yield',
      'in',
      'out',
      'ref',
      'params',
      'delegate',
      'event',
      'where',
      'lock',
      'checked',
      'unchecked',
    ]),
  },

  symbols: {
    callExpressionTypes: ['invocation_expression'],
  },
};

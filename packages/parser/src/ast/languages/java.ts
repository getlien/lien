import Java from 'tree-sitter-java';
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
 * Java AST traverser
 *
 * Java has a class-based container structure — methods live inside class,
 * interface, enum, and record declarations. Unlike Go's flat structure,
 * Java requires container traversal to find methods.
 *
 * Lambda expressions can appear in variable declarations:
 *   Runnable r = () -> { ... };
 */
export class JavaTraverser implements LanguageTraverser {
  targetNodeTypes = ['method_declaration', 'constructor_declaration'];

  containerTypes = [
    'class_declaration',
    'interface_declaration',
    'enum_declaration',
    'record_declaration',
  ];

  declarationTypes = ['local_variable_declaration'];

  functionTypes = ['lambda_expression'];

  shouldExtractChildren(node: Parser.SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(node: Parser.SyntaxNode): boolean {
    if (node.type !== 'local_variable_declaration') return false;
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
      node.type === 'program' ||
      node.type === 'class_body' ||
      node.type === 'interface_body' ||
      node.type === 'enum_body'
    );
  }

  findParentContainerName(node: Parser.SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (
        current.type === 'class_declaration' ||
        current.type === 'interface_declaration' ||
        current.type === 'enum_declaration' ||
        current.type === 'record_declaration'
      ) {
        const nameNode = current.childForFieldName('name');
        return nameNode?.text;
      }
      current = current.parent;
    }
    return undefined;
  }

  findFunctionInDeclaration(node: Parser.SyntaxNode): DeclarationFunctionInfo {
    if (node.type !== 'local_variable_declaration') {
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
 * Java export extractor
 *
 * Java uses the `public` modifier for visibility — public declarations are
 * accessible outside the package (similar to Rust's `pub`).
 *
 * Exportable items:
 * - public class User {}
 * - public interface Repository {}
 * - public enum Status {}
 * - public record Point(int x, int y) {}
 * - public void method() {}   (inside a class)
 * - Interface methods are implicitly public
 *
 * Package-private (default access) declarations are NOT exported.
 */
export class JavaExportExtractor implements LanguageExportExtractor {
  extractExports(rootNode: Parser.SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();

    const addExport = (name: string) => {
      if (name && !seen.has(name)) {
        seen.add(name);
        exports.push(name);
      }
    };

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i);
      if (!child) continue;
      this.extractFromNode(child, addExport);
    }

    return exports;
  }

  private extractFromNode(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
    switch (node.type) {
      case 'class_declaration':
      case 'interface_declaration':
      case 'enum_declaration':
      case 'record_declaration': {
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

    for (let i = 0; i < body.namedChildCount; i++) {
      const child = body.namedChild(i);
      if (!child) continue;
      this.extractMemberExport(child, isInterface, addExport);
    }
  }

  private extractMemberExport(
    member: Parser.SyntaxNode,
    isInterface: boolean,
    addExport: (name: string) => void,
  ): void {
    if (member.type === 'method_declaration' || member.type === 'constructor_declaration') {
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
    for (let i = 0; i < fieldDecl.namedChildCount; i++) {
      const child = fieldDecl.namedChild(i);
      if (child?.type === 'variable_declarator') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) addExport(nameNode.text);
      }
    }
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/**
 * Check if a Java import path is a standard library package.
 * Standard library packages start with java. or javax.
 */
function isJavaStdLib(importPath: string): boolean {
  return importPath.startsWith('java.') || importPath.startsWith('javax.');
}

/**
 * Java import extractor
 *
 * Handles all Java import patterns:
 * - import com.example.MyClass;              (single import)
 * - import com.example.*;                    (wildcard import)
 * - import static com.example.Utils.method;  (static import)
 * - import static com.example.Utils.*;       (static wildcard import)
 *
 * Standard library imports (java.*, javax.*) are filtered out.
 */
export class JavaImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['import_declaration'];

  extractImportPath(node: Parser.SyntaxNode): string | null {
    const path = this.getImportPath(node);
    if (!path || isJavaStdLib(path)) return null;
    return path;
  }

  processImportSymbols(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    const path = this.getImportPath(node);
    if (!path || isJavaStdLib(path)) return null;

    const parts = path.split('.');
    const lastPart = parts[parts.length - 1];

    // For wildcard imports, use the package name as the symbol
    if (lastPart === '*') {
      const packagePath = parts.slice(0, -1).join('.');
      const packageName = parts[parts.length - 2];
      return { importPath: packagePath, symbols: [packageName] };
    }

    return { importPath: path, symbols: [lastPart] };
  }

  private getImportPath(node: Parser.SyntaxNode): string | null {
    // Find the scoped_identifier or identifier child (import path)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;

      if (child.type === 'scoped_identifier' || child.type === 'identifier') {
        const hasWildcard = hasChildOfType(node, 'asterisk');
        return hasWildcard ? `${child.text}.*` : child.text;
      }
    }
    return null;
  }
}

// =============================================================================
// SYMBOL EXTRACTOR
// =============================================================================

/**
 * Java symbol extractor
 *
 * Handles:
 * - method_declaration (public void method() {})
 * - constructor_declaration (public MyClass() {})
 * - class_declaration (class MyClass {})
 * - interface_declaration (interface MyInterface {})
 * - enum_declaration (enum MyEnum {})
 * - record_declaration (record MyRecord(int x) {})
 *
 * Call sites: method_invocation (direct calls and object.method() calls)
 */
export class JavaSymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = [
    'method_declaration',
    'constructor_declaration',
    'class_declaration',
    'interface_declaration',
    'enum_declaration',
    'record_declaration',
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
      case 'enum_declaration':
        return this.extractEnumInfo(node);
      case 'record_declaration':
        return this.extractRecordInfo(node);
      default:
        return null;
    }
  }

  extractCallSite(node: Parser.SyntaxNode): { symbol: string; line: number; key: string } | null {
    const line = node.startPosition.row + 1;

    // method_invocation: foo() or obj.foo()
    if (node.type === 'method_invocation') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return null;
      return { symbol: nameNode.text, line, key: `${nameNode.text}:${line}` };
    }

    // method_reference: String::valueOf — no field names, last named child is the method identifier
    if (node.type === 'method_reference') {
      const lastChild = node.namedChild(node.namedChildCount - 1);
      if (lastChild?.type === 'identifier') {
        return { symbol: lastChild.text, line, key: `${lastChild.text}:${line}` };
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
      returnType: extractJavaReturnType(node),
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
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Check if a node has a `public` modifier.
 * Iterates the modifiers node's children for an exact `public` token
 * to avoid false positives from substring matching.
 */
function hasPublicModifier(node: Parser.SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'modifiers') {
      for (let j = 0; j < child.childCount; j++) {
        if (child.child(j)?.type === 'public') return true;
      }
      return false;
    }
  }
  return false;
}

/**
 * Extract return type from a Java method_declaration.
 * Java uses a 'type' field instead of 'return_type'.
 */
function extractJavaReturnType(node: Parser.SyntaxNode): string | undefined {
  if (node.type !== 'method_declaration') return undefined;
  const typeNode = node.childForFieldName('type');
  if (!typeNode) return undefined;
  return typeNode.text;
}

/**
 * Find the first descendant of a specific type (breadth-first among children).
 */
function findDescendant(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    if (child.type === type) return child;
    const found = findDescendant(child, type);
    if (found) return found;
  }
  return null;
}

/**
 * Check if a node has a child of a specific type (including unnamed children).
 */
function hasChildOfType(node: Parser.SyntaxNode, type: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)?.type === type) return true;
  }
  return false;
}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const javaDefinition: LanguageDefinition = {
  id: 'java',
  extensions: ['java'],
  grammar: Java,
  traverser: new JavaTraverser(),
  exportExtractor: new JavaExportExtractor(),
  importExtractor: new JavaImportExtractor(),
  symbolExtractor: new JavaSymbolExtractor(),

  complexity: {
    decisionPoints: [
      'if_statement',
      'while_statement',
      'for_statement',
      'enhanced_for_statement',
      'do_statement',
      'catch_clause',
      'ternary_expression',
      'binary_expression',
      'switch_block_statement_group',
      'switch_rule',
    ],
    nestingTypes: [
      'if_statement',
      'while_statement',
      'for_statement',
      'enhanced_for_statement',
      'do_statement',
      'switch_expression',
      'catch_clause',
      'lambda_expression',
    ],
    nonNestingTypes: ['switch_block_statement_group', 'switch_rule', 'ternary_expression'],
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
      '>>>=',
      '&&',
      '||',
      '!',
      '&',
      '|',
      '^',
      '~',
      '<<',
      '>>',
      '>>>',
      '.',
      '?',
      ':',
      '::',
      '->',
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
      'instanceof',
      'break',
      'continue',
      'class',
      'extends',
      'implements',
      'interface',
      'enum',
      'record',
      'import',
      'package',
      'public',
      'private',
      'protected',
      'static',
      'final',
      'abstract',
      'synchronized',
      'volatile',
      'transient',
      'native',
      'void',
      'super',
      'this',
      'assert',
      'yield',
      'var',
    ]),
  },

  symbols: {
    callExpressionTypes: ['method_invocation', 'method_reference'],
  },
};

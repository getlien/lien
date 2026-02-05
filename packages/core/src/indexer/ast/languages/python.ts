import Python from 'tree-sitter-python';
import type Parser from 'tree-sitter';
import type { SymbolInfo } from '../types.js';
import type { LanguageDefinition } from './types.js';
import type { LanguageTraverser, DeclarationFunctionInfo } from '../traversers/types.js';
import type { LanguageExportExtractor, LanguageImportExtractor, LanguageSymbolExtractor } from '../extractors/types.js';
import { extractSignature, extractParameters } from '../extractors/symbol-helpers.js';
import { calculateComplexity } from '../complexity/index.js';

// =============================================================================
// TRAVERSER
// =============================================================================

/**
 * Python AST traverser
 *
 * Handles Python AST node types and traversal patterns.
 * Python has a simpler structure than TypeScript/JavaScript:
 * - Functions are defined with 'def' or 'async def'
 * - No variable declarations with functions (unlike JS const x = () => {})
 * - Classes contain methods (which are just functions)
 */
export class PythonTraverser implements LanguageTraverser {
  targetNodeTypes = [
    'function_definition',
    'async_function_definition',
  ];

  containerTypes = [
    'class_definition',  // We extract methods, not the class itself
  ];

  declarationTypes: string[] = [];

  functionTypes = [
    'function_definition',
    'async_function_definition',
  ];

  shouldExtractChildren(node: Parser.SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(_node: Parser.SyntaxNode): boolean {
    return false;
  }

  getContainerBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (node.type === 'class_definition') {
      return node.childForFieldName('body');
    }
    return null;
  }

  shouldTraverseChildren(node: Parser.SyntaxNode): boolean {
    return node.type === 'module' ||
           node.type === 'block';
  }

  findParentContainerName(node: Parser.SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_definition') {
        const nameNode = current.childForFieldName('name');
        return nameNode?.text;
      }
      current = current.parent;
    }
    return undefined;
  }

  findFunctionInDeclaration(_node: Parser.SyntaxNode): DeclarationFunctionInfo {
    return {
      hasFunction: false,
      functionNode: null,
    };
  }
}

// =============================================================================
// EXPORT EXTRACTOR
// =============================================================================

/**
 * Python export extractor
 *
 * Python doesn't have explicit export syntax. All module-level (top-level)
 * declarations are considered exported (importable by other modules):
 * - Classes: class User: ...
 * - Functions: def helper(): ...
 * - Async functions: async def fetch_data(): ...
 */
export class PythonExportExtractor implements LanguageExportExtractor {
  private readonly exportableTypes = new Set([
    'class_definition',
    'function_definition',
    'async_function_definition',
  ]);

  private extractExportName(node: Parser.SyntaxNode): string | null {
    if (node.type === 'decorated_definition') {
      const definition = node.childForFieldName('definition');
      if (definition && this.exportableTypes.has(definition.type)) {
        return definition.childForFieldName('name')?.text ?? null;
      }
      return null;
    }

    if (this.exportableTypes.has(node.type)) {
      return node.childForFieldName('name')?.text ?? null;
    }

    return null;
  }

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

      const name = this.extractExportName(child);
      if (name) {
        addExport(name);
        continue;
      }

      // Re-exports via `from .module import Symbol`
      if (child.type === 'import_from_statement') {
        this.extractReExportNames(child, addExport);
      }
    }

    return exports;
  }

  private findModulePathIndex(node: Parser.SyntaxNode): number {
    for (let i = 0; i < node.namedChildCount; i++) {
      const type = node.namedChild(i)?.type;
      if (type === 'relative_import' || type === 'dotted_name') {
        return i;
      }
    }
    return -1;
  }

  private extractReExportNames(
    node: Parser.SyntaxNode,
    addExport: (name: string) => void
  ): void {
    const startIndex = this.findModulePathIndex(node);

    for (let i = startIndex + 1; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;

      if (child.type === 'dotted_name') {
        addExport(child.text);
      } else if (child.type === 'aliased_import') {
        this.extractAliasedImportName(child, addExport);
      }
    }
  }

  private extractAliasedImportName(
    node: Parser.SyntaxNode,
    addExport: (name: string) => void
  ): void {
    const identifiers = node.namedChildren.filter(c => c.type === 'identifier');
    const dottedName = node.namedChildren.find(c => c.type === 'dotted_name');

    const hasAlias = identifiers.length >= 2;
    const aliasName = hasAlias ? identifiers[identifiers.length - 1].text : identifiers[0]?.text;
    const defaultName = dottedName?.text;

    const name = aliasName ?? defaultName;
    if (name) addExport(name);
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/**
 * Python import extractor
 *
 * Handles:
 * - import os
 * - import os as system
 * - from utils.validate import validateEmail, validatePhone
 * - from typing import Optional as Opt
 */
export class PythonImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['import_statement', 'import_from_statement'];

  extractImportPath(node: Parser.SyntaxNode): string | null {
    // Return the raw text for Python imports (used in the imports list)
    return node.text.split('\n')[0];
  }

  processImportSymbols(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    if (node.type === 'import_statement') {
      return this.processPythonImport(node);
    }
    if (node.type === 'import_from_statement') {
      return this.processPythonFromImport(node);
    }
    return null;
  }

  private processSimpleImport(child: Parser.SyntaxNode): { importPath: string; symbols: string[] } {
    return {
      importPath: child.text,
      symbols: [child.text],
    };
  }

  private processAliasedImport(child: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    const dottedName = child.namedChildren.find(c => c.type === 'dotted_name');
    const identifiers = child.namedChildren.filter(c => c.type === 'identifier');

    const moduleName = dottedName?.text || identifiers[0]?.text;
    const aliasName = identifiers.length >= 2
      ? identifiers[identifiers.length - 1]?.text
      : identifiers[0]?.text;

    if (!moduleName || !aliasName) return null;
    return { importPath: moduleName, symbols: [aliasName] };
  }

  /**
   * Process Python regular import statement.
   * e.g., "import os", "import os as system"
   */
  private processPythonImport(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;

      if (child.type === 'dotted_name' || child.type === 'identifier') {
        return this.processSimpleImport(child);
      }
      if (child.type === 'aliased_import') {
        return this.processAliasedImport(child);
      }
    }
    return null;
  }

  private findModulePath(node: Parser.SyntaxNode): { path: string; startIndex: number } | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'dotted_name') {
        return { path: child.text, startIndex: i };
      }
    }
    return null;
  }

  private collectImportedSymbols(node: Parser.SyntaxNode, startIndex: number): string[] {
    const symbols: string[] = [];
    for (let i = startIndex + 1; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;

      if (child.type === 'dotted_name') {
        symbols.push(child.text);
      } else if (child.type === 'aliased_import') {
        const symbolName = this.extractPythonAliasedSymbol(child);
        if (symbolName) symbols.push(symbolName);
      }
    }
    return symbols;
  }

  /**
   * Process Python from...import statement.
   * e.g., "from utils.validate import validateEmail, validatePhone"
   */
  private processPythonFromImport(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    const moduleInfo = this.findModulePath(node);
    if (!moduleInfo) return null;

    const symbols = this.collectImportedSymbols(node, moduleInfo.startIndex);
    if (symbols.length === 0) return null;

    return { importPath: moduleInfo.path, symbols };
  }

  /**
   * Extract the aliased symbol from a Python aliased_import node.
   */
  private extractPythonAliasedSymbol(node: Parser.SyntaxNode): string | undefined {
    const identifierChildren = node.namedChildren.filter(c => c.type === 'identifier');
    const dottedName = node.namedChildren.find(c => c.type === 'dotted_name');

    if (identifierChildren.length >= 2) {
      return identifierChildren[identifierChildren.length - 1].text;
    }

    return identifierChildren[0]?.text ?? dottedName?.text;
  }
}

// =============================================================================
// SYMBOL EXTRACTOR
// =============================================================================

/**
 * Python symbol extractor
 *
 * Handles:
 * - function_definition (def foo():)
 * - async_function_definition (async def foo():)
 * - class_definition (class Foo:)
 *
 * Call sites: call (foo(), obj.method())
 */
export class PythonSymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = [
    'function_definition',
    'async_function_definition',
    'class_definition',
  ];

  extractSymbol(
    node: Parser.SyntaxNode,
    content: string,
    parentClass?: string
  ): SymbolInfo | null {
    switch (node.type) {
      case 'function_definition':
      case 'async_function_definition':
        return this.extractFunctionInfo(node, content, parentClass);
      case 'class_definition':
        return this.extractClassInfo(node);
      default:
        return null;
    }
  }

  extractCallSite(
    node: Parser.SyntaxNode
  ): { symbol: string; line: number; key: string } | null {
    if (node.type !== 'call') return null;

    const line = node.startPosition.row + 1;
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return null;

    // Direct function call: foo()
    if (funcNode.type === 'identifier') {
      return { symbol: funcNode.text, line, key: `${funcNode.text}:${line}` };
    }

    // Attribute access: obj.method() - extract 'method'
    if (funcNode.type === 'attribute') {
      const attrNode = funcNode.childForFieldName('attribute');
      if (attrNode?.type === 'identifier') {
        return { symbol: attrNode.text, line, key: `${attrNode.text}:${line}` };
      }
    }

    return null;
  }

  private extractFunctionInfo(
    node: Parser.SyntaxNode,
    content: string,
    parentClass?: string
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
}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const pythonDefinition: LanguageDefinition = {
  id: 'python',
  extensions: ['py'],
  grammar: Python,
  traverser: new PythonTraverser(),
  exportExtractor: new PythonExportExtractor(),
  importExtractor: new PythonImportExtractor(),
  symbolExtractor: new PythonSymbolExtractor(),

  complexity: {
    decisionPoints: [
      'if_statement', 'while_statement', 'for_statement', 'switch_case',
      'catch_clause', 'ternary_expression', 'binary_expression',
      'elif_clause', 'except_clause', 'conditional_expression',
    ],
    nestingTypes: [
      'if_statement', 'for_statement', 'while_statement',
      'except_clause',
    ],
    nonNestingTypes: [
      'elif_clause', 'conditional_expression',
    ],
    lambdaTypes: [
      'lambda',
    ],
    operatorSymbols: new Set([
      '+', '-', '*', '/', '%', '**', '//',
      '==', '!=', '<', '>', '<=', '>=',
      '=', '+=', '-=', '*=', '/=', '%=', '**=', '//=',
      '&=', '|=', '^=', '<<=', '>>=',
      '&', '|', '^', '~', '<<', '>>',
      '.', ':', '->', '@',
      '(', ')', '[', ']', '{', '}',
    ]),
    operatorKeywords: new Set([
      'if', 'elif', 'else', 'for', 'while', 'match', 'case',
      'return', 'raise', 'try', 'except', 'finally',
      'and', 'or', 'not', 'is', 'in',
      'await', 'yield', 'break', 'continue', 'pass',
      'def', 'class', 'lambda', 'async',
      'import', 'from', 'as', 'with',
      'global', 'nonlocal', 'del', 'assert',
    ]),
  },

  symbols: {
    callExpressionTypes: [
      'call',
    ],
  },
};

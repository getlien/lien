import Python from 'tree-sitter-python';
import type Parser from 'tree-sitter';
import type { LanguageDefinition } from './types.js';
import type { LanguageTraverser, DeclarationFunctionInfo } from '../traversers/types.js';
import type { LanguageExportExtractor, LanguageImportExtractor } from '../extractors/types.js';

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

      if (child.type === 'decorated_definition') {
        const definition = child.childForFieldName('definition');
        if (definition && this.exportableTypes.has(definition.type)) {
          const nameNode = definition.childForFieldName('name');
          if (nameNode) addExport(nameNode.text);
        }
        continue;
      }

      if (this.exportableTypes.has(child.type)) {
        const nameNode = child.childForFieldName('name');
        if (nameNode) addExport(nameNode.text);
      }
    }

    return exports;
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

  /**
   * Process Python regular import statement.
   * e.g., "import os", "import os as system"
   */
  private processPythonImport(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;

      if (child.type === 'dotted_name' || child.type === 'identifier') {
        const moduleName = child.text;
        return {
          importPath: moduleName,
          symbols: [moduleName],
        };
      } else if (child.type === 'aliased_import') {
        const dottedName = child.namedChildren.find(c => c.type === 'dotted_name');
        const identifiers = child.namedChildren.filter(c => c.type === 'identifier');

        const moduleName = dottedName?.text || identifiers[0]?.text;
        const aliasName = identifiers.length >= 2
          ? identifiers[identifiers.length - 1]?.text
          : identifiers[0]?.text;

        if (moduleName && aliasName) {
          return {
            importPath: moduleName,
            symbols: [aliasName],
          };
        }
      }
    }

    return null;
  }

  /**
   * Process Python from...import statement.
   * e.g., "from utils.validate import validateEmail, validatePhone"
   */
  private processPythonFromImport(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    let modulePath: string | null = null;
    const symbols: string[] = [];

    let foundModule = false;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;

      if (child.type === 'dotted_name' && !foundModule) {
        modulePath = child.text;
        foundModule = true;
      } else if (child.type === 'dotted_name' && foundModule) {
        symbols.push(child.text);
      } else if (child.type === 'aliased_import') {
        const symbolName = this.extractPythonAliasedSymbol(child);
        if (symbolName) {
          symbols.push(symbolName);
        }
      }
    }

    if (!modulePath || symbols.length === 0) return null;
    return { importPath: modulePath, symbols };
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
// LANGUAGE DEFINITION
// =============================================================================

export const pythonDefinition: LanguageDefinition = {
  id: 'python',
  extensions: ['py'],
  grammar: Python,
  traverser: new PythonTraverser(),
  exportExtractor: new PythonExportExtractor(),
  importExtractor: new PythonImportExtractor(),

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

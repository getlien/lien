import type { SymbolInfo, SyntaxNode } from '../types.js';
import type { LanguageDefinition } from './types.js';
import type { LanguageTraverser, DeclarationFunctionInfo } from '../traversers/types.js';
import type {
  LanguageExportExtractor,
  LanguageImportExtractor,
  LanguageSymbolExtractor,
} from '../extractors/types.js';
import {
  extractSignature,
  extractParameters,
  clampSignatureLength,
} from '../extractors/symbol-helpers.js';
import { calculateComplexity } from '../complexity/index.js';

// =============================================================================
// SHARED HELPERS
// =============================================================================

/**
 * Extract the effective symbol name from a Python aliased_import node.
 * Returns the alias if present, otherwise the original name.
 */
function extractAliasedSymbolName(node: SyntaxNode): string | null {
  const identifiers = node.namedChildren.filter(c => c.type === 'identifier');

  if (identifiers.length >= 2) {
    return identifiers[identifiers.length - 1].text;
  }

  if (identifiers.length === 1) {
    return identifiers[0].text;
  }

  const dottedName = node.namedChildren.find(c => c.type === 'dotted_name');
  return dottedName?.text ?? null;
}

/**
 * Locate the module-path node within a Python `import_from_statement`'s
 * named children.
 *
 * Two grammar shapes:
 * - Absolute (`from utils.validate import X`): the module path is a
 *   top-level `dotted_name` (e.g. "utils.validate").
 * - Relative (`from . import X`, `from .foo import X`, `from ..pkg import Y`):
 *   the leading dots — and any dotted sub-path after them — are wrapped in a
 *   single `relative_import` node (e.g. ".", ".foo", "..pkg"). The module's
 *   own `dotted_name`, if any, is nested *inside* that node, not a sibling
 *   of it, so it must not be matched directly here.
 *
 * Whichever shape applies, the module-path node is always the first named
 * child — imported symbol names (`dotted_name`/`aliased_import`/
 * `wildcard_import`) always come after it — so a single `findIndex` checking
 * both node types is sufficient and always correct.
 */
function findModulePathIndex(node: SyntaxNode): number {
  return node.namedChildren.findIndex(
    child => child.type === 'relative_import' || child.type === 'dotted_name',
  );
}

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
  targetNodeTypes = ['function_definition', 'async_function_definition'];

  containerTypes = [
    'class_definition', // We extract methods, not the class itself
    // `decorated_definition` wraps either a function or a class (tree-sitter-python
    // puts the decorator(s) and the definition under one node, unlike Java/Kotlin/
    // Swift/C#/PHP/Rust where annotations are a sibling field on the declaration
    // itself). Routing it through the container path lets getContainerBody() decide,
    // per-node, whether it behaves like a leaf (decorated function/method - no body
    // to recurse into) or like a container (decorated class - recurse into its body
    // so its methods still get chunked).
    'decorated_definition',
  ];

  declarationTypes: string[] = [];

  functionTypes = ['function_definition', 'async_function_definition'];

  shouldExtractChildren(node: SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(_node: SyntaxNode): boolean {
    return false;
  }

  getContainerBody(node: SyntaxNode): SyntaxNode | null {
    if (node.type === 'class_definition') {
      return node.childForFieldName('body');
    }
    if (node.type === 'decorated_definition') {
      const definition = node.childForFieldName('definition');
      // Only a decorated class has more to recurse into. A decorated function/method
      // is chunked whole (via shouldExtractChildren pushing the node itself below).
      return definition?.type === 'class_definition' ? definition.childForFieldName('body') : null;
    }
    return null;
  }

  shouldTraverseChildren(node: SyntaxNode): boolean {
    return node.type === 'module' || node.type === 'block';
  }

  findParentContainerName(node: SyntaxNode): string | undefined {
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

  findFunctionInDeclaration(_node: SyntaxNode): DeclarationFunctionInfo {
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

  private extractExportName(node: SyntaxNode): string | null {
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

  extractExports(rootNode: SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();

    const addExport = (name: string) => {
      if (name && !seen.has(name)) {
        seen.add(name);
        exports.push(name);
      }
    };

    rootNode.namedChildren.forEach(child => {
      const name = this.extractExportName(child);
      if (name) {
        addExport(name);
        return;
      }

      // Re-exports via `from .module import Symbol` (relative imports only)
      if (child.type === 'import_from_statement') {
        const hasRelativeImport = child.namedChildren.some(c => c.type === 'relative_import');
        if (hasRelativeImport) {
          this.extractReExportNames(child, addExport);
        }
      }
    });

    return exports;
  }

  private extractReExportNames(node: SyntaxNode, addExport: (name: string) => void): void {
    const startIndex = findModulePathIndex(node);
    if (startIndex === -1) return;

    node.namedChildren.slice(startIndex + 1).forEach(child => {
      if (child.type === 'dotted_name') {
        addExport(child.text);
      } else if (child.type === 'aliased_import') {
        const name = extractAliasedSymbolName(child);
        if (name) addExport(name);
      }
    });
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

  /**
   * Extract the clean dotted module path for the `imports` list (used by
   * test-association discovery and dependency analysis) — never the raw
   * statement text. Delegates to `processImportSymbols()` so the `imports`
   * list and the `importedSymbols` map are always derived from the same
   * computation and can never disagree.
   *
   * Shapes:
   * - `import os` -> "os"; `import os as system` -> "os" (module, not alias)
   * - `import x.y` / `import x.y as z` -> "x.y"
   * - `from utils.validate import X` -> "utils.validate"
   * - Relative: `from . import X` -> "."; `from .foo import X` -> ".foo";
   *   `from ..pkg import Y` -> "..pkg" (dots preserved — there's no file
   *   context available here to resolve them against the importer's own
   *   path, so the clean-but-unresolved dotted form is the best available
   *   "path"; see `resolveRelativeImport()` in `../../utils/path-matching.js`
   *   for why Python relative imports, unlike JS's `./`/`../`, pass through
   *   that resolution step unchanged today).
   *
   * A statement with multiple comma-separated modules (`import a, b.c`)
   * yields only the first (`"a"`) — a pre-existing limitation of
   * `processPythonImport()`, not a new one introduced here.
   */
  extractImportPath(node: SyntaxNode): string | null {
    return this.processImportSymbols(node)?.importPath ?? null;
  }

  processImportSymbols(node: SyntaxNode): { importPath: string; symbols: string[] } | null {
    if (node.type === 'import_statement') {
      return this.processPythonImport(node);
    }
    if (node.type === 'import_from_statement') {
      return this.processPythonFromImport(node);
    }
    return null;
  }

  private processSimpleImport(child: SyntaxNode): { importPath: string; symbols: string[] } {
    return {
      importPath: child.text,
      symbols: [child.text],
    };
  }

  private processAliasedImport(
    child: SyntaxNode,
  ): { importPath: string; symbols: string[] } | null {
    const dottedName = child.namedChildren.find(c => c.type === 'dotted_name');
    const identifiers = child.namedChildren.filter(c => c.type === 'identifier');

    const moduleName = dottedName?.text || identifiers[0]?.text;
    const aliasName =
      identifiers.length >= 2 ? identifiers[identifiers.length - 1]?.text : identifiers[0]?.text;

    if (!moduleName || !aliasName) return null;
    return { importPath: moduleName, symbols: [aliasName] };
  }

  /**
   * Process Python regular import statement.
   * e.g., "import os", "import os as system"
   */
  private processPythonImport(node: SyntaxNode): { importPath: string; symbols: string[] } | null {
    for (const child of node.namedChildren) {
      if (child.type === 'dotted_name' || child.type === 'identifier') {
        return this.processSimpleImport(child);
      }
      if (child.type === 'aliased_import') {
        return this.processAliasedImport(child);
      }
    }
    return null;
  }

  private findModulePath(node: SyntaxNode): { path: string; startIndex: number } | null {
    const index = findModulePathIndex(node);
    if (index === -1) return null;
    return { path: node.namedChildren[index].text, startIndex: index };
  }

  private collectImportedSymbols(node: SyntaxNode, startIndex: number): string[] {
    const symbols: string[] = [];
    node.namedChildren.slice(startIndex + 1).forEach(child => {
      if (child.type === 'dotted_name') {
        symbols.push(child.text);
      } else if (child.type === 'aliased_import') {
        const symbolName = extractAliasedSymbolName(child);
        if (symbolName) symbols.push(symbolName);
      }
    });
    return symbols;
  }

  /**
   * Process Python from...import statement.
   * e.g., "from utils.validate import validateEmail, validatePhone"
   */
  private processPythonFromImport(
    node: SyntaxNode,
  ): { importPath: string; symbols: string[] } | null {
    const moduleInfo = this.findModulePath(node);
    if (!moduleInfo) return null;

    const symbols = this.collectImportedSymbols(node, moduleInfo.startIndex);
    if (symbols.length === 0) return null;

    return { importPath: moduleInfo.path, symbols };
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
    'decorated_definition',
  ];

  extractSymbol(node: SyntaxNode, content: string, parentClass?: string): SymbolInfo | null {
    switch (node.type) {
      case 'function_definition':
      case 'async_function_definition':
        return this.extractFunctionInfo(node, content, parentClass);
      case 'class_definition':
        return this.extractClassInfo(node);
      case 'decorated_definition':
        return this.extractDecoratedInfo(node, content, parentClass);
      default:
        return null;
    }
  }

  /**
   * Unwrap `decorated_definition` (decorator(s) + a function/class field) to the
   * inner definition's symbol info, so decorated functions/methods/classes carry
   * the same name/type/complexity/callSites as their undecorated counterparts.
   * The decorator source is folded into `signature` so it isn't silently dropped -
   * mirrors how e.g. Java's `@Override` naturally stays part of the signature text
   * (there it's a sibling child of the same node, not a separate wrapper node).
   */
  private extractDecoratedInfo(
    node: SyntaxNode,
    content: string,
    parentClass?: string,
  ): SymbolInfo | null {
    const definition = node.childForFieldName('definition');
    if (!definition) return null;

    const inner = this.extractSymbol(definition, content, parentClass);
    if (!inner) return null;

    const decoratorPrefix = node.namedChildren
      .filter(child => child.type === 'decorator')
      .map(child => child.text)
      .join(' ');
    if (!decoratorPrefix || !inner.signature) return inner;

    return { ...inner, signature: clampSignatureLength(`${decoratorPrefix} ${inner.signature}`) };
  }

  extractCallSite(node: SyntaxNode): { symbol: string; line: number; key: string } | null {
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
    node: SyntaxNode,
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
      complexity: calculateComplexity(node),
    };
  }

  private extractClassInfo(node: SyntaxNode): SymbolInfo | null {
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
  traverser: new PythonTraverser(),
  exportExtractor: new PythonExportExtractor(),
  importExtractor: new PythonImportExtractor(),
  symbolExtractor: new PythonSymbolExtractor(),

  complexity: {
    decisionPoints: [
      'if_statement',
      'while_statement',
      'for_statement',
      'switch_case',
      'catch_clause',
      'ternary_expression',
      'binary_expression',
      'elif_clause',
      'except_clause',
      'conditional_expression',
    ],
    nestingTypes: ['if_statement', 'for_statement', 'while_statement', 'except_clause'],
    nonNestingTypes: ['elif_clause', 'conditional_expression'],
    lambdaTypes: ['lambda'],
    operatorSymbols: new Set([
      '+',
      '-',
      '*',
      '/',
      '%',
      '**',
      '//',
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
      '**=',
      '//=',
      '&=',
      '|=',
      '^=',
      '<<=',
      '>>=',
      '&',
      '|',
      '^',
      '~',
      '<<',
      '>>',
      '.',
      ':',
      '->',
      '@',
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
    ]),
    operatorKeywords: new Set([
      'if',
      'elif',
      'else',
      'for',
      'while',
      'match',
      'case',
      'return',
      'raise',
      'try',
      'except',
      'finally',
      'and',
      'or',
      'not',
      'is',
      'in',
      'await',
      'yield',
      'break',
      'continue',
      'pass',
      'def',
      'class',
      'lambda',
      'async',
      'import',
      'from',
      'as',
      'with',
      'global',
      'nonlocal',
      'del',
      'assert',
    ]),
  },

  symbols: {
    callExpressionTypes: ['call'],
  },
};

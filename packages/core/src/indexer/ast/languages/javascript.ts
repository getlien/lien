import JavaScript from 'tree-sitter-javascript';
import type Parser from 'tree-sitter';
import type { LanguageDefinition } from './types.js';
import type { LanguageTraverser, DeclarationFunctionInfo } from '../traversers/types.js';
import type { LanguageExportExtractor, LanguageImportExtractor } from '../extractors/types.js';

// =============================================================================
// TRAVERSERS
// =============================================================================

/**
 * TypeScript/JavaScript AST traverser
 *
 * Handles TypeScript and JavaScript AST node types and traversal patterns.
 * Both languages share the same AST structure (via tree-sitter-typescript).
 */
export class TypeScriptTraverser implements LanguageTraverser {
  targetNodeTypes = [
    'function_declaration',
    'function',
    'interface_declaration',
    'method_definition',
    'lexical_declaration',    // For const/let with arrow functions
    'variable_declaration',   // For var with functions
  ];

  containerTypes = [
    'class_declaration',      // We extract methods, not the class itself
  ];

  declarationTypes = [
    'lexical_declaration',    // const/let
    'variable_declaration',   // var
  ];

  functionTypes = [
    'arrow_function',
    'function_expression',
    'function',
  ];

  shouldExtractChildren(node: Parser.SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(node: Parser.SyntaxNode): boolean {
    return this.declarationTypes.includes(node.type);
  }

  getContainerBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (node.type === 'class_declaration') {
      return node.childForFieldName('body');
    }
    return null;
  }

  shouldTraverseChildren(node: Parser.SyntaxNode): boolean {
    return node.type === 'program' ||
           node.type === 'export_statement' ||
           node.type === 'class_body';
  }

  findParentContainerName(node: Parser.SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_declaration') {
        const nameNode = current.childForFieldName('name');
        return nameNode?.text;
      }
      current = current.parent;
    }
    return undefined;
  }

  findFunctionInDeclaration(node: Parser.SyntaxNode): DeclarationFunctionInfo {
    const search = (n: Parser.SyntaxNode, depth: number): Parser.SyntaxNode | null => {
      if (depth > 3) return null;

      if (this.functionTypes.includes(n.type)) {
        return n;
      }

      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) {
          const result = search(child, depth + 1);
          if (result) return result;
        }
      }

      return null;
    };

    const functionNode = search(node, 0);
    return {
      hasFunction: functionNode !== null,
      functionNode,
    };
  }
}

/**
 * JavaScript uses the same traverser as TypeScript
 */
export class JavaScriptTraverser extends TypeScriptTraverser {}

// =============================================================================
// EXPORT EXTRACTORS
// =============================================================================

/**
 * JavaScript/TypeScript export extractor
 *
 * Handles explicit export statements:
 * - Named exports: export { foo, bar }
 * - Declaration exports: export function foo() {}, export const bar = ...
 * - Default exports: export default ...
 * - Re-exports: export { foo } from './module'
 */
export class JavaScriptExportExtractor implements LanguageExportExtractor {
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
      if (child?.type === 'export_statement') {
        this.extractExportStatementSymbols(child, addExport);
      }
    }

    return exports;
  }

  private extractExportStatementSymbols(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
    const defaultKeyword = node.children.find(c => c.type === 'default');
    if (defaultKeyword) {
      addExport('default');
    }

    const declaration = node.childForFieldName('declaration');
    if (declaration) {
      this.extractDeclarationExports(declaration, addExport);
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'export_clause') {
        this.extractExportClauseSymbols(child, addExport);
      }
    }
  }

  private extractDeclarationExports(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      addExport(nameNode.text);
      return;
    }

    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child?.type === 'variable_declarator') {
          const varName = child.childForFieldName('name');
          if (varName) {
            addExport(varName.text);
          }
        }
      }
    }
  }

  private extractExportClauseSymbols(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'export_specifier') {
        const aliasNode = child.childForFieldName('alias');
        const nameNode = child.childForFieldName('name');
        const exported = aliasNode?.text || nameNode?.text;
        if (exported) {
          addExport(exported);
        }
      }
    }
  }
}

/**
 * TypeScript uses the same export extraction as JavaScript
 */
export class TypeScriptExportExtractor extends JavaScriptExportExtractor {}

// =============================================================================
// IMPORT EXTRACTORS
// =============================================================================

/**
 * JavaScript/TypeScript import extractor
 *
 * Handles:
 * - Named imports: import { foo, bar } from './module'
 * - Default imports: import foo from './module'
 * - Namespace imports: import * as utils from './module'
 * - Re-exports: export { foo } from './module'
 */
export class JavaScriptImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['import_statement', 'export_statement'];

  extractImportPath(node: Parser.SyntaxNode): string | null {
    const sourceNode = node.childForFieldName('source');
    return sourceNode ? sourceNode.text.replace(/['"]/g, '') : null;
  }

  processImportSymbols(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    if (node.type === 'import_statement') {
      return this.processImportStatement(node);
    }
    if (node.type === 'export_statement') {
      return this.processReExportStatement(node);
    }
    return null;
  }

  private processImportStatement(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return null;

    const importPath = sourceNode.text.replace(/['"]/g, '');
    const symbols = this.extractImportStatementSymbols(node);
    return symbols.length > 0 ? { importPath, symbols } : null;
  }

  private processReExportStatement(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return null;

    const importPath = sourceNode.text.replace(/['"]/g, '');
    const symbols: string[] = [];

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'export_clause') {
        symbols.push(...this.extractExportClauseSymbols(child));
      }
    }

    return symbols.length > 0 ? { importPath, symbols } : null;
  }

  private extractImportStatementSymbols(node: Parser.SyntaxNode): string[] {
    const symbols: string[] = [];

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;

      switch (child.type) {
        case 'identifier':
          symbols.push(child.text);
          break;
        case 'import_clause':
          this.extractImportClauseSymbols(child, symbols);
          break;
        case 'named_imports':
          this.extractNamedImportSymbols(child, symbols);
          break;
        case 'namespace_import':
          this.extractNamespaceImportSymbol(child, symbols);
          break;
      }
    }

    return symbols;
  }

  private extractImportClauseSymbols(node: Parser.SyntaxNode, symbols: string[]): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;

      if (child.type === 'identifier') {
        symbols.push(child.text);
      } else if (child.type === 'named_imports') {
        this.extractNamedImportSymbols(child, symbols);
      } else if (child.type === 'namespace_import') {
        this.extractNamespaceImportSymbol(child, symbols);
      }
    }
  }

  private extractNamespaceImportSymbol(node: Parser.SyntaxNode, symbols: string[]): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'identifier') {
        symbols.push(`* as ${child.text}`);
        return;
      }
    }
  }

  private extractNamedImportSymbols(node: Parser.SyntaxNode, symbols: string[]): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;

      switch (child.type) {
        case 'import_specifier': {
          const aliasNode = child.childForFieldName('alias');
          const nameNode = child.childForFieldName('name');
          const symbol = aliasNode?.text || nameNode?.text || child.text;
          if (symbol && !symbol.includes('{') && !symbol.includes('}')) {
            symbols.push(symbol);
          }
          break;
        }
        case 'identifier':
          symbols.push(child.text);
          break;
        case 'named_imports':
          this.extractNamedImportSymbols(child, symbols);
          break;
      }
    }
  }

  /**
   * Extract original symbol names from an export_clause (for re-exports).
   * Uses original name (not alias) since it maps to the source module's exports.
   */
  private extractExportClauseSymbols(clause: Parser.SyntaxNode): string[] {
    const symbols: string[] = [];
    for (let j = 0; j < clause.namedChildCount; j++) {
      const specifier = clause.namedChild(j);
      if (specifier?.type !== 'export_specifier') continue;
      const nameNode = specifier.childForFieldName('name');
      const symbol = nameNode?.text || specifier.text;
      if (symbol && !symbol.includes('{') && !symbol.includes('}')) {
        symbols.push(symbol);
      }
    }
    return symbols;
  }
}

/**
 * TypeScript uses the same import extraction as JavaScript
 */
export class TypeScriptImportExtractor extends JavaScriptImportExtractor {}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const javascriptDefinition: LanguageDefinition = {
  id: 'javascript',
  extensions: ['js', 'jsx', 'mjs', 'cjs'],
  grammar: JavaScript,
  traverser: new JavaScriptTraverser(),
  exportExtractor: new JavaScriptExportExtractor(),
  importExtractor: new JavaScriptImportExtractor(),

  complexity: {
    decisionPoints: [
      'if_statement', 'while_statement', 'for_statement', 'switch_case',
      'catch_clause', 'ternary_expression', 'binary_expression',
      'do_statement', 'for_in_statement', 'for_of_statement',
    ],
    nestingTypes: [
      'if_statement', 'for_statement', 'while_statement', 'switch_statement',
      'catch_clause', 'do_statement', 'for_in_statement', 'for_of_statement',
    ],
    nonNestingTypes: [
      'else_clause', 'ternary_expression',
    ],
    lambdaTypes: [
      'arrow_function', 'function_expression',
    ],
    operatorSymbols: new Set([
      '+', '-', '*', '/', '%', '**',
      '==', '===', '!=', '!==', '<', '>', '<=', '>=',
      '&&', '||', '!', '??',
      '=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=',
      '&', '|', '^', '~', '<<', '>>', '>>>',
      '&=', '|=', '^=', '<<=', '>>=', '>>>=',
      '?', ':', '.', '?.', '++', '--', '...', '=>',
      '(', ')', '[', ']', '{', '}',
    ]),
    operatorKeywords: new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
      'return', 'throw', 'try', 'catch', 'finally',
      'new', 'delete', 'typeof', 'instanceof', 'in', 'of',
      'await', 'yield', 'break', 'continue',
      'const', 'let', 'var', 'function', 'class', 'extends', 'implements',
      'import', 'export', 'from', 'as',
    ]),
  },

  symbols: {
    callExpressionTypes: [
      'call_expression',
      'new_expression',
    ],
  },
};

import JavaScript from 'tree-sitter-javascript';
import type Parser from 'tree-sitter';
import type { SymbolInfo } from '../types.js';
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
  extractReturnType,
} from '../extractors/symbol-helpers.js';
import { calculateComplexity } from '../complexity/index.js';

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
    'lexical_declaration', // For const/let with arrow functions
    'variable_declaration', // For var with functions
  ];

  containerTypes = [
    'class_declaration', // We extract methods, not the class itself
  ];

  declarationTypes = [
    'lexical_declaration', // const/let
    'variable_declaration', // var
  ];

  functionTypes = ['arrow_function', 'function_expression', 'function'];

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
    return (
      node.type === 'program' || node.type === 'export_statement' || node.type === 'class_body'
    );
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
 * Handles ES module exports:
 * - Named exports: export { foo, bar }
 * - Declaration exports: export function foo() {}, export const bar = ...
 * - Default exports: export default ...
 * - Re-exports: export { foo } from './module'
 *
 * Handles CommonJS exports:
 * - module.exports = { foo, bar }
 * - module.exports = function/class
 * - exports.foo = ... / module.exports.bar = ...
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
      } else if (child?.type === 'expression_statement') {
        this.extractCJSExportSymbols(child, addExport);
      }
    }

    return exports;
  }

  private extractExportStatementSymbols(
    node: Parser.SyntaxNode,
    addExport: (name: string) => void,
  ): void {
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

  private extractDeclarationExports(
    node: Parser.SyntaxNode,
    addExport: (name: string) => void,
  ): void {
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

  private extractExportClauseSymbols(
    node: Parser.SyntaxNode,
    addExport: (name: string) => void,
  ): void {
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

  // ---------------------------------------------------------------------------
  // CommonJS export extraction
  // ---------------------------------------------------------------------------

  private isModuleExports(node: Parser.SyntaxNode): boolean {
    return (
      node.type === 'member_expression' &&
      node.childForFieldName('object')?.text === 'module' &&
      node.childForFieldName('property')?.text === 'exports'
    );
  }

  private extractCJSExportSymbols(
    node: Parser.SyntaxNode,
    addExport: (name: string) => void,
  ): void {
    // Look for assignment_expression inside expression_statement
    const expr = node.namedChild(0);
    if (expr?.type !== 'assignment_expression') return;

    const left = expr.childForFieldName('left');
    const right = expr.childForFieldName('right');
    if (!left || !right) return;

    // module.exports = ...
    if (this.isModuleExports(left)) {
      this.extractModuleExportsValue(right, addExport);
      return;
    }

    // exports.foo = ...
    if (left.type === 'member_expression' && left.childForFieldName('object')?.text === 'exports') {
      const prop = left.childForFieldName('property');
      if (prop) addExport(prop.text);
      return;
    }

    // module.exports.bar = ...
    if (left.type === 'member_expression') {
      const objectNode = left.childForFieldName('object');
      if (objectNode && this.isModuleExports(objectNode)) {
        const prop = left.childForFieldName('property');
        if (prop) addExport(prop.text);
      }
    }
  }

  private extractModuleExportsValue(
    node: Parser.SyntaxNode,
    addExport: (name: string) => void,
  ): void {
    // module.exports = { foo, bar, baz: val }
    if (node.type === 'object') {
      this.extractObjectExportProperties(node, addExport);
      return;
    }

    // module.exports = function name() {} or module.exports = class Name {}
    if (node.type === 'function_expression' || node.type === 'class') {
      addExport('default');
      const nameNode = node.childForFieldName('name');
      if (nameNode) addExport(nameNode.text);
      return;
    }

    // module.exports = identifier or anything else
    addExport('default');
  }

  private extractObjectExportProperties(
    node: Parser.SyntaxNode,
    addExport: (name: string) => void,
  ): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const prop = node.namedChild(i);
      if (!prop) continue;

      if (prop.type === 'shorthand_property_identifier') {
        addExport(prop.text);
      } else if (prop.type === 'pair') {
        const key = prop.childForFieldName('key');
        if (key) addExport(key.text);
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
 * Handles ES module imports:
 * - Named imports: import { foo, bar } from './module'
 * - Default imports: import foo from './module'
 * - Namespace imports: import * as utils from './module'
 * - Re-exports: export { foo } from './module'
 *
 * Handles CommonJS require():
 * - const x = require('module')
 * - const { a, b } = require('module')
 * - const { a: alias } = require('module')
 * - require('./side-effect')
 */
export class JavaScriptImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = [
    'import_statement',
    'export_statement',
    'lexical_declaration',
    'variable_declaration',
    'expression_statement',
  ];

  extractImportPath(node: Parser.SyntaxNode): string | null {
    const sourceNode = node.childForFieldName('source');
    if (sourceNode) return sourceNode.text.replace(/['"]/g, '');

    // Handle CommonJS require() in variable/lexical declarations
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      const requireInfo = this.processRequireDeclaration(node);
      if (requireInfo?.importPath) return requireInfo.importPath;
    }

    return this.extractRequirePath(node);
  }

  processImportSymbols(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    if (node.type === 'import_statement') {
      return this.processImportStatement(node);
    }
    if (node.type === 'export_statement') {
      return this.processReExportStatement(node);
    }
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      return this.processRequireDeclaration(node);
    }
    if (node.type === 'expression_statement') {
      return this.processBareRequire(node);
    }
    return null;
  }

  private processImportStatement(
    node: Parser.SyntaxNode,
  ): { importPath: string; symbols: string[] } | null {
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return null;

    const importPath = sourceNode.text.replace(/['"]/g, '');
    const symbols = this.extractImportStatementSymbols(node);
    return symbols.length > 0 ? { importPath, symbols } : null;
  }

  private processReExportStatement(
    node: Parser.SyntaxNode,
  ): { importPath: string; symbols: string[] } | null {
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

  // ---------------------------------------------------------------------------
  // CommonJS require() extraction
  // ---------------------------------------------------------------------------

  private findRequireCall(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    // Only match require() as a direct call_expression — not nested inside other expressions
    if (node.type === 'call_expression' && node.childForFieldName('function')?.text === 'require') {
      return node;
    }
    return null;
  }

  private getRequirePathFromCall(callNode: Parser.SyntaxNode): string | null {
    const args = callNode.childForFieldName('arguments');
    if (!args) return null;
    const firstArg = args.namedChild(0);
    if (!firstArg || firstArg.type !== 'string') return null;
    return firstArg.text.replace(/['"]/g, '');
  }

  private extractRequirePath(node: Parser.SyntaxNode): string | null {
    // Check the node itself, then its direct named children
    const call = this.findRequireCall(node) ?? this.findRequireCallInChildren(node);
    if (!call) return null;
    return this.getRequirePathFromCall(call);
  }

  private findRequireCallInChildren(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        const found = this.findRequireCall(child);
        if (found) return found;
      }
    }
    return null;
  }

  private processRequireDeclaration(
    node: Parser.SyntaxNode,
  ): { importPath: string; symbols: string[] } | null {
    // Find the variable_declarator with a require() value
    for (let i = 0; i < node.namedChildCount; i++) {
      const declarator = node.namedChild(i);
      if (declarator?.type !== 'variable_declarator') continue;

      const value = declarator.childForFieldName('value');
      if (!value) continue;

      const call = this.findRequireCall(value);
      if (!call) continue;

      const importPath = this.getRequirePathFromCall(call);
      if (!importPath) continue;

      const nameNode = declarator.childForFieldName('name');
      if (!nameNode) continue;

      const symbols = this.extractRequireBindingSymbols(nameNode);
      if (symbols.length > 0) return { importPath, symbols };
    }
    return null;
  }

  private extractRequireBindingSymbols(nameNode: Parser.SyntaxNode): string[] {
    // const express = require('express')
    if (nameNode.type === 'identifier') return [nameNode.text];
    // const { Router, json } = require('express')
    if (nameNode.type === 'object_pattern') return this.extractObjectPatternSymbols(nameNode);
    return [];
  }

  private extractObjectPatternSymbols(node: Parser.SyntaxNode): string[] {
    const symbols: string[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const prop = node.namedChild(i);
      if (!prop) continue;

      if (prop.type === 'shorthand_property_identifier_pattern') {
        symbols.push(prop.text);
      } else if (prop.type === 'pair_pattern') {
        // const { Router: MyRouter } = require('express')
        const value = prop.childForFieldName('value');
        if (value) symbols.push(value.text);
      }
    }
    return symbols;
  }

  private processBareRequire(
    node: Parser.SyntaxNode,
  ): { importPath: string; symbols: string[] } | null {
    // require('./polyfill') — side-effect import, no symbols
    const importPath = this.extractRequirePath(node);
    if (!importPath) return null;
    return { importPath, symbols: [] };
  }
}

/**
 * TypeScript uses the same import extraction as JavaScript
 */
export class TypeScriptImportExtractor extends JavaScriptImportExtractor {}

// =============================================================================
// SYMBOL EXTRACTORS
// =============================================================================

/**
 * JavaScript/TypeScript symbol extractor
 *
 * Extracts symbol info from function declarations, arrow functions,
 * method definitions, class declarations, and interface declarations.
 *
 * Also handles call site extraction for call_expression and new_expression.
 */
export class JavaScriptSymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = [
    'function_declaration',
    'function',
    'arrow_function',
    'function_expression',
    'method_definition',
    'class_declaration',
    'interface_declaration',
  ];

  extractSymbol(node: Parser.SyntaxNode, content: string, parentClass?: string): SymbolInfo | null {
    switch (node.type) {
      case 'function_declaration':
      case 'function':
        return this.extractFunctionInfo(node, content, parentClass);
      case 'arrow_function':
      case 'function_expression':
        return this.extractArrowFunctionInfo(node, content, parentClass);
      case 'method_definition':
        return this.extractMethodInfo(node, content, parentClass);
      case 'class_declaration':
        return this.extractClassInfo(node);
      case 'interface_declaration':
        return this.extractInterfaceInfo(node);
      default:
        return null;
    }
  }

  extractCallSite(node: Parser.SyntaxNode): { symbol: string; line: number; key: string } | null {
    const line = node.startPosition.row + 1;

    if (node.type === 'call_expression') {
      const functionNode = node.childForFieldName('function');
      if (!functionNode) return null;
      const symbol = this.resolveSymbol(functionNode);
      return symbol ? { symbol, line, key: `${symbol}:${line}` } : null;
    }

    if (node.type === 'new_expression') {
      const ctorNode = node.childForFieldName('constructor');
      if (!ctorNode) return null;
      const symbol = this.resolveSymbol(ctorNode);
      return symbol ? { symbol, line, key: `${symbol}:${line}` } : null;
    }

    return null;
  }

  private resolveSymbol(node: Parser.SyntaxNode): string | null {
    if (node.type === 'identifier') return node.text;
    if (node.type === 'member_expression') {
      const propertyNode = node.childForFieldName('property');
      if (propertyNode?.type === 'property_identifier') return propertyNode.text;
    }
    return null;
  }

  private extractFunctionInfo(
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
      returnType: extractReturnType(node, content),
      complexity: calculateComplexity(node),
    };
  }

  private extractArrowFunctionInfo(
    node: Parser.SyntaxNode,
    content: string,
    parentClass?: string,
  ): SymbolInfo | null {
    const parent = node.parent;
    let name = 'anonymous';

    if (parent?.type === 'variable_declarator') {
      const nameNode = parent.childForFieldName('name');
      name = nameNode?.text || 'anonymous';
    }

    return {
      name,
      type: parentClass ? 'method' : 'function',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: extractSignature(node, content),
      parameters: extractParameters(node, content),
      complexity: calculateComplexity(node),
    };
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
      type: 'method',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: extractSignature(node, content),
      parameters: extractParameters(node, content),
      returnType: extractReturnType(node, content),
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
}

/**
 * TypeScript uses the same symbol extraction as JavaScript
 */
export class TypeScriptSymbolExtractor extends JavaScriptSymbolExtractor {}

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
  symbolExtractor: new JavaScriptSymbolExtractor(),

  complexity: {
    decisionPoints: [
      'if_statement',
      'while_statement',
      'for_statement',
      'switch_case',
      'catch_clause',
      'ternary_expression',
      'binary_expression',
      'do_statement',
      'for_in_statement',
      'for_of_statement',
    ],
    nestingTypes: [
      'if_statement',
      'for_statement',
      'while_statement',
      'switch_statement',
      'catch_clause',
      'do_statement',
      'for_in_statement',
      'for_of_statement',
    ],
    nonNestingTypes: ['else_clause', 'ternary_expression'],
    lambdaTypes: ['arrow_function', 'function_expression'],
    operatorSymbols: new Set([
      '+',
      '-',
      '*',
      '/',
      '%',
      '**',
      '==',
      '===',
      '!=',
      '!==',
      '<',
      '>',
      '<=',
      '>=',
      '&&',
      '||',
      '!',
      '??',
      '=',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
      '**=',
      '&&=',
      '||=',
      '??=',
      '&',
      '|',
      '^',
      '~',
      '<<',
      '>>',
      '>>>',
      '&=',
      '|=',
      '^=',
      '<<=',
      '>>=',
      '>>>=',
      '?',
      ':',
      '.',
      '?.',
      '++',
      '--',
      '...',
      '=>',
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
      'delete',
      'typeof',
      'instanceof',
      'in',
      'of',
      'await',
      'yield',
      'break',
      'continue',
      'const',
      'let',
      'var',
      'function',
      'class',
      'extends',
      'implements',
      'import',
      'export',
      'from',
      'as',
    ]),
  },

  symbols: {
    callExpressionTypes: ['call_expression', 'new_expression'],
  },
};

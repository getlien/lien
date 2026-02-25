import Go from 'tree-sitter-go';
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
 * Go AST traverser
 *
 * Go has a flat structure — methods are top-level declarations with receiver
 * parameters, not nested inside struct/interface blocks. There are no container
 * types (unlike Rust's `impl` blocks or Python's classes).
 *
 * Anonymous functions can appear in var declarations:
 *   var handler = func(w http.ResponseWriter, r *http.Request) { ... }
 */
export class GoTraverser implements LanguageTraverser {
  targetNodeTypes = ['function_declaration', 'method_declaration', 'type_declaration'];

  containerTypes: string[] = [];

  declarationTypes = ['var_declaration', 'short_var_declaration'];

  functionTypes = ['func_literal'];

  shouldExtractChildren(_node: Parser.SyntaxNode): boolean {
    return false;
  }

  isDeclarationWithFunction(node: Parser.SyntaxNode): boolean {
    if (node.type === 'var_declaration') {
      return this.hasFuncLiteral(node);
    }
    if (node.type === 'short_var_declaration') {
      return this.hasFuncLiteral(node);
    }
    return false;
  }

  getContainerBody(_node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    return null;
  }

  shouldTraverseChildren(node: Parser.SyntaxNode): boolean {
    return node.type === 'source_file';
  }

  findParentContainerName(_node: Parser.SyntaxNode): string | undefined {
    return undefined;
  }

  findFunctionInDeclaration(node: Parser.SyntaxNode): DeclarationFunctionInfo {
    const noFunction: DeclarationFunctionInfo = { hasFunction: false, functionNode: null };

    // var handler = func(...) { ... }
    if (node.type === 'var_declaration') {
      return findFuncLiteralInVarDecl(node) ?? noFunction;
    }

    // handler := func(...) { ... }
    if (node.type === 'short_var_declaration') {
      const right = node.childForFieldName('right');
      const funcLiteral = right ? findChildOfType(right, 'func_literal') : null;
      return funcLiteral ? { hasFunction: true, functionNode: funcLiteral } : noFunction;
    }

    return noFunction;
  }

  private hasFuncLiteral(node: Parser.SyntaxNode): boolean {
    return this.findFunctionInDeclaration(node).hasFunction;
  }
}

// =============================================================================
// EXPORT EXTRACTOR
// =============================================================================

/**
 * Go export extractor
 *
 * Go uses capitalization for exports — identifiers starting with an uppercase
 * letter are exported from the package.
 *
 * Exportable items:
 * - func NewUser() {}              (uppercase function)
 * - func (u *User) GetName() {}    (uppercase method)
 * - type User struct {}            (uppercase type)
 * - type Validator interface {}    (uppercase interface)
 * - const MaxSize = 100            (uppercase constant)
 * - var GlobalVar = "hello"        (uppercase variable)
 *
 * Grouped declarations are also supported:
 * - const ( StatusActive = 1; StatusInactive = 2 )
 * - var ( Version = "1.0"; Build = "123" )
 * - type ( Request struct{}; Response struct{} )
 */
export class GoExportExtractor implements LanguageExportExtractor {
  extractExports(rootNode: Parser.SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();

    const addExport = (name: string) => {
      if (name && isExported(name) && !seen.has(name)) {
        seen.add(name);
        exports.push(name);
      }
    };

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i);
      if (!child) continue;

      switch (child.type) {
        case 'function_declaration': {
          const name = child.childForFieldName('name');
          if (name) addExport(name.text);
          break;
        }
        case 'method_declaration': {
          const name = child.childForFieldName('name');
          if (name) addExport(name.text);
          break;
        }
        case 'type_declaration':
          this.extractTypeExports(child, addExport);
          break;
        case 'const_declaration':
        case 'var_declaration':
          this.extractSpecExports(child, addExport);
          break;
      }
    }

    return exports;
  }

  private extractTypeExports(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const spec = node.namedChild(i);
      if (spec?.type === 'type_spec') {
        const nameNode = spec.childForFieldName('name');
        if (nameNode) addExport(nameNode.text);
      }
    }
  }

  private extractSpecExports(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
    const specs = collectSpecs(node);
    for (const spec of specs) {
      const nameNode = spec.childForFieldName('name');
      if (nameNode) addExport(nameNode.text);
    }
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/**
 * Check if a Go import path is a standard library package.
 * Stdlib packages have no dots in their first path component.
 * Examples: "fmt", "net/http" = stdlib; "github.com/..." = external
 */
function isStdLibImport(importPath: string): boolean {
  const firstComponent = importPath.split('/')[0];
  return !firstComponent.includes('.');
}

/**
 * Go import extractor
 *
 * Handles all Go import patterns:
 * - import "fmt"                    (single import)
 * - import ( "fmt"; "net/http" )    (grouped imports)
 * - import f "fmt"                  (aliased import)
 * - import . "strings"              (dot import — imports into current scope)
 * - import _ "database/sql"         (blank import — side effects only)
 *
 * Standard library imports are filtered out (no dots in first path component).
 */
export class GoImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['import_declaration'];

  extractImportPath(node: Parser.SyntaxNode): string | null {
    for (const spec of this.collectImportSpecs(node)) {
      const path = this.extractSpecPath(spec);
      if (path) return path;
    }
    return null;
  }

  processImportSymbols(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    // Collect all import specs from the declaration
    const specs = this.collectImportSpecs(node);

    // Process each spec, filtering out stdlib imports
    for (const spec of specs) {
      const path = this.getSpecRawPath(spec);
      if (!path || isStdLibImport(path)) continue;

      const alias = this.getSpecAlias(spec);
      // Use the last path component as the default symbol name
      const parts = path.split('/');
      const defaultSymbol = parts[parts.length - 1];
      const symbol = alias || defaultSymbol;

      return { importPath: path, symbols: [symbol] };
    }

    return null;
  }

  private collectImportSpecs(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const specs: Parser.SyntaxNode[] = [];

    // Single import
    const spec = findChildOfType(node, 'import_spec');
    if (spec && !findChildOfType(node, 'import_spec_list')) {
      specs.push(spec);
      return specs;
    }

    // Grouped import
    const specList = findChildOfType(node, 'import_spec_list');
    if (specList) {
      for (let i = 0; i < specList.namedChildCount; i++) {
        const child = specList.namedChild(i);
        if (child?.type === 'import_spec') {
          specs.push(child);
        }
      }
    }

    return specs;
  }

  private extractSpecPath(spec: Parser.SyntaxNode): string | null {
    const rawPath = this.getSpecRawPath(spec);
    if (!rawPath || isStdLibImport(rawPath)) return null;
    return rawPath;
  }

  private getSpecRawPath(spec: Parser.SyntaxNode): string | null {
    const pathNode = spec.childForFieldName('path');
    if (!pathNode) return null;
    // Remove surrounding quotes from the interpreted_string_literal
    return pathNode.text.replace(/^"|"$/g, '');
  }

  private getSpecAlias(spec: Parser.SyntaxNode): string | null {
    const nameNode = spec.childForFieldName('name');
    if (!nameNode) return null;
    // Dot import (.) and blank import (_) are special
    if (nameNode.type === 'dot' || nameNode.type === 'blank_identifier') return null;
    return nameNode.text;
  }
}

// =============================================================================
// SYMBOL EXTRACTOR
// =============================================================================

/**
 * Go symbol extractor
 *
 * Handles:
 * - function_declaration (func foo() {})
 * - method_declaration (func (u *User) GetName() {}) — receiver type as parentClass
 * - type_declaration containing struct_type → class, interface_type → interface
 *
 * Call sites: call_expression (direct calls and selector/method calls)
 */
export class GoSymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = ['function_declaration', 'method_declaration', 'type_declaration'];

  extractSymbol(node: Parser.SyntaxNode, content: string, parentClass?: string): SymbolInfo | null {
    switch (node.type) {
      case 'function_declaration':
        return this.buildFuncSymbolInfo(node, content, parentClass);
      case 'method_declaration':
        return this.buildFuncSymbolInfo(node, content, extractReceiverType(node));
      case 'type_declaration':
        return this.extractTypeInfo(node);
      default:
        return null;
    }
  }

  extractCallSite(node: Parser.SyntaxNode): { symbol: string; line: number; key: string } | null {
    if (node.type !== 'call_expression') return null;

    const line = node.startPosition.row + 1;
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return null;

    // Direct call: doSomething()
    if (funcNode.type === 'identifier') {
      return { symbol: funcNode.text, line, key: `${funcNode.text}:${line}` };
    }

    // Method/package call: user.GetName() or fmt.Println()
    if (funcNode.type === 'selector_expression') {
      const fieldNode = funcNode.childForFieldName('field');
      if (fieldNode?.type === 'field_identifier') {
        return { symbol: fieldNode.text, line, key: `${fieldNode.text}:${line}` };
      }
    }

    return null;
  }

  private buildFuncSymbolInfo(
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
      returnType: extractGoReturnType(node),
      complexity: calculateComplexity(node),
    };
  }

  private extractTypeInfo(node: Parser.SyntaxNode): SymbolInfo | null {
    // type_declaration contains type_spec children
    const typeSpec = findChildOfType(node, 'type_spec');
    if (!typeSpec) return null;

    const nameNode = typeSpec.childForFieldName('name');
    const typeNode = typeSpec.childForFieldName('type');
    if (!nameNode) return null;

    const symbolType = typeNode?.type === 'interface_type' ? 'interface' : 'class';
    const keyword = symbolType === 'interface' ? 'interface' : 'struct';

    return {
      name: nameNode.text,
      type: symbolType,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: `type ${nameNode.text} ${keyword}`,
    };
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Check if a Go identifier is exported (starts with uppercase).
 */
function isExported(name: string): boolean {
  const first = name[0];
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

/**
 * Extract the receiver type from a method_declaration.
 * Handles both value receivers (u User) and pointer receivers (u *User).
 */
function extractReceiverType(node: Parser.SyntaxNode): string | undefined {
  const receiver = node.childForFieldName('receiver');
  if (!receiver) return undefined;

  // receiver is a parameter_list with one parameter_declaration
  const param = findChildOfType(receiver, 'parameter_declaration');
  if (!param) return undefined;

  const typeNode = param.childForFieldName('type');
  if (!typeNode) return undefined;

  // Pointer receiver: *User -> strip the pointer
  if (typeNode.type === 'pointer_type') {
    for (let i = 0; i < typeNode.namedChildCount; i++) {
      const child = typeNode.namedChild(i);
      if (child?.type === 'type_identifier') return child.text;
    }
  }

  // Value receiver: User
  if (typeNode.type === 'type_identifier') {
    return typeNode.text;
  }

  return undefined;
}

/**
 * Extract return type from a Go function/method.
 * Go uses a `result` field instead of `return_type`.
 */
function extractGoReturnType(node: Parser.SyntaxNode): string | undefined {
  const resultNode = node.childForFieldName('result');
  if (!resultNode) return undefined;
  return resultNode.text;
}

/**
 * Find a func_literal inside a var_declaration's var_spec children.
 */
function findFuncLiteralInVarDecl(node: Parser.SyntaxNode): DeclarationFunctionInfo | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const spec = node.namedChild(i);
    if (spec?.type !== 'var_spec') continue;

    const valueList = spec.childForFieldName('value');
    if (!valueList) continue;

    const funcLiteral = findChildOfType(valueList, 'func_literal');
    if (funcLiteral) return { hasFunction: true, functionNode: funcLiteral };
  }
  return null;
}

/**
 * Collect all named children of specific types from a node.
 */
function collectChildrenOfType(node: Parser.SyntaxNode, types: Set<string>): Parser.SyntaxNode[] {
  const result: Parser.SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child && types.has(child.type)) result.push(child);
  }
  return result;
}

const SPEC_TYPES = new Set(['const_spec', 'var_spec']);

/**
 * Collect all const_spec or var_spec nodes from a declaration,
 * handling the var_spec_list wrapper for grouped var blocks.
 */
function collectSpecs(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  // Direct spec children (single declarations and grouped const)
  const direct = collectChildrenOfType(node, SPEC_TYPES);
  if (direct.length > 0) return direct;

  // Grouped var uses var_spec_list as intermediate wrapper
  const specList = findChildOfType(node, 'var_spec_list');
  return specList ? collectChildrenOfType(specList, SPEC_TYPES) : [];
}

/**
 * Find the first child of a specific type.
 */
function findChildOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === type) return child;
  }
  return null;
}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const goDefinition: LanguageDefinition = {
  id: 'go',
  extensions: ['go'],
  grammar: Go,
  traverser: new GoTraverser(),
  exportExtractor: new GoExportExtractor(),
  importExtractor: new GoImportExtractor(),
  symbolExtractor: new GoSymbolExtractor(),

  complexity: {
    decisionPoints: [
      'if_statement',
      'for_statement',
      'switch_statement',
      'type_switch_statement',
      'select_statement',
      'expression_case',
      'communication_case',
      'binary_expression',
    ],
    nestingTypes: [
      'if_statement',
      'for_statement',
      'switch_statement',
      'type_switch_statement',
      'select_statement',
    ],
    nonNestingTypes: ['expression_case', 'communication_case', 'default_case'],
    lambdaTypes: ['func_literal'],
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
      ':=',
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
      '&^=',
      '&',
      '|',
      '^',
      '!',
      '<<',
      '>>',
      '&^',
      '<-',
      '.',
      '...',
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
      'range',
      'switch',
      'case',
      'default',
      'select',
      'return',
      'break',
      'continue',
      'goto',
      'fallthrough',
      'func',
      'var',
      'const',
      'type',
      'struct',
      'interface',
      'map',
      'chan',
      'go',
      'defer',
      'package',
      'import',
      'make',
      'new',
      'len',
      'cap',
      'append',
      'copy',
      'delete',
      'close',
    ]),
  },

  symbols: {
    callExpressionTypes: ['call_expression'],
  },
};

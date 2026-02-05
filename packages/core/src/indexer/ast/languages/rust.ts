import Rust from 'tree-sitter-rust';
import type Parser from 'tree-sitter';
import type { SymbolInfo } from '../types.js';
import type { LanguageDefinition } from './types.js';
import type { LanguageTraverser, DeclarationFunctionInfo } from '../traversers/types.js';
import type { LanguageExportExtractor, LanguageImportExtractor, LanguageSymbolExtractor } from '../extractors/types.js';
import { extractSignature, extractParameters, extractReturnType } from '../extractors/symbol-helpers.js';
import { calculateComplexity } from '../complexity/index.js';

// =============================================================================
// TRAVERSER
// =============================================================================

/**
 * Rust AST traverser
 *
 * Handles Rust AST node types and traversal patterns.
 * Rust is similar to Python in that functions are always declared with `fn`:
 * - No variable declarations with functions (unlike JS const x = || {})
 * - `impl` blocks and `trait` blocks act as containers (like classes)
 * - Closures exist but are not top-level declarations
 */
export class RustTraverser implements LanguageTraverser {
  targetNodeTypes = [
    'function_item',
    'function_signature_item',
  ];

  containerTypes = [
    'impl_item',
    'trait_item',
  ];

  declarationTypes: string[] = [];

  functionTypes = [
    'closure_expression',
  ];

  shouldExtractChildren(node: Parser.SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(_node: Parser.SyntaxNode): boolean {
    return false;
  }

  getContainerBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (node.type === 'impl_item' || node.type === 'trait_item') {
      return node.childForFieldName('body');
    }
    return null;
  }

  shouldTraverseChildren(node: Parser.SyntaxNode): boolean {
    return node.type === 'source_file' ||
           node.type === 'declaration_list' ||
           node.type === 'mod_item';
  }

  findParentContainerName(node: Parser.SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'impl_item') {
        const typeNode = current.childForFieldName('type');
        return typeNode?.text;
      }
      if (current.type === 'trait_item') {
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
 * Rust export extractor
 *
 * Rust uses `pub` visibility to mark items as exported. Items with a
 * `visibility_modifier` child (e.g., `pub`, `pub(crate)`) are considered exports.
 *
 * Exportable items:
 * - pub fn helper() {}
 * - pub struct User {}
 * - pub enum Status {}
 * - pub trait Serialize {}
 * - pub type Alias = ...
 * - pub const VALUE: ... = ...
 * - pub static GLOBAL: ... = ...
 * - pub mod submodule;
 * - pub use other::Thing;  (re-exports)
 */
export class RustExportExtractor implements LanguageExportExtractor {
  private readonly exportableTypes = new Set([
    'function_item',
    'struct_item',
    'enum_item',
    'trait_item',
    'type_item',
    'const_item',
    'static_item',
    'mod_item',
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
      if (!this.hasVisibilityModifier(child)) continue;

      this.extractExportName(child, addExport);
    }

    return exports;
  }

  private extractExportName(
    node: Parser.SyntaxNode,
    addExport: (name: string) => void
  ): void {
    if (node.type === 'use_declaration') {
      const argument = node.childForFieldName('argument');
      if (argument) {
        const names = this.extractUseExportNames(argument);
        names.forEach(addExport);
      }
      return;
    }

    if (this.exportableTypes.has(node.type)) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addExport(nameNode.text);
    }
  }

  private hasVisibilityModifier(node: Parser.SyntaxNode): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'visibility_modifier') return true;
    }
    return false;
  }

  /**
   * Extract exported names from a use declaration argument.
   * Handles both simple patterns and list patterns:
   * - `pub use crate::auth::AuthService;` -> ["AuthService"]
   * - `pub use crate::auth::{AuthService, AuthError};` -> ["AuthService", "AuthError"]
   */
  private extractUseExportNames(node: Parser.SyntaxNode): string[] {
    if (node.type === 'scoped_identifier') {
      const nameNode = node.childForFieldName('name');
      return nameNode ? [nameNode.text] : [];
    }
    if (node.type === 'identifier') {
      return [node.text];
    }
    if (node.type === 'scoped_use_list') {
      // Find the use_list child and extract symbols
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child?.type === 'use_list') {
          return extractUseListSymbols(child);
        }
      }
    }
    return [];
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/**
 * Convert a Rust module path to a relative file path.
 *
 * - `crate::auth::middleware` -> `auth/middleware`
 * - `self::config` -> `config`
 * - `super::utils` -> `../utils`
 * - `std::io` -> null (external crate, skip)
 */
function convertRustModulePath(path: string): string | null {
  // Remove leading `crate::`, `self::`, or `super::`
  if (path.startsWith('crate::')) {
    return path.slice('crate::'.length).replace(/::/g, '/');
  }
  if (path.startsWith('self::')) {
    return path.slice('self::'.length).replace(/::/g, '/');
  }
  if (path.startsWith('super::')) {
    return '../' + path.slice('super::'.length).replace(/::/g, '/');
  }
  // External crate - skip
  return null;
}

/**
 * Extract the module path prefix from a scoped use argument.
 * For `crate::auth::AuthService`, returns `crate::auth`.
 * For `crate::auth::{A, B}`, returns `crate::auth`.
 */
function extractScopePath(node: Parser.SyntaxNode): string | null {
  const pathNode = node.childForFieldName('path');
  return pathNode?.text ?? null;
}

/**
 * Extract the symbol name from a use_as_clause node.
 * Prefers the alias if present, otherwise takes the last identifier.
 */
function extractUseAsClauseSymbol(node: Parser.SyntaxNode): string | null {
  const alias = node.childForFieldName('alias');
  if (alias) return alias.text;

  // Fallback: take the last identifier
  for (let j = node.namedChildCount - 1; j >= 0; j--) {
    const child = node.namedChild(j);
    if (child?.type === 'identifier') return child.text;
  }
  return null;
}

/**
 * Extract the symbol name from a single use_list item.
 */
function extractUseListItemSymbol(item: Parser.SyntaxNode): string | null {
  switch (item.type) {
    case 'identifier':
      return item.text;
    case 'scoped_identifier':
      return item.childForFieldName('name')?.text ?? null;
    case 'use_as_clause':
      return extractUseAsClauseSymbol(item);
    case 'use_wildcard':
      return '*';
    default:
      return null;
  }
}

/**
 * Extract imported symbol names from a use_list node.
 * Handles: identifier, scoped_identifier, use_as_clause, use_wildcard
 */
function extractUseListSymbols(useList: Parser.SyntaxNode): string[] {
  const symbols: string[] = [];

  for (let i = 0; i < useList.namedChildCount; i++) {
    const item = useList.namedChild(i);
    if (!item) continue;

    const symbol = extractUseListItemSymbol(item);
    if (symbol) symbols.push(symbol);
  }

  return symbols;
}

/**
 * Rust import extractor
 *
 * Handles all `use` declarations (not just `pub use`).
 * Every `use` creates a dependency.
 *
 * Examples:
 * - `use crate::auth::AuthService;`
 * - `use crate::auth::{AuthService, AuthError};`
 * - `use crate::auth::Service as Auth;`
 * - `use crate::models::*;`
 * - `use std::io::Read;` (external - skipped)
 * - `use super::utils::helper;`
 */
export class RustImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['use_declaration'];

  extractImportPath(node: Parser.SyntaxNode): string | null {
    const argument = node.childForFieldName('argument');
    if (!argument) return null;

    const fullPath = this.resolveFullPath(argument);
    return fullPath ? convertRustModulePath(fullPath) : null;
  }

  processImportSymbols(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    const argument = node.childForFieldName('argument');
    if (!argument) return null;

    return this.processUseArgument(argument);
  }

  private processUseArgument(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    // Simple: `use crate::auth::AuthService;`
    if (node.type === 'scoped_identifier') {
      return this.processScopedIdentifier(node);
    }

    // List: `use crate::auth::{AuthService, AuthError};`
    if (node.type === 'scoped_use_list') {
      return this.processScopedUseList(node);
    }

    // Alias: `use crate::auth::Service as Auth;`
    if (node.type === 'use_as_clause') {
      return this.processUseAsClause(node);
    }

    // Wildcard: `use crate::models::*;`
    if (node.type === 'use_wildcard') {
      return this.processUseWildcard(node);
    }

    // Direct identifier (rare): `use SomeItem;`
    if (node.type === 'identifier') {
      return null; // External or ambient, skip
    }

    return null;
  }

  private processScopedIdentifier(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    const pathNode = node.childForFieldName('path');
    const nameNode = node.childForFieldName('name');
    if (!pathNode || !nameNode) return null;

    const modulePath = convertRustModulePath(pathNode.text);
    if (!modulePath) return null;

    return { importPath: modulePath, symbols: [nameNode.text] };
  }

  private processScopedUseList(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    const scopePath = extractScopePath(node);
    if (!scopePath) return null;

    const modulePath = convertRustModulePath(scopePath);
    if (!modulePath) return null;

    // Find the use_list child
    let useList: Parser.SyntaxNode | null = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'use_list') {
        useList = child;
        break;
      }
    }

    if (!useList) return null;

    const symbols = extractUseListSymbols(useList);
    return symbols.length > 0 ? { importPath: modulePath, symbols } : null;
  }

  private processUseAsClause(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    // `use crate::auth::Service as Auth;`
    // The first child is the path (scoped_identifier), alias field has the alias
    const aliasNode = node.childForFieldName('alias');
    let pathChild: Parser.SyntaxNode | null = null;

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'scoped_identifier') {
        pathChild = child;
        break;
      }
    }

    if (!pathChild) return null;

    const scopePathNode = pathChild.childForFieldName('path');
    if (!scopePathNode) return null;

    const modulePath = convertRustModulePath(scopePathNode.text);
    if (!modulePath) return null;

    const symbol = aliasNode?.text || pathChild.childForFieldName('name')?.text;
    if (!symbol) return null;

    return { importPath: modulePath, symbols: [symbol] };
  }

  private processUseWildcard(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    // `use crate::models::*;` -> AST is:
    //   use_wildcard
    //     scoped_identifier (crate::models)
    //     *
    // Find the scoped_identifier child to get the path
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'scoped_identifier') {
        const modulePath = convertRustModulePath(child.text);
        if (!modulePath) return null;
        return { importPath: modulePath, symbols: ['*'] };
      }
    }

    return null;
  }

  /**
   * Resolve the full path of a use argument for the imports list.
   * Returns the full `crate::...` path or similar.
   */
  private resolveFullPath(node: Parser.SyntaxNode): string | null {
    if (node.type === 'scoped_identifier') {
      return node.text;
    }
    if (node.type === 'scoped_use_list') {
      const pathNode = node.childForFieldName('path');
      return pathNode?.text ?? null;
    }
    if (node.type === 'use_as_clause') {
      // Find the scoped_identifier inside
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child?.type === 'scoped_identifier') {
          return child.text;
        }
      }
    }
    if (node.type === 'use_wildcard') {
      // use_wildcard contains a scoped_identifier child, not a 'path' field
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child?.type === 'scoped_identifier') {
          return child.text;
        }
      }
      return null;
    }
    return null;
  }
}

// =============================================================================
// SYMBOL EXTRACTOR
// =============================================================================

/**
 * Rust symbol extractor
 *
 * Handles:
 * - function_item (fn foo() {})
 * - function_signature_item (fn foo(); in traits)
 * - impl_item (impl Foo {}) - treated as class equivalent
 * - trait_item (trait Foo {}) - treated as interface equivalent
 *
 * Call sites: call_expression (foo()), macro_invocation (println!())
 */
export class RustSymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = [
    'function_item',
    'function_signature_item',
    'impl_item',
    'trait_item',
  ];

  extractSymbol(
    node: Parser.SyntaxNode,
    content: string,
    parentClass?: string
  ): SymbolInfo | null {
    switch (node.type) {
      case 'function_item':
      case 'function_signature_item':
        return this.extractFunctionInfo(node, content, parentClass);
      case 'impl_item':
        return this.extractImplInfo(node);
      case 'trait_item':
        return this.extractTraitInfo(node);
      default:
        return null;
    }
  }

  extractCallSite(
    node: Parser.SyntaxNode
  ): { symbol: string; line: number; key: string } | null {
    const line = node.startPosition.row + 1;

    // call_expression: foo(), obj.method()
    if (node.type === 'call_expression') {
      const funcNode = node.childForFieldName('function');
      if (!funcNode) return null;

      if (funcNode.type === 'identifier') {
        return { symbol: funcNode.text, line, key: `${funcNode.text}:${line}` };
      }

      // field_expression: obj.method()
      if (funcNode.type === 'field_expression') {
        const fieldNode = funcNode.childForFieldName('field');
        if (fieldNode?.type === 'field_identifier') {
          return { symbol: fieldNode.text, line, key: `${fieldNode.text}:${line}` };
        }
      }

      return null;
    }

    // macro_invocation: println!(), vec![]
    if (node.type === 'macro_invocation') {
      const macroNode = node.childForFieldName('macro');
      if (macroNode?.type === 'identifier') {
        const symbol = `${macroNode.text}!`;
        return { symbol, line, key: `${symbol}:${line}` };
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
      returnType: extractReturnType(node, content),
      complexity: calculateComplexity(node),
    };
  }

  private extractImplInfo(node: Parser.SyntaxNode): SymbolInfo | null {
    const typeNode = node.childForFieldName('type');
    if (!typeNode) return null;

    return {
      name: typeNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: `impl ${typeNode.text}`,
    };
  }

  private extractTraitInfo(node: Parser.SyntaxNode): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'interface',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: `trait ${nameNode.text}`,
    };
  }
}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const rustDefinition: LanguageDefinition = {
  id: 'rust',
  extensions: ['rs'],
  grammar: Rust,
  traverser: new RustTraverser(),
  exportExtractor: new RustExportExtractor(),
  importExtractor: new RustImportExtractor(),
  symbolExtractor: new RustSymbolExtractor(),

  complexity: {
    decisionPoints: [
      'if_expression', 'match_expression', 'while_expression',
      'for_expression', 'loop_expression', 'match_arm',
      'binary_expression',
    ],
    nestingTypes: [
      'if_expression', 'for_expression', 'while_expression',
      'loop_expression', 'match_expression',
    ],
    nonNestingTypes: [
      'else_clause', 'match_arm',
    ],
    lambdaTypes: [
      'closure_expression',
    ],
    operatorSymbols: new Set([
      '+', '-', '*', '/', '%',
      '==', '!=', '<', '>', '<=', '>=',
      '=', '+=', '-=', '*=', '/=', '%=',
      '&=', '|=', '^=', '<<=', '>>=',
      '&', '|', '^', '!', '<<', '>>',
      '.', '::', '..', '..=', '=>', '->', '?',
      '(', ')', '[', ']', '{', '}',
    ]),
    operatorKeywords: new Set([
      'if', 'else', 'match', 'for', 'while', 'loop',
      'return', 'break', 'continue',
      'let', 'mut', 'fn', 'struct', 'enum', 'impl', 'trait',
      'pub', 'mod', 'use', 'as',
      'async', 'await', 'unsafe', 'where', 'move',
      'ref', 'self', 'super', 'crate', 'dyn', 'type',
    ]),
  },

  symbols: {
    callExpressionTypes: [
      'call_expression',
      'macro_invocation',
    ],
  },
};

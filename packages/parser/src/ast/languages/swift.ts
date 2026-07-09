import type { SymbolInfo, SyntaxNode } from '../types.js';
import type { LanguageDefinition } from './types.js';
import type { LanguageTraverser, DeclarationFunctionInfo } from '../traversers/types.js';
import type {
  LanguageExportExtractor,
  LanguageImportExtractor,
  LanguageSymbolExtractor,
} from '../extractors/types.js';
import { extractSignature, extractReturnType } from '../extractors/symbol-helpers.js';
import { calculateComplexity } from '../complexity/index.js';

// =============================================================================
// HELPERS
//
// The tree-sitter-swift grammar (alex-pinkus) DOES expose field names
// (`name`, `body`, `return_type`, `declaration_kind`, …), so — unlike Kotlin —
// we use `childForFieldName` like the Java definition. The Swift-specific
// wrinkles are: class/struct/actor/enum/extension all share the
// `class_declaration` node (distinguished by the `declaration_kind` keyword),
// parameters are bare `parameter` children (no `parameters` wrapper field), and
// visibility lives under a `modifiers` child.
// =============================================================================

/** First named child of a given type. */
function childByType(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.namedChildren.find(child => child.type === type) ?? null;
}

/** First descendant of a given type (depth-first), or null. */
function findFirst(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (child.type === type) return child;
    const found = findFirst(child, type);
    if (found) return found;
  }
  return null;
}

/**
 * The `class_declaration` keyword (`class` / `struct` / `actor` / `enum` /
 * `extension`), read from the `declaration_kind` field. Defaults to `class`.
 */
function declarationKeyword(node: SyntaxNode): string {
  return node.childForFieldName('declaration_kind')?.text ?? 'class';
}

/** The declared name of a class/protocol declaration (handles `extension`'s `user_type`). */
function declarationName(node: SyntaxNode): string | undefined {
  return node.childForFieldName('name')?.text;
}

/**
 * The name of a function-like node. Swift's `init`/`deinit`/`subscript`
 * declarations have no `name` field — fall back to the keyword.
 */
function functionLikeName(node: SyntaxNode): string | undefined {
  const name = node.childForFieldName('name')?.text;
  if (name) return name;
  switch (node.type) {
    case 'init_declaration':
      return 'init';
    case 'deinit_declaration':
      return 'deinit';
    case 'subscript_declaration':
      return 'subscript';
    default:
      return undefined;
  }
}

/** Parameter texts. Swift function params are bare `parameter` children (no field). */
function swiftParameters(node: SyntaxNode): string[] {
  return node.namedChildren.filter(c => c.type === 'parameter' && c.text.trim()).map(c => c.text);
}

/**
 * The function-valued initializer of a property, if the property's value is
 * *directly* a closure (`let handler = { … }`). Checks the `value` field rather
 * than any descendant, so a closure passed as a call argument
 * (`let n = xs.map { … }`) is NOT treated as a function-valued property.
 */
function propertyInitializerFunction(node: SyntaxNode): SyntaxNode | null {
  const value = node.childForFieldName('value');
  return value?.type === 'lambda_literal' ? value : null;
}

/** Visibility modifier text (`public` / `private` / `fileprivate` / `internal` / `open`), if any. */
function visibilityModifier(node: SyntaxNode): string | null {
  const modifiers = childByType(node, 'modifiers');
  if (!modifiers) return null;
  return modifiers.namedChildren.find(c => c.type === 'visibility_modifier')?.text ?? null;
}

/**
 * Swift declarations are `internal` (module-visible) by default. We treat a
 * declaration as "exported" (part of the file's API surface) unless it is
 * explicitly `private` or `fileprivate` — so default/`internal`/`public`/`open`
 * are surfaced. (Analogous to Kotlin's "public unless private/internal".)
 */
function isExported(node: SyntaxNode): boolean {
  const visibility = visibilityModifier(node);
  return visibility !== 'private' && visibility !== 'fileprivate';
}

/** The property's bound identifier (`let foo = …` → `foo`). */
function propertyName(node: SyntaxNode): string | undefined {
  const pattern = node.childForFieldName('name');
  if (!pattern) return undefined;
  return findFirst(pattern, 'simple_identifier')?.text ?? pattern.text;
}

// =============================================================================
// TRAVERSER
// =============================================================================

/**
 * Swift AST traverser.
 *
 * Functions/methods/initializers live inside `class_declaration` (which covers
 * class / struct / actor / enum / extension) and `protocol_declaration` bodies
 * (`class_body` / `enum_class_body` / `protocol_body`). Closures can appear as
 * property initializers (`let handler = { … }`).
 */
export class SwiftTraverser implements LanguageTraverser {
  targetNodeTypes = [
    'function_declaration',
    'protocol_function_declaration', // abstract method requirements inside a protocol
    'init_declaration',
    'deinit_declaration',
    'subscript_declaration',
  ];

  containerTypes = ['class_declaration', 'protocol_declaration'];

  declarationTypes = ['property_declaration'];

  functionTypes = ['lambda_literal'];

  shouldExtractChildren(node: SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(node: SyntaxNode): boolean {
    return node.type === 'property_declaration' && propertyInitializerFunction(node) !== null;
  }

  getContainerBody(node: SyntaxNode): SyntaxNode | null {
    if (!this.containerTypes.includes(node.type)) return null;
    return node.childForFieldName('body');
  }

  shouldTraverseChildren(node: SyntaxNode): boolean {
    return (
      node.type === 'source_file' ||
      node.type === 'class_body' ||
      node.type === 'enum_class_body' ||
      node.type === 'protocol_body'
    );
  }

  findParentContainerName(node: SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_declaration' || current.type === 'protocol_declaration') {
        return declarationName(current);
      }
      current = current.parent;
    }
    return undefined;
  }

  findFunctionInDeclaration(node: SyntaxNode): DeclarationFunctionInfo {
    if (node.type !== 'property_declaration') {
      return { hasFunction: false, functionNode: null };
    }
    const fn = propertyInitializerFunction(node);
    return fn
      ? { hasFunction: true, functionNode: fn }
      : { hasFunction: false, functionNode: null };
  }
}

// =============================================================================
// EXPORT EXTRACTOR
// =============================================================================

/**
 * Swift export extractor.
 *
 * Swift has no `export` keyword. Top-level declarations and (non-private/
 * fileprivate) members form the file's API surface. Protocol members are
 * implicitly part of the protocol's surface.
 */
export class SwiftExportExtractor implements LanguageExportExtractor {
  extractExports(rootNode: SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();

    const addExport = (name?: string) => {
      if (name && !seen.has(name)) {
        seen.add(name);
        exports.push(name);
      }
    };

    rootNode.namedChildren.forEach(child => this.extractFromNode(child, addExport));

    return exports;
  }

  private extractFromNode(node: SyntaxNode, addExport: (name?: string) => void): void {
    switch (node.type) {
      case 'function_declaration':
      case 'init_declaration':
      case 'deinit_declaration':
      case 'subscript_declaration':
        if (isExported(node)) addExport(functionLikeName(node));
        break;
      case 'property_declaration':
        if (isExported(node)) addExport(propertyName(node));
        break;
      case 'class_declaration':
      case 'protocol_declaration':
        // A private/fileprivate container exposes nothing — skip it and its members.
        if (isExported(node)) {
          addExport(declarationName(node));
          this.extractMembers(node, addExport);
        }
        break;
    }
  }

  private extractMembers(container: SyntaxNode, addExport: (name?: string) => void): void {
    const body = container.childForFieldName('body');
    if (!body) return;

    // Protocol members are implicitly part of the protocol's surface.
    const isProtocol = container.type === 'protocol_declaration';

    body.namedChildren.forEach(member => {
      switch (member.type) {
        case 'function_declaration':
        case 'protocol_function_declaration':
        case 'init_declaration':
        case 'deinit_declaration':
        case 'subscript_declaration':
          if (isProtocol || isExported(member)) addExport(functionLikeName(member));
          break;
        case 'property_declaration':
        case 'protocol_property_declaration':
          if (isProtocol || isExported(member)) addExport(propertyName(member));
          break;
        case 'class_declaration':
        case 'protocol_declaration':
          // Nested types — recurse so their names/members are surfaced too.
          this.extractFromNode(member, addExport);
          break;
      }
    });
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/**
 * The Swift standard library module. `Foundation`, `UIKit`, `SwiftUI`,
 * `Combine`, etc. are real external frameworks and are kept as import edges.
 */
function isSwiftStdLib(importPath: string): boolean {
  return importPath === 'Swift' || importPath.startsWith('Swift.');
}

/**
 * Swift import extractor.
 *
 * Handles `import Foundation`, dotted `import Combine.Just`, and import-kind
 * forms (`import struct Combine.Just` — the `struct`/`class`/… keyword is an
 * anonymous token and is ignored; the module path is what matters). Only the
 * `Swift` stdlib module is filtered out.
 */
export class SwiftImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['import_declaration'];

  extractImportPath(node: SyntaxNode): string | null {
    const path = this.getImportPath(node);
    if (!path || isSwiftStdLib(path)) return null;
    return path;
  }

  processImportSymbols(node: SyntaxNode): { importPath: string; symbols: string[] } | null {
    const path = this.getImportPath(node);
    if (!path || isSwiftStdLib(path)) return null;

    const parts = path.split('.');
    const lastPart = parts[parts.length - 1];
    return { importPath: path, symbols: [lastPart] };
  }

  private getImportPath(node: SyntaxNode): string | null {
    return childByType(node, 'identifier')?.text ?? null;
  }
}

// =============================================================================
// SYMBOL EXTRACTOR
// =============================================================================

/**
 * Swift symbol extractor.
 *
 * Handles `function_declaration`, `init`/`deinit`/`subscript` declarations,
 * `class_declaration` (class / struct / actor / enum / extension — distinguished
 * by the `declaration_kind` keyword), and `protocol_declaration`. `SymbolInfo.type`
 * only has `function|method|class|interface`, so struct/actor/enum/extension map
 * to `class` (keeping the real keyword in the signature) and protocol maps to
 * `interface`.
 *
 * Call sites: `call_expression` — `foo()` (simple_identifier callee) and
 * `a.b.c()` (the member is the `simple_identifier` in the trailing
 * `navigation_suffix`).
 */
export class SwiftSymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = [
    'function_declaration',
    'protocol_function_declaration',
    'init_declaration',
    'deinit_declaration',
    'subscript_declaration',
    'class_declaration',
    'protocol_declaration',
  ];

  extractSymbol(node: SyntaxNode, content: string, parentClass?: string): SymbolInfo | null {
    switch (node.type) {
      case 'function_declaration':
      case 'protocol_function_declaration':
      case 'init_declaration':
      case 'deinit_declaration':
      case 'subscript_declaration':
        return this.extractFunctionInfo(node, content, parentClass);
      case 'class_declaration':
        return this.extractClassInfo(node);
      case 'protocol_declaration':
        return this.extractProtocolInfo(node);
      default:
        return null;
    }
  }

  /**
   * Resolve a call site to the called symbol name. Dependency matching is by
   * bare name (call.symbol === symbol.name), so the name we record determines
   * which definition the call links to.
   *
   * Constructor calls are worth a note: Swift spells initialization `Foo(...)`
   * (no `new`), so the callee is the type name and we record `Foo` — linking the
   * call to the type's `class_declaration` symbol, exactly as JS records
   * `new Foo()` against the class and Python records `Foo()`. So blast-radius for
   * "who constructs Foo" is found via the TYPE symbol (a safe over-approximation),
   * not the `init` method symbol. An explicit `Foo.init()` records `init` and
   * links the initializer directly. The standalone `init`/`deinit`/`subscript`
   * symbols are definitions for search/listing (as Java emits constructor
   * symbols); they intentionally carry no implicit-`Foo()` caller edges.
   */
  extractCallSite(node: SyntaxNode): { symbol: string; line: number; key: string } | null {
    if (node.type !== 'call_expression') return null;
    const line = node.startPosition.row + 1;

    const callee = node.namedChild(0);
    if (!callee) return null;

    let name: string | undefined;
    if (callee.type === 'simple_identifier') {
      name = callee.text; // foo() / Foo() constructor — links to the fn or type symbol
    } else if (callee.type === 'navigation_expression') {
      // a.b.c() / Mod.Type() / Type.init() — the called member is the
      // simple_identifier in the last navigation_suffix
      const suffix = callee.namedChildren.filter(c => c.type === 'navigation_suffix').at(-1);
      name = suffix ? (findFirst(suffix, 'simple_identifier')?.text ?? undefined) : undefined;
    }

    if (!name) return null;
    return { symbol: name, line, key: `${name}:${line}` };
  }

  private extractFunctionInfo(
    node: SyntaxNode,
    content: string,
    parentClass?: string,
  ): SymbolInfo | null {
    const name = functionLikeName(node);
    if (!name) return null;

    return {
      name,
      type: parentClass ? 'method' : 'function',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: extractSignature(node, content),
      parameters: swiftParameters(node),
      returnType: extractReturnType(node, content),
      complexity: calculateComplexity(node),
    };
  }

  private extractClassInfo(node: SyntaxNode): SymbolInfo | null {
    const name = declarationName(node);
    if (!name) return null;
    const keyword = declarationKeyword(node);
    return this.makeSymbol(node, name, 'class', `${keyword} ${name}`);
  }

  private extractProtocolInfo(node: SyntaxNode): SymbolInfo | null {
    const name = declarationName(node);
    if (!name) return null;
    return this.makeSymbol(node, name, 'interface', `protocol ${name}`);
  }

  private makeSymbol(
    node: SyntaxNode,
    name: string,
    type: SymbolInfo['type'],
    signature: string,
  ): SymbolInfo {
    return {
      name,
      type,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature,
    };
  }
}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const swiftDefinition: LanguageDefinition = {
  id: 'swift',
  extensions: ['swift'],
  traverser: new SwiftTraverser(),
  exportExtractor: new SwiftExportExtractor(),
  importExtractor: new SwiftImportExtractor(),
  symbolExtractor: new SwiftSymbolExtractor(),

  complexity: {
    decisionPoints: [
      'if_statement',
      'guard_statement',
      'switch_entry', // each `case` / `default` branch
      'for_statement',
      'while_statement',
      'repeat_while_statement',
      'catch_block',
      'conjunction_expression', // &&
      'disjunction_expression', // ||
      'nil_coalescing_expression', // ??
      'ternary_expression',
    ],
    nestingTypes: [
      'if_statement',
      'guard_statement',
      'switch_statement',
      'for_statement',
      'while_statement',
      'repeat_while_statement',
      'do_statement',
      'catch_block',
      'lambda_literal',
    ],
    nonNestingTypes: [
      'switch_entry',
      'conjunction_expression',
      'disjunction_expression',
      'nil_coalescing_expression',
      'ternary_expression',
    ],
    lambdaTypes: ['lambda_literal'],
    operatorSymbols: new Set([
      '+',
      '-',
      '*',
      '/',
      '%',
      '==',
      '!=',
      '===',
      '!==',
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
      '&&',
      '||',
      '!',
      '??',
      '?.',
      '.',
      '->',
      '..<',
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
      'guard',
      'switch',
      'case',
      'default',
      'for',
      'while',
      'repeat',
      'do',
      'return',
      'break',
      'continue',
      'fallthrough',
      'throw',
      'throws',
      'try',
      'catch',
      'defer',
      'func',
      'class',
      'struct',
      'actor',
      'enum',
      'protocol',
      'extension',
      'init',
      'deinit',
      'subscript',
      'var',
      'let',
      'is',
      'as',
      'in',
      'where',
      'some',
      'any',
      'async',
      'await',
      'import',
      'static',
      'final',
      'lazy',
      'weak',
      'override',
      'private',
      'fileprivate',
      'internal',
      'public',
      'open',
      'self',
      'super',
      'nil',
    ]),
  },

  symbols: {
    callExpressionTypes: ['call_expression'],
  },
};

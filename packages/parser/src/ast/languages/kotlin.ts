import Kotlin from 'tree-sitter-kotlin';
import type Parser from 'tree-sitter';
import type { SymbolInfo } from '../types.js';
import type { LanguageDefinition } from './types.js';
import type { LanguageTraverser, DeclarationFunctionInfo } from '../traversers/types.js';
import type {
  LanguageExportExtractor,
  LanguageImportExtractor,
  LanguageSymbolExtractor,
} from '../extractors/types.js';
import { calculateComplexity } from '../complexity/index.js';

// =============================================================================
// HELPERS
//
// The tree-sitter-kotlin grammar (fwcd) does NOT assign field names, so unlike
// the Java definition we locate children by node TYPE rather than via
// `childForFieldName`. These helpers centralize that.
// =============================================================================

/** First named child of a given type. */
function childByType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  return node.namedChildren.find(child => child.type === type) ?? null;
}

/** Whether a node has a child token of a given type (incl. anonymous keyword tokens). */
function hasTokenChild(node: Parser.SyntaxNode, type: string): boolean {
  return node.children.some(child => child.type === type);
}

/** First descendant of a given type (depth-first). */
function findDescendant(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (child.type === type) return child;
    const found = findDescendant(child, type);
    if (found) return found;
  }
  return null;
}

/** The `function_body` child of a function_declaration ({ … } block OR `= expr`). */
function functionBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  return childByType(node, 'function_body');
}

/**
 * The function name: the first direct `simple_identifier` child of a
 * function_declaration. (Extension-function receivers are `user_type` nodes, so
 * the bare simple_identifier is the name in the common case.)
 */
function functionName(node: Parser.SyntaxNode): string | undefined {
  return childByType(node, 'simple_identifier')?.text;
}

/** The declared name of a class/object declaration (`type_identifier`). */
function declarationName(node: Parser.SyntaxNode): string | undefined {
  return childByType(node, 'type_identifier')?.text;
}

const SIGNATURE_MAX = 200;

function clamp(signature: string): string {
  return signature.length > SIGNATURE_MAX
    ? signature.slice(0, SIGNATURE_MAX - 3) + '...'
    : signature;
}

/**
 * Function signature, bounded by where the body begins. `function_body` covers
 * both block bodies (`{ … }`) and expression bodies (`= expr`, which starts at
 * the `=`), so slicing up to its start yields a clean `fun foo(a: Int): Int`
 * for both. Abstract/interface methods have no body — use the whole node.
 */
function functionSignature(node: Parser.SyntaxNode, content: string): string {
  const body = functionBody(node);
  const end = body ? body.startIndex : node.endIndex;
  const signature = content
    .slice(node.startIndex, end)
    .replace(/\s+/g, ' ')
    .replace(/(\{|=)\s*$/, '') // drop a trailing block-opener / expression `=` if captured
    .trim();
  return clamp(signature);
}

/** Parameter texts from a function's `function_value_parameters`. */
function functionParameters(node: Parser.SyntaxNode): string[] {
  const params = childByType(node, 'function_value_parameters');
  if (!params) return [];
  return params.namedChildren.filter(p => p.text.trim()).map(p => p.text);
}

/**
 * Return type: the type node that sits between the parameter list and the body.
 * Kotlin's grammar emits it as `user_type` / `nullable_type` / `function_type`.
 */
function functionReturnType(node: Parser.SyntaxNode): string | undefined {
  const children = node.namedChildren;
  const paramsIndex = children.findIndex(c => c.type === 'function_value_parameters');
  if (paramsIndex === -1) return undefined;
  for (let i = paramsIndex + 1; i < children.length; i++) {
    const c = children[i];
    if (c.type === 'function_body') break;
    if (c.type === 'user_type' || c.type === 'nullable_type' || c.type === 'function_type') {
      return c.text;
    }
  }
  return undefined;
}

/** Visibility modifier text (`private` / `internal` / `protected` / `public`), if any. */
function visibilityModifier(node: Parser.SyntaxNode): string | null {
  const modifiers = childByType(node, 'modifiers');
  if (!modifiers) return null;
  return modifiers.namedChildren.find(c => c.type === 'visibility_modifier')?.text ?? null;
}

/**
 * Kotlin declarations are `public` by default. We treat a declaration as
 * "exported" (importable / part of the API) unless it is explicitly `private`
 * or `internal`. `protected` members stay visible to subclasses, so we keep
 * them. (Inverse of Java's "has a `public` modifier" check.)
 */
function isExported(node: Parser.SyntaxNode): boolean {
  const visibility = visibilityModifier(node);
  return visibility !== 'private' && visibility !== 'internal';
}

// =============================================================================
// TRAVERSER
// =============================================================================

/**
 * Kotlin AST traverser.
 *
 * Methods live inside `class_declaration` / `object_declaration` bodies
 * (`class_body` / `enum_class_body`). `companion_object` is transparent — its
 * members are traversed so their methods are captured (attributed to the
 * enclosing class). Lambdas can appear in property initializers
 * (`val f = { … }`).
 */
export class KotlinTraverser implements LanguageTraverser {
  targetNodeTypes = ['function_declaration'];

  containerTypes = ['class_declaration', 'object_declaration'];

  declarationTypes = ['property_declaration'];

  functionTypes = ['lambda_literal', 'anonymous_function'];

  shouldExtractChildren(node: Parser.SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(node: Parser.SyntaxNode): boolean {
    if (node.type !== 'property_declaration') return false;
    return (
      findDescendant(node, 'lambda_literal') !== null ||
      findDescendant(node, 'anonymous_function') !== null
    );
  }

  getContainerBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (!this.containerTypes.includes(node.type)) return null;
    return childByType(node, 'class_body') ?? childByType(node, 'enum_class_body');
  }

  shouldTraverseChildren(node: Parser.SyntaxNode): boolean {
    return (
      node.type === 'source_file' ||
      node.type === 'class_body' ||
      node.type === 'enum_class_body' ||
      node.type === 'companion_object'
    );
  }

  findParentContainerName(node: Parser.SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_declaration' || current.type === 'object_declaration') {
        return declarationName(current);
      }
      current = current.parent;
    }
    return undefined;
  }

  findFunctionInDeclaration(node: Parser.SyntaxNode): DeclarationFunctionInfo {
    if (node.type !== 'property_declaration') {
      return { hasFunction: false, functionNode: null };
    }
    const fn = findDescendant(node, 'lambda_literal') ?? findDescendant(node, 'anonymous_function');
    return fn
      ? { hasFunction: true, functionNode: fn }
      : { hasFunction: false, functionNode: null };
  }
}

// =============================================================================
// EXPORT EXTRACTOR
// =============================================================================

/**
 * Kotlin export extractor.
 *
 * Kotlin has no `export` keyword and is `public` by default — top-level
 * declarations and (non-private/internal) members are importable. Interface
 * members are implicitly public.
 */
export class KotlinExportExtractor implements LanguageExportExtractor {
  extractExports(rootNode: Parser.SyntaxNode): string[] {
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

  private extractFromNode(node: Parser.SyntaxNode, addExport: (name?: string) => void): void {
    switch (node.type) {
      case 'function_declaration':
        if (isExported(node)) addExport(functionName(node));
        break;
      case 'property_declaration':
        if (isExported(node)) addExport(this.propertyName(node));
        break;
      case 'class_declaration':
      case 'object_declaration':
        if (isExported(node)) addExport(declarationName(node));
        this.extractMembers(node, addExport);
        break;
    }
  }

  private extractMembers(container: Parser.SyntaxNode, addExport: (name?: string) => void): void {
    const body = childByType(container, 'class_body') ?? childByType(container, 'enum_class_body');
    if (!body) return;

    const isInterface = hasTokenChild(container, 'interface');

    body.namedChildren.forEach(member => {
      if (member.type === 'function_declaration') {
        if (isInterface || isExported(member)) addExport(functionName(member));
      } else if (member.type === 'property_declaration') {
        if (isInterface || isExported(member)) addExport(this.propertyName(member));
      } else if (member.type === 'companion_object') {
        // Companion members are reached via the enclosing class name → part of its API.
        member.namedChildren
          .filter(m => m.type === 'class_body')
          .forEach(cb =>
            cb.namedChildren
              .filter(m => m.type === 'function_declaration' && isExported(m))
              .forEach(m => addExport(functionName(m))),
          );
      }
    });
  }

  private propertyName(node: Parser.SyntaxNode): string | undefined {
    // property_declaration → variable_declaration → simple_identifier
    const variable = childByType(node, 'variable_declaration');
    return (variable ? childByType(variable, 'simple_identifier') : null)?.text;
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/** Kotlin/JVM standard-library prefixes that aren't useful as dependency edges. */
function isKotlinStdLib(importPath: string): boolean {
  return (
    importPath.startsWith('kotlin.') ||
    importPath.startsWith('kotlinx.') ||
    importPath.startsWith('java.') ||
    importPath.startsWith('javax.')
  );
}

/**
 * Kotlin import extractor.
 *
 * Handles `import a.b.C`, wildcard `import a.b.*`, and aliased
 * `import a.b.C as D`. The grammar nests `import_header` nodes inside an
 * `import_list`; the engine's import scan descends one level to reach them
 * (see `collectImportNodes` in ast/symbols.ts). Standard-library imports
 * (kotlin.*, kotlinx.*, java.*, javax.*) are filtered out.
 */
export class KotlinImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['import_header'];

  extractImportPath(node: Parser.SyntaxNode): string | null {
    const path = this.getImportPath(node);
    if (!path || isKotlinStdLib(path)) return null;
    return path;
  }

  processImportSymbols(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    const path = this.getImportPath(node);
    if (!path || isKotlinStdLib(path)) return null;

    const parts = path.split('.');
    const lastPart = parts[parts.length - 1];

    if (lastPart === '*') {
      const packagePath = parts.slice(0, -1).join('.');
      const packageName = parts[parts.length - 2];
      return { importPath: packagePath, symbols: packageName ? [packageName] : [] };
    }

    // `import a.b.C as D` — the imported symbol is the alias name when present.
    // import_alias wraps the alias as a `type_identifier` (its text is `as D`).
    const alias = childByType(node, 'import_alias');
    const aliasName = alias ? childByType(alias, 'type_identifier')?.text : undefined;
    return { importPath: path, symbols: [aliasName ?? lastPart] };
  }

  private getImportPath(node: Parser.SyntaxNode): string | null {
    const identifier = childByType(node, 'identifier');
    if (!identifier) return null;
    const hasWildcard = hasTokenChild(node, 'wildcard_import');
    return hasWildcard ? `${identifier.text}.*` : identifier.text;
  }
}

// =============================================================================
// SYMBOL EXTRACTOR
// =============================================================================

/**
 * Kotlin symbol extractor.
 *
 * Handles `function_declaration`, `class_declaration` (class / interface / enum
 * variants — distinguished by the keyword token), and `object_declaration`.
 * `SymbolInfo.type` only has `function|method|class|interface`, so objects and
 * enums map to `class` (keeping the keyword in the signature).
 *
 * Call sites: `call_expression` — `foo()` (simple_identifier) and `a.b.c()`
 * (the member is the `simple_identifier` inside the trailing `navigation_suffix`).
 */
export class KotlinSymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = ['function_declaration', 'class_declaration', 'object_declaration'];

  extractSymbol(node: Parser.SyntaxNode, content: string, parentClass?: string): SymbolInfo | null {
    switch (node.type) {
      case 'function_declaration':
        return this.extractFunctionInfo(node, content, parentClass);
      case 'class_declaration':
        return this.extractClassInfo(node);
      case 'object_declaration':
        return this.extractObjectInfo(node);
      default:
        return null;
    }
  }

  extractCallSite(node: Parser.SyntaxNode): { symbol: string; line: number; key: string } | null {
    if (node.type !== 'call_expression') return null;
    const line = node.startPosition.row + 1;

    const callee = node.namedChild(0);
    if (!callee) return null;

    let name: string | undefined;
    if (callee.type === 'simple_identifier') {
      name = callee.text; // foo()
    } else if (callee.type === 'navigation_expression') {
      // a.b.c() — the called member is the simple_identifier in the last navigation_suffix
      const suffix = callee.namedChildren.filter(c => c.type === 'navigation_suffix').at(-1);
      name = (suffix ? childByType(suffix, 'simple_identifier') : null)?.text;
    }

    if (!name) return null;
    return { symbol: name, line, key: `${name}:${line}` };
  }

  private extractFunctionInfo(
    node: Parser.SyntaxNode,
    content: string,
    parentClass?: string,
  ): SymbolInfo | null {
    const name = functionName(node);
    if (!name) return null;

    return {
      name,
      type: parentClass ? 'method' : 'function',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: functionSignature(node, content),
      parameters: functionParameters(node),
      returnType: functionReturnType(node),
      complexity: calculateComplexity(node),
    };
  }

  private extractClassInfo(node: Parser.SyntaxNode): SymbolInfo | null {
    const name = declarationName(node);
    if (!name) return null;

    if (hasTokenChild(node, 'interface')) {
      return this.makeSymbol(node, name, 'interface', `interface ${name}`);
    }
    if (hasTokenChild(node, 'enum')) {
      return this.makeSymbol(node, name, 'class', `enum class ${name}`);
    }
    return this.makeSymbol(node, name, 'class', `class ${name}`);
  }

  private extractObjectInfo(node: Parser.SyntaxNode): SymbolInfo | null {
    const name = declarationName(node);
    if (!name) return null;
    return this.makeSymbol(node, name, 'class', `object ${name}`);
  }

  private makeSymbol(
    node: Parser.SyntaxNode,
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

export const kotlinDefinition: LanguageDefinition = {
  id: 'kotlin',
  extensions: ['kt'],
  grammar: Kotlin,
  traverser: new KotlinTraverser(),
  exportExtractor: new KotlinExportExtractor(),
  importExtractor: new KotlinImportExtractor(),
  symbolExtractor: new KotlinSymbolExtractor(),

  complexity: {
    decisionPoints: [
      'if_expression',
      'when_entry',
      'for_statement',
      'while_statement',
      'do_while_statement',
      'catch_block',
      'elvis_expression',
      'conjunction_expression', // &&
      'disjunction_expression', // ||
    ],
    nestingTypes: [
      'if_expression',
      'when_expression',
      'for_statement',
      'while_statement',
      'do_while_statement',
      'catch_block',
      'lambda_literal',
      'anonymous_function',
    ],
    nonNestingTypes: ['when_entry', 'elvis_expression'],
    lambdaTypes: ['lambda_literal', 'anonymous_function'],
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
      '?:',
      '?.',
      '.',
      '::',
      '->',
      '..',
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
      'when',
      'for',
      'while',
      'do',
      'return',
      'break',
      'continue',
      'throw',
      'try',
      'catch',
      'finally',
      'fun',
      'class',
      'object',
      'interface',
      'enum',
      'val',
      'var',
      'is',
      'as',
      'in',
      'by',
      'import',
      'package',
      'override',
      'abstract',
      'open',
      'sealed',
      'data',
      'suspend',
      'companion',
      'private',
      'internal',
      'protected',
      'public',
      'this',
      'super',
      'null',
    ]),
  },

  symbols: {
    callExpressionTypes: ['call_expression'],
  },
};

import type { SymbolInfo, SyntaxNode } from '../types.js';
import type { LanguageDefinition } from './types.js';
import type { LanguageTraverser, DeclarationFunctionInfo } from '../traversers/types.js';
import type {
  LanguageExportExtractor,
  LanguageImportExtractor,
  LanguageSymbolExtractor,
} from '../extractors/types.js';
import { toImportPathsArray, toImportSymbolsArray } from '../extractors/types.js';
import { collapseWhitespace } from '../extractors/symbol-helpers.js';
import { calculateComplexity } from '../complexity/index.js';

// =============================================================================
// HELPERS
//
// The tree-sitter-kotlin grammar (fwcd) does NOT assign field names, so unlike
// the Java definition we locate children by node TYPE rather than via
// `childForFieldName`. These helpers centralize that.
// =============================================================================

/** First named child of a given type. */
function childByType(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.namedChildren.find(child => child.type === type) ?? null;
}

/** Whether a node has a child token of a given type (incl. anonymous keyword tokens). */
function hasTokenChild(node: SyntaxNode, type: string): boolean {
  return node.children.some(child => child.type === type);
}

/**
 * The function-valued initializer of a property, if the property's initializer
 * is *directly* a lambda or anonymous function (`val f = { … }`). Checks the
 * initializer (the last named child) rather than any descendant, so a lambda
 * passed as a call argument (`val n = xs.count { it > 0 }`) is NOT treated as a
 * function-valued property.
 */
function propertyInitializerFunction(node: SyntaxNode): SyntaxNode | null {
  const initializer = node.namedChildren.at(-1);
  if (!initializer) return null;
  return initializer.type === 'lambda_literal' || initializer.type === 'anonymous_function'
    ? initializer
    : null;
}

/** The `function_body` child of a function_declaration ({ … } block OR `= expr`). */
function functionBody(node: SyntaxNode): SyntaxNode | null {
  return childByType(node, 'function_body');
}

/**
 * The function name: the first direct `simple_identifier` child of a
 * function_declaration. (Extension-function receivers are `user_type` nodes, so
 * the bare simple_identifier is the name in the common case.)
 */
function functionName(node: SyntaxNode): string | undefined {
  return childByType(node, 'simple_identifier')?.text;
}

/** The declared name of a class/object declaration (`type_identifier`). */
function declarationName(node: SyntaxNode): string | undefined {
  return childByType(node, 'type_identifier')?.text;
}

/**
 * Generic type parameters and supertype list, exactly as declared in source
 * — the Kotlin analog of C#'s `typeParamsAndBaseList`/Java's
 * `typeParamsAndHeritage` (same underlying bug: `signature` for a class/
 * interface/object reported only its bare keyword and name). Kotlin
 * supertypes are `delegation_specifier` children directly under the
 * class/object declaration (no wrapping node), following a literal `:`
 * token — e.g. `class Foo<T> : Bar<T>(), Baz`. Neither `type_parameters` nor
 * `delegation_specifier` is a registered field (the fwcd grammar assigns
 * none — see the file-level note above), so both are found by node type.
 * Each piece is passed through `collapseWhitespace` in case a supertype
 * list spans multiple physical lines (the same whitespace-collapsing
 * convention `functionSignature` below applies inline).
 */
function typeParamsAndSupertypes(node: SyntaxNode): string {
  const typeParams = collapseWhitespace(childByType(node, 'type_parameters')?.text);
  const supertypes = node.namedChildren.filter(child => child.type === 'delegation_specifier');
  const supertypesText =
    supertypes.length > 0 ? ` : ${supertypes.map(s => collapseWhitespace(s.text)).join(', ')}` : '';
  return `${typeParams}${supertypesText}`;
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
function functionSignature(node: SyntaxNode, content: string): string {
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
function functionParameters(node: SyntaxNode): string[] {
  const params = childByType(node, 'function_value_parameters');
  if (!params) return [];
  return params.namedChildren.filter(p => p.text.trim()).map(p => p.text);
}

/**
 * Return type: the type node that sits between the parameter list and the body.
 * Kotlin's grammar emits it as `user_type` / `nullable_type` / `function_type`.
 */
function functionReturnType(node: SyntaxNode): string | undefined {
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
function visibilityModifier(node: SyntaxNode): string | null {
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
function isExported(node: SyntaxNode): boolean {
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

  shouldExtractChildren(node: SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(node: SyntaxNode): boolean {
    return node.type === 'property_declaration' && propertyInitializerFunction(node) !== null;
  }

  getContainerBody(node: SyntaxNode): SyntaxNode | null {
    if (!this.containerTypes.includes(node.type)) return null;
    return childByType(node, 'class_body') ?? childByType(node, 'enum_class_body');
  }

  shouldTraverseChildren(node: SyntaxNode): boolean {
    return (
      node.type === 'source_file' ||
      node.type === 'class_body' ||
      node.type === 'enum_class_body' ||
      node.type === 'companion_object'
    );
  }

  findParentContainerName(node: SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_declaration' || current.type === 'object_declaration') {
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
 * Kotlin export extractor.
 *
 * Kotlin has no `export` keyword and is `public` by default — top-level
 * declarations and (non-private/internal) members are importable. Interface
 * members are implicitly public.
 */
export class KotlinExportExtractor implements LanguageExportExtractor {
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
        if (isExported(node)) addExport(functionName(node));
        break;
      case 'property_declaration':
        if (isExported(node)) addExport(this.propertyName(node));
        break;
      case 'class_declaration':
      case 'object_declaration':
        // A private/internal container exposes nothing — skip it and its members.
        if (isExported(node)) {
          addExport(declarationName(node));
          this.extractMembers(node, addExport);
        }
        break;
    }
  }

  private extractMembers(container: SyntaxNode, addExport: (name?: string) => void): void {
    const body = childByType(container, 'class_body') ?? childByType(container, 'enum_class_body');
    if (!body) return;

    // `isExported`'s "public unless explicitly private/internal" rule already
    // matches interface-member visibility exactly (Kotlin interface members
    // support only `public` (implicit or explicit) and `private` — Kotlin 1.4+
    // allows `private` helper functions backing a default implementation), so
    // no separate interface bypass is needed here (#974 — Java's and this
    // file's prior `isInterface ||` bypass unconditionally exported every
    // interface member, including explicitly `private` ones).
    body.namedChildren.forEach(member => {
      if (member.type === 'function_declaration') {
        if (isExported(member)) addExport(functionName(member));
      } else if (member.type === 'property_declaration') {
        if (isExported(member)) addExport(this.propertyName(member));
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

  private propertyName(node: SyntaxNode): string | undefined {
    // property_declaration → variable_declaration → simple_identifier
    const variable = childByType(node, 'variable_declaration');
    return (variable ? childByType(variable, 'simple_identifier') : null)?.text;
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/**
 * Kotlin/JVM standard-library prefixes that aren't useful as dependency edges.
 * Note: `kotlinx.*` (coroutines, serialization, …) are separate external
 * libraries, not the stdlib, so they are kept as real import edges.
 */
function isKotlinStdLib(importPath: string): boolean {
  return (
    importPath.startsWith('kotlin.') ||
    importPath.startsWith('java.') ||
    importPath.startsWith('javax.')
  );
}

/**
 * Strip a trailing wildcard segment (`.*`) from a dotted import path. See the
 * identical helper (and its full rationale) in `java.ts`: a literal `.*`
 * suffix never satisfies `matchesPythonModule`'s dotted-identifier check in
 * path-matching.ts, so `extractImportPath` — whose output feeds
 * `chunk.metadata.imports`, the source that matching reads — must return the
 * clean package path (already computed separately by `processImportSymbols`)
 * instead of the unmatchable wildcard-suffixed string.
 */
function stripWildcardSuffix(path: string): string {
  return path.endsWith('.*') ? path.slice(0, -2) : path;
}

/**
 * Kotlin import extractor.
 *
 * Handles `import a.b.C`, wildcard `import a.b.*`, and aliased
 * `import a.b.C as D`. The grammar nests `import_header` nodes inside an
 * `import_list`; the engine's import scan descends one level to reach them
 * (see `collectImportNodes` in ast/symbols.ts). Standard-library imports
 * (kotlin.*, kotlinx.*, java.*, javax.*) are filtered out.
 *
 * `extractImportPaths` has no analogue of Java's `staticMemberClassPath`
 * fallback (#864): a top-level function/property import (`import
 * a.b.myFunction`, defined in an arbitrarily-named file within package
 * `a.b`) and a class/object-member import (`import a.b.MyObject.method`)
 * parse to the identical shape — a flat `identifier` of `simple_identifier`
 * segments with no distinguishing marker (verified empirically: no
 * `static`-equivalent keyword, no different node type). Java's fix works
 * because the `static` keyword's presence is itself the syntactic proof that
 * the trailing segment is a class member/nested type, not a package
 * component. Without an equivalent marker here, dropping the trailing
 * segment can't be told apart from truncating a genuine top-level
 * declaration down to a bare package directory (a many-files fan-out, the
 * same false-positive shape #868 warned against) — so this stays an honest,
 * undetermined gap rather than a guess.
 */
export class KotlinImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['import_header'];

  extractImportPath(node: SyntaxNode): string | null {
    const path = this.getImportPath(node);
    if (!path || isKotlinStdLib(path)) return null;
    return stripWildcardSuffix(path);
  }

  extractImportPaths(node: SyntaxNode): string[] {
    return toImportPathsArray(this.extractImportPath(node));
  }

  processImportSymbols(node: SyntaxNode): { importPath: string; symbols: string[] } | null {
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

  processImportSymbolsList(node: SyntaxNode): Array<{ importPath: string; symbols: string[] }> {
    return toImportSymbolsArray(this.processImportSymbols(node));
  }

  private getImportPath(node: SyntaxNode): string | null {
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

  extractSymbol(node: SyntaxNode, content: string, parentClass?: string): SymbolInfo | null {
    switch (node.type) {
      case 'function_declaration':
        return this.extractFunctionInfo(node, content, parentClass);
      case 'class_declaration':
        return this.extractClassInfo(node, parentClass);
      case 'object_declaration':
        return this.extractObjectInfo(node, parentClass);
      default:
        return null;
    }
  }

  extractCallSite(node: SyntaxNode): { symbol: string; line: number; key: string } | null {
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
    node: SyntaxNode,
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

  /**
   * `parentClass` is threaded through so a nested/inner class or object —
   * idiomatic in Kotlin (`class Outer { class Nested { ... } }`,
   * `class Outer { inner class Inner { ... } }`) — reports its enclosing
   * type. `KotlinTraverser.findParentContainerName` already resolves this for
   * every top-level node, not just functions (#949).
   */
  private extractClassInfo(node: SyntaxNode, parentClass?: string): SymbolInfo | null {
    const name = declarationName(node);
    if (!name) return null;
    const suffix = typeParamsAndSupertypes(node);

    if (hasTokenChild(node, 'interface')) {
      return this.makeSymbol(
        node,
        name,
        'interface',
        clamp(`interface ${name}${suffix}`),
        parentClass,
      );
    }
    if (hasTokenChild(node, 'enum')) {
      return this.makeSymbol(
        node,
        name,
        'class',
        clamp(`enum class ${name}${suffix}`),
        parentClass,
      );
    }
    return this.makeSymbol(node, name, 'class', clamp(`class ${name}${suffix}`), parentClass);
  }

  private extractObjectInfo(node: SyntaxNode, parentClass?: string): SymbolInfo | null {
    const name = declarationName(node);
    if (!name) return null;
    return this.makeSymbol(
      node,
      name,
      'class',
      clamp(`object ${name}${typeParamsAndSupertypes(node)}`),
      parentClass,
    );
  }

  private makeSymbol(
    node: SyntaxNode,
    name: string,
    type: SymbolInfo['type'],
    signature: string,
    parentClass?: string,
  ): SymbolInfo {
    return {
      name,
      type,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
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
  traverser: new KotlinTraverser(),
  exportExtractor: new KotlinExportExtractor(),
  importExtractor: new KotlinImportExtractor(),
  symbolExtractor: new KotlinSymbolExtractor(),

  // ADR-015 (#1038): verified against a real corpus (klaxon).
  // `wholeModuleImports: false`: Kotlin's cross-package imports name a
  // precise class or sub-package, never a whole-module-only shape --
  // confirmed with real cross-package imports (unlike javapoet's flat
  // layout, klaxon genuinely has sub-packages): `JsonObjectConverter.kt:3`'s
  // `import com.beust.klaxon.internal.firstNotNullResult` and
  // `StateMachine.kt:3-4`'s `import com.beust.klaxon.token.Token` both
  // resolve to real directories (`com/beust/klaxon/internal/`,
  // `com/beust/klaxon/token/`, confirmed on disk). Note this is orthogonal to
  // #1005's Mechanism 2 (`sameUnitAccessWithoutImport` below,
  // same-package-with-no-import-at-all -- resolved by
  // `../../jvm-same-package-signals.ts`, Phase 1 of #1005's fix; no longer
  // out of scope) -- these three matcher-path fields are unaffected either
  // way, since Mechanism 1's fix (#1046 -- Kotlin's dotted specifiers, like
  // Java's, now resolve to a concrete slash path UPSTREAM of `matchesFile`,
  // via `../../jvm-source-root.ts`) doesn't touch any of the three flags
  // below.
  wholeModuleImports: false,
  // `singleFileImports: false`: inapplicable, not merely unconfirmed --
  // `KotlinImportExtractor` stores the raw DOTTED path (mirrors Java's
  // `JavaImportExtractor`). #1046 resolves that dotted path to a concrete
  // slash path BEFORE it ever reaches `matchesFile` (see `wholeModuleImports`'s
  // comment just above), and the resolved path is an exact match for its own
  // real target -- so it never needs this flag's multi-segment leniency
  // either. An unresolved (still-dotted) specifier still never reaches this
  // branch at all.
  singleFileImports: false,
  // `namespaceStyleImports: false`: Kotlin package/directory mirroring is
  // case-sensitive, confirmed exact-case in this corpus
  // (`com.beust.klaxon.token` -> `com/beust/klaxon/token/`); no PSR-4-style
  // convention.
  namespaceStyleImports: false,

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

  // #1005: JVM same-package visibility lets real Kotlin callers reach a
  // file's declarations with zero `import` statements (Klaxon's 104 files
  // sit in one package with 0 recorded edges) -- the same underlying fact
  // `samePackageTestConvention` documents for Java, but that flag is scoped
  // to TEST association specifically, and Kotlin doesn't set it here: Phase 2
  // (Item 2) DOES now recover Kotlin's same-package test convention, but via
  // its own separate, CONTENT-derived mechanism
  // (`test-associations.ts`'s `collectKotlinSamePackageTests`, gated on
  // `detectLanguage(filepath) === 'kotlin'` directly), not by wiring this
  // registry flag -- Java's PATH-derived `samePackageTestConvention`
  // mechanism (`java-same-package-tests.ts`) is hard-coded to the
  // `src/<sourceSet>/java/` Standard Directory Layout marker and is
  // Kotlin-blind by construction, so setting this flag for Kotlin would be a
  // no-op, not a second real mechanism. See
  // `LanguageDefinition.sameUnitAccessWithoutImport`'s doc comment for what
  // THIS flag covers (dependency edges, not test association).
  sameUnitAccessWithoutImport: true,
};

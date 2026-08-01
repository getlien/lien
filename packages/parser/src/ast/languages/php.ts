import type { SymbolInfo, SyntaxNode } from '../types.js';
import type { LanguageDefinition } from './types.js';
import type { LanguageTraverser, DeclarationFunctionInfo } from '../traversers/types.js';
import type {
  LanguageExportExtractor,
  LanguageImportExtractor,
  LanguageSymbolExtractor,
} from '../extractors/types.js';
import { toImportPathsArray, toImportSymbolsArray } from '../extractors/types.js';
import {
  extractSignature,
  extractParameters,
  extractReturnType,
  clampSignatureLength,
  collapseWhitespace,
} from '../extractors/symbol-helpers.js';
import { calculateComplexity } from '../complexity/index.js';

// =============================================================================
// TRAVERSER
// =============================================================================

/**
 * PHP AST traverser
 *
 * Handles PHP AST node types and traversal patterns.
 * PHP uses tree-sitter-php grammar.
 */
export class PHPTraverser implements LanguageTraverser {
  targetNodeTypes = [
    'function_definition', // function foo() {}
    'method_declaration', // public function bar() {}
  ];

  containerTypes = [
    'class_declaration', // We extract methods, not the class itself
    'trait_declaration', // PHP traits
    'interface_declaration', // PHP interfaces (for interface methods)
  ];

  declarationTypes: string[] = [];

  functionTypes = ['function_definition', 'method_declaration'];

  shouldExtractChildren(node: SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(_node: SyntaxNode): boolean {
    return false;
  }

  getContainerBody(node: SyntaxNode): SyntaxNode | null {
    if (
      node.type === 'class_declaration' ||
      node.type === 'trait_declaration' ||
      node.type === 'interface_declaration'
    ) {
      return node.childForFieldName('body');
    }
    return null;
  }

  shouldTraverseChildren(node: SyntaxNode): boolean {
    return node.type === 'program' || node.type === 'php' || node.type === 'declaration_list';
  }

  findParentContainerName(node: SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_declaration' || current.type === 'trait_declaration') {
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
 * PHP export extractor
 *
 * PHP doesn't have explicit export syntax. All top-level declarations are
 * considered exported (accessible via `use` statements):
 * - Classes: class User {}
 * - Traits: trait HasTimestamps {}
 * - Interfaces: interface Repository {}
 * - Functions: function helper() {}
 * - Namespaced declarations are also tracked
 */
export class PHPExportExtractor implements LanguageExportExtractor {
  private readonly exportableTypes = new Set([
    'class_declaration',
    'trait_declaration',
    'interface_declaration',
    'function_definition',
  ]);

  extractExports(rootNode: SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();

    rootNode.namedChildren.forEach(child => {
      const childExports = this.extractExportsFromNode(child);
      childExports.forEach(exp => {
        if (exp && !seen.has(exp)) {
          seen.add(exp);
          exports.push(exp);
        }
      });
    });

    return exports;
  }

  private extractExportsFromNode(node: SyntaxNode): string[] {
    if (node.type === 'namespace_definition') {
      return this.extractExportsFromNamespace(node);
    }

    const name = this.extractExportableDeclaration(node);
    return name ? [name] : [];
  }

  private extractExportsFromNamespace(node: SyntaxNode): string[] {
    const body = node.childForFieldName('body');
    if (!body) return [];

    return body.namedChildren
      .map(child => this.extractExportableDeclaration(child))
      .filter((name): name is string => name !== null);
  }

  private extractExportableDeclaration(node: SyntaxNode): string | null {
    if (this.exportableTypes.has(node.type)) {
      const nameNode = node.childForFieldName('name');
      return nameNode ? nameNode.text : null;
    }

    return null;
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/**
 * PHP import extractor
 *
 * Handles:
 * - use App\Models\User;
 * - use App\Services\AuthService as Auth;
 * - use App\Models\{User, Post as PostModel};   (grouped use, PHP 7+ — see
 *   `firstGroupedTarget` for why only the first item is captured)
 */
export class PHPImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['namespace_use_declaration'];

  extractImportPath(node: SyntaxNode): string | null {
    return this.extractPHPUseDeclarationPath(node);
  }

  extractImportPaths(node: SyntaxNode): string[] {
    return toImportPathsArray(this.extractImportPath(node));
  }

  processImportSymbols(node: SyntaxNode): { importPath: string; symbols: string[] } | null {
    for (const clause of node.namedChildren) {
      if (clause.type !== 'namespace_use_clause') continue;

      const fullPath = this.extractPHPQualifiedName(clause);
      if (!fullPath) continue;

      // Check for alias (use App\Models\User as U)
      const directNames = clause.namedChildren.filter(c => c.type === 'name');
      let symbol: string;
      if (directNames.length > 0) {
        symbol = directNames[directNames.length - 1].text;
      } else {
        const parts = fullPath.split('\\');
        symbol = parts[parts.length - 1];
      }

      return { importPath: fullPath, symbols: [symbol] };
    }

    const grouped = this.firstGroupedTarget(node);
    return grouped ? { importPath: grouped.importPath, symbols: [grouped.alias] } : null;
  }

  processImportSymbolsList(node: SyntaxNode): Array<{ importPath: string; symbols: string[] }> {
    return toImportSymbolsArray(this.processImportSymbols(node));
  }

  /**
   * Scan the WHOLE file (recursively — unlike declaration-based extraction,
   * which only looks at top-level `namespace_use_declaration` nodes) for
   * fully-qualified class-name references that never go through a `use`
   * statement at all. Partially addresses #878 — direct fully-qualified
   * references only (see below for what's still open): a test can
   * genuinely exercise a source class via a direct FQCN (`new
   * \GuzzleHttp\RetryMiddleware()`, `\GuzzleHttp\RetryMiddleware::class`)
   * with zero corresponding import declaration for `use`-based extraction to
   * find.
   *
   * Only three PHP expression shapes are considered, and only when their
   * class-name part is a `qualified_name` node whose own text starts with a
   * leading `\` (i.e. genuinely fully-qualified, resolved absolutely
   * regardless of any `use` imports in scope — see
   * `isFullyQualifiedReference`'s doc comment for why this is the
   * unambiguous case, unlike a bare or merely-"qualified" name):
   * - `new \Foo\Bar\Baz(...)` (`object_creation_expression`)
   * - `\Foo\Bar\Baz::class` / `\Foo\Bar\Baz::SOME_CONST` (`class_constant_access_expression`)
   * - `\Foo\Bar\Baz::method()` (`scoped_call_expression`)
   *
   * Deliberately does NOT attempt the transitive "factory hides the FQCN in
   * a different file" shape (e.g. `Middleware::retry()` from a *test* file,
   * where `RetryMiddleware` is only named inside `Middleware.php`, never in
   * the test itself) — that needs graph-level reasoning across files, well
   * beyond a single-file structural scan. That factory-indirection case has
   * no signal available at this layer and is unresolvable here; it stays an
   * honest, documented, still-open remainder of #878, not something this
   * method claims to handle.
   */
  extractReferencedFQCNs(rootNode: SyntaxNode): string[] {
    const refs: string[] = [];
    const seen = new Set<string>();

    const visit = (node: SyntaxNode): void => {
      const fqcn = this.extractFQCNReference(node);
      if (fqcn && !seen.has(fqcn)) {
        seen.add(fqcn);
        refs.push(fqcn);
      }
      node.namedChildren.forEach(visit);
    };
    visit(rootNode);

    return refs;
  }

  private static readonly FQCN_REFERENCE_NODE_TYPES = new Set([
    'object_creation_expression',
    'class_constant_access_expression',
    'scoped_call_expression',
  ]);

  private extractFQCNReference(node: SyntaxNode): string | null {
    if (!PHPImportExtractor.FQCN_REFERENCE_NODE_TYPES.has(node.type)) return null;

    const classPart = node.namedChildren.find(child => child.type === 'qualified_name');
    if (!classPart || !this.isFullyQualifiedReference(classPart)) return null;

    const parts = this.extractQualifiedNameParts(classPart);
    // Require an actual namespace segment (>= 2 parts). A fully-qualified
    // SINGLE-segment name (`\DateTime`, `\Exception`) always names a PHP
    // built-in or global-namespace class, never a Composer-autoloaded
    // project file under a PSR-4 vendor prefix -- so it can't correspond to
    // a real source file and would only ever risk exercising the bare-
    // identifier ambiguity #868/#883 guard against, for zero possible gain.
    return parts.length > 1 ? parts.join('\\') : null;
  }

  /**
   * True when `qualifiedName` (a `qualified_name` node) is FULLY qualified —
   * its own source text starts with a leading `\`. PHP resolves such a name
   * absolutely, ignoring any `use` imports in scope, so it is unambiguous
   * proof the file names that exact class.
   *
   * A `qualified_name` WITHOUT the leading `\` (e.g. `Foo\Bar` inside `use
   * Foo\Bar::method()`) is merely "qualified": PHP resolves it relative to
   * the current namespace, or via an imported alias for its first segment —
   * genuinely ambiguous without cross-referencing the file's own namespace
   * and `use` imports. Treating it as a reference here would risk exactly
   * the false-positive shape #868/#883 guard against, so it's excluded.
   *
   * `qualified_name`'s own child structure (`namespace_name` + `name`) is
   * IDENTICAL whether or not the leading `\` is present — the marker exists
   * only in the node's own text span, not as a separate child — so this
   * checks `.text` directly rather than inspecting children.
   */
  private isFullyQualifiedReference(qualifiedName: SyntaxNode): boolean {
    return qualifiedName.text.startsWith('\\');
  }

  private extractPHPUseDeclarationPath(node: SyntaxNode): string | null {
    const clause = node.namedChildren.find(child => child.type === 'namespace_use_clause');
    if (clause) return this.extractPHPQualifiedName(clause);
    return this.firstGroupedTarget(node)?.importPath ?? null;
  }

  /**
   * First target of a grouped use declaration's `namespace_use_group`
   * (`use App\Models\{User, Post as PostModel};`). tree-sitter-php parses
   * this shape as a `namespace_name` prefix sibling (`App\Models`) plus a
   * `namespace_use_group` holding one `namespace_use_clause` per item — not
   * the `namespace_use_clause` (with a `qualified_name` child) that the
   * simple/aliased form above handles, so it was previously invisible to
   * both `extractImportPath` and `processImportSymbols` (returned null for
   * the *whole* declaration, dropping every item in the group).
   *
   * Each item targets a different file under PSR-4's one-class-per-file
   * convention (unlike Rust's `use path::{A, B}`, where A and B share one
   * module/file) — so, mirroring `GoImportExtractor`'s existing "first wins"
   * precedent for its own multi-target grouped imports, this surfaces the
   * first item rather than continuing to drop the whole statement. Full
   * multi-target support needs a broader change (see the "grouped imports"
   * tracking issue) since `extractImportPath` returns one path per node.
   */
  private firstGroupedTarget(node: SyntaxNode): { importPath: string; alias: string } | null {
    const group = node.namedChildren.find(child => child.type === 'namespace_use_group');
    if (!group) return null;

    const firstClause = group.namedChildren.find(child => child.type === 'namespace_use_clause');
    if (!firstClause) return null;

    const names = firstClause.namedChildren.filter(child => child.type === 'name');
    if (names.length === 0) return null;

    const importedName = names[0].text;
    const alias = names.length > 1 ? names[names.length - 1].text : importedName;
    const prefix = this.extractNamespacePrefix(node);
    const importPath = prefix ? `${prefix}\\${importedName}` : importedName;

    return { importPath, alias };
  }

  private extractNamespacePrefix(node: SyntaxNode): string | null {
    const namespaceName = node.namedChildren.find(child => child.type === 'namespace_name');
    if (!namespaceName) return null;
    const parts = this.extractNamespaceParts(namespaceName);
    return parts.length > 0 ? parts.join('\\') : null;
  }

  private extractNamespaceParts(namespaceNode: SyntaxNode): string[] {
    return namespaceNode.namedChildren
      .filter(child => child.type === 'name')
      .map(child => child.text);
  }

  private extractQualifiedNameParts(qualifiedName: SyntaxNode): string[] {
    return qualifiedName.namedChildren.flatMap(part => {
      if (part.type === 'namespace_name') return this.extractNamespaceParts(part);
      if (part.type === 'name') return [part.text];
      return [];
    });
  }

  private extractPHPQualifiedName(clause: SyntaxNode): string | null {
    const qualifiedName = clause.namedChildren.find(child => child.type === 'qualified_name');
    if (!qualifiedName) return null;
    return this.extractQualifiedNameParts(qualifiedName).join('\\');
  }
}

// =============================================================================
// SYMBOL EXTRACTOR
// =============================================================================

/**
 * PHP symbol extractor
 *
 * Handles:
 * - function_definition (function foo() {})
 * - method_declaration (public function bar() {})
 * - class_declaration (class Foo {})
 *
 * Call sites: function_call_expression, member_call_expression, scoped_call_expression
 */
export class PHPSymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = ['function_definition', 'method_declaration', 'class_declaration'];

  extractSymbol(node: SyntaxNode, content: string, parentClass?: string): SymbolInfo | null {
    switch (node.type) {
      case 'function_definition':
        return this.extractFunctionInfo(node, content, parentClass);
      case 'method_declaration':
        return this.extractMethodInfo(node, content, parentClass);
      case 'class_declaration':
        return this.extractClassInfo(node);
      default:
        return null;
    }
  }

  extractCallSite(node: SyntaxNode): { symbol: string; line: number; key: string } | null {
    const line = node.startPosition.row + 1;

    // function_call_expression - helper_function()
    if (node.type === 'function_call_expression') {
      const funcNode = node.childForFieldName('function');
      if (funcNode?.type === 'name') {
        return { symbol: funcNode.text, line, key: `${funcNode.text}:${line}` };
      }
    }

    // member_call_expression - $this->method() or $obj->method()
    if (node.type === 'member_call_expression') {
      const nameNode = node.childForFieldName('name');
      if (nameNode?.type === 'name') {
        return { symbol: nameNode.text, line, key: `${nameNode.text}:${line}` };
      }
    }

    // scoped_call_expression - User::find() or static::method()
    if (node.type === 'scoped_call_expression') {
      const nameNode = node.childForFieldName('name');
      if (nameNode?.type === 'name') {
        return { symbol: nameNode.text, line, key: `${nameNode.text}:${line}` };
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
      returnType: extractReturnType(node, content),
      complexity: calculateComplexity(node),
    };
  }

  private extractMethodInfo(
    node: SyntaxNode,
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

  private extractClassInfo(node: SyntaxNode): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: clampSignatureLength(`class ${nameNode.text}${heritageClause(node)}`),
    };
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extends/implements heritage clause, exactly as declared in source — the
 * PHP analog of C#'s `typeParamsAndBaseList`/Java's `typeParamsAndHeritage`
 * (same underlying bug: `signature` for a class reported only its bare
 * keyword and name, dropping `extends Animal implements Serializable`
 * entirely — #976, #965 recurring). PHP has no generic type parameters, so
 * unlike the C#/Java/Kotlin/Swift/JS analogs this only extracts the
 * heritage half. Neither `base_clause` (single class, `extends Animal`) nor
 * `class_interface_clause` (`implements Serializable, ...`) is a registered
 * grammar field on `class_declaration` (only `name`/`body`/`attributes`
 * are), so both are found by scanning `namedChildren`, mirroring C#/Java's
 * fallback-scan case.
 *
 * Whitespace is collapsed to a single line (matching `extractSignature`'s
 * convention, see `collapseWhitespace`) in case either clause spans
 * multiple physical lines.
 */
function heritageClause(node: SyntaxNode): string {
  const baseClause = collapseWhitespace(
    node.namedChildren.find(child => child.type === 'base_clause')?.text,
  );
  const interfaceClause = collapseWhitespace(
    node.namedChildren.find(child => child.type === 'class_interface_clause')?.text,
  );
  const heritage = [baseClause, interfaceClause].filter(Boolean).join(' ');
  return heritage ? ` ${heritage}` : '';
}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const phpDefinition: LanguageDefinition = {
  id: 'php',
  extensions: ['php'],
  traverser: new PHPTraverser(),
  exportExtractor: new PHPExportExtractor(),
  importExtractor: new PHPImportExtractor(),
  symbolExtractor: new PHPSymbolExtractor(),

  // PSR-4 namespaces are case-insensitive and directory-mirroring -- the one
  // language `matchesFile`'s Strategy 4 (`matchesPHPNamespace`) is a real
  // semantic for, not an incidental leniency. See `LanguageDefinition.namespaceStyleImports`'s
  // doc comment (#1028) for the Rust false-positive this flag now excludes.
  // Re-verified (ADR-015, #1038) against monolog: `composer.json:57` maps
  // `"Monolog\\": "src/Monolog"` and `Logger.php:12` declares
  // `namespace Monolog;` -- this particular corpus's own case happens to
  // match exactly (unlike the canonical Laravel `App\` vs. `app/` example
  // this flag's doc comment cites), but PSR-4 is case-insensitive BY SPEC
  // regardless of whether any one corpus's names happen to collide, so this
  // stays `true`.
  namespaceStyleImports: true,
  // ADR-015 (#1038): the other two matcher-path fields, declared for PHP for
  // the first time (previously silently unset, i.e. effectively false).
  // `wholeModuleImports: false`: PHP's `use` statements resolve to a precise
  // file via Strategy 4's own dedicated namespace-to-path mapping (above),
  // not a whole-module-unresolvable shape.
  wholeModuleImports: false,
  // `singleFileImports: false`: preserves the permissive default. PHP's
  // normalized (backslash to forward-slash) `use` specifiers usually end in
  // a class name (`use Monolog\Handler\HandlerInterface;`, `Logger.php:17`,
  // mapping to exactly one file), which would arguably also satisfy a
  // single-file semantic if Strategies 1/2 were ever reached for a
  // case-matching PHP import -- but Strategy 4 is PHP's real, primary
  // resolution mechanism, and there is no confirmed case today where
  // Strategies 1/2's interior-hit leniency produces a wrong match for PHP,
  // so this is left `false` (no behavior change) rather than speculatively
  // tightened.
  singleFileImports: false,

  complexity: {
    decisionPoints: [
      'if_statement',
      'while_statement',
      'for_statement',
      'switch_case',
      'catch_clause',
      'ternary_expression',
      'binary_expression',
      'foreach_statement',
    ],
    nestingTypes: [
      'if_statement',
      'for_statement',
      'while_statement',
      'switch_statement',
      'catch_clause',
      'do_statement',
      'foreach_statement',
      'match_statement',
    ],
    nonNestingTypes: ['else_clause', 'ternary_expression'],
    lambdaTypes: [],
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
      '<>',
      '<',
      '>',
      '<=',
      '>=',
      '<=>',
      '&&',
      '||',
      '!',
      'and',
      'or',
      'xor',
      '=',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
      '**=',
      '.=',
      '&=',
      '|=',
      '^=',
      '<<=',
      '>>=',
      '??=',
      '&',
      '|',
      '^',
      '~',
      '<<',
      '>>',
      '.',
      '?',
      ':',
      '::',
      '->',
      '=>',
      '??',
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
      'elseif',
      'else',
      'for',
      'foreach',
      'while',
      'do',
      'switch',
      'case',
      'default',
      'match',
      'return',
      'throw',
      'try',
      'catch',
      'finally',
      'new',
      'clone',
      'instanceof',
      'yield',
      'break',
      'continue',
      'function',
      'class',
      'extends',
      'implements',
      'trait',
      'interface',
      'use',
      'namespace',
      'as',
      'echo',
      'print',
      'include',
      'require',
      'include_once',
      'require_once',
      'global',
      'static',
      'const',
      'public',
      'private',
      'protected',
      'readonly',
    ]),
  },

  symbols: {
    callExpressionTypes: [
      'function_call_expression',
      'member_call_expression',
      'scoped_call_expression',
    ],
  },
};

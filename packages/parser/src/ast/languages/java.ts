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
  clampSignatureLength,
  collapseWhitespace,
} from '../extractors/symbol-helpers.js';
import { calculateComplexity } from '../complexity/index.js';

// =============================================================================
// TRAVERSER
// =============================================================================

/**
 * Java AST traverser
 *
 * Java has a class-based container structure — methods live inside class,
 * interface, enum, and record declarations. Unlike Go's flat structure,
 * Java requires container traversal to find methods.
 *
 * Lambda expressions can appear in variable declarations:
 *   Runnable r = () -> { ... };
 */
export class JavaTraverser implements LanguageTraverser {
  targetNodeTypes = ['method_declaration', 'constructor_declaration'];

  containerTypes = [
    'class_declaration',
    'interface_declaration',
    'enum_declaration',
    'record_declaration',
  ];

  declarationTypes = ['local_variable_declaration'];

  functionTypes = ['lambda_expression'];

  shouldExtractChildren(node: SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(node: SyntaxNode): boolean {
    if (node.type !== 'local_variable_declaration') return false;
    return findDescendant(node, 'lambda_expression') !== null;
  }

  getContainerBody(node: SyntaxNode): SyntaxNode | null {
    if (this.containerTypes.includes(node.type)) {
      return node.childForFieldName('body');
    }
    return null;
  }

  shouldTraverseChildren(node: SyntaxNode): boolean {
    return (
      node.type === 'program' ||
      node.type === 'class_body' ||
      node.type === 'interface_body' ||
      node.type === 'enum_body'
    );
  }

  findParentContainerName(node: SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (
        current.type === 'class_declaration' ||
        current.type === 'interface_declaration' ||
        current.type === 'enum_declaration' ||
        current.type === 'record_declaration'
      ) {
        const nameNode = current.childForFieldName('name');
        return nameNode?.text;
      }
      current = current.parent;
    }
    return undefined;
  }

  findFunctionInDeclaration(node: SyntaxNode): DeclarationFunctionInfo {
    if (node.type !== 'local_variable_declaration') {
      return { hasFunction: false, functionNode: null };
    }
    const lambda = findDescendant(node, 'lambda_expression');
    return lambda
      ? { hasFunction: true, functionNode: lambda }
      : { hasFunction: false, functionNode: null };
  }
}

// =============================================================================
// EXPORT EXTRACTOR
// =============================================================================

/**
 * Java export extractor
 *
 * Java uses the `public` modifier for visibility — public declarations are
 * accessible outside the package (similar to Rust's `pub`).
 *
 * Exportable items:
 * - public class User {}
 * - public interface Repository {}
 * - public enum Status {}
 * - public record Point(int x, int y) {}
 * - public void method() {}   (inside a class)
 * - Interface methods are implicitly public
 *
 * Package-private (default access) declarations are NOT exported.
 */
export class JavaExportExtractor implements LanguageExportExtractor {
  extractExports(rootNode: SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();

    const addExport = (name: string) => {
      if (name && !seen.has(name)) {
        seen.add(name);
        exports.push(name);
      }
    };

    rootNode.namedChildren.forEach(child => this.extractFromNode(child, addExport));

    return exports;
  }

  private extractFromNode(node: SyntaxNode, addExport: (name: string) => void): void {
    switch (node.type) {
      case 'class_declaration':
      case 'interface_declaration':
      case 'enum_declaration':
      case 'record_declaration': {
        if (hasPublicModifier(node)) {
          const nameNode = node.childForFieldName('name');
          if (nameNode) addExport(nameNode.text);
        }
        this.extractPublicMembers(node, addExport);
        break;
      }
    }
  }

  private extractPublicMembers(container: SyntaxNode, addExport: (name: string) => void): void {
    const body = container.childForFieldName('body');
    if (!body) return;

    const isInterface = container.type === 'interface_declaration';

    body.namedChildren.forEach(child => this.extractMemberExport(child, isInterface, addExport));
  }

  private extractMemberExport(
    member: SyntaxNode,
    isInterface: boolean,
    addExport: (name: string) => void,
  ): void {
    if (member.type === 'method_declaration' || member.type === 'constructor_declaration') {
      // Interface members without explicit modifiers are implicitly public.
      // Java 9+ allows private interface methods (helpers for `default` methods)
      // — only export those that are public or have no explicit visibility
      // modifier (#974).
      const isImplicitlyPublic = isInterface && !hasExplicitAccessModifier(member);
      if (isImplicitlyPublic || hasPublicModifier(member)) {
        const nameNode = member.childForFieldName('name');
        if (nameNode) addExport(nameNode.text);
      }
      return;
    }

    if (member.type === 'field_declaration' && hasPublicModifier(member)) {
      this.extractFieldNames(member, addExport);
    }
  }

  private extractFieldNames(fieldDecl: SyntaxNode, addExport: (name: string) => void): void {
    fieldDecl.namedChildren
      .filter(child => child.type === 'variable_declarator')
      .forEach(child => {
        const nameNode = child.childForFieldName('name');
        if (nameNode) addExport(nameNode.text);
      });
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/**
 * Check if a Java import path is a standard library package.
 * Standard library packages start with java. or javax.
 */
function isJavaStdLib(importPath: string): boolean {
  return importPath.startsWith('java.') || importPath.startsWith('javax.');
}

/**
 * Strip a trailing wildcard segment (`.*`) from a dotted import path.
 * `getImportPath` appends `.*` to mark wildcard imports (consumed below by
 * `processImportSymbols`'s package/symbol split), but a literal `.*` suffix
 * never satisfies `matchesPythonModule`'s dotted-identifier check in
 * path-matching.ts — the regex requires every segment to look like an
 * identifier, so it never matches an asterisk. That means a raw `com.example.*`
 * can never resolve to a test association or dependent for anything in
 * `com/example/`. `extractImportPath` feeds `chunk.metadata.imports` (the
 * source that matching reads), so it must return the clean package path —
 * the same one `processImportSymbols` already computes — instead of the
 * unmatchable wildcard-suffixed string.
 */
function stripWildcardSuffix(path: string): string {
  return path.endsWith('.*') ? path.slice(0, -2) : path;
}

/**
 * For `import static a.b.ClassName.member;` (specific, non-wildcard), the
 * path `extractImportPath` returns is one segment deeper than the file that
 * defines it — the file is named after `ClassName`, not the trailing
 * `member` (#864). Java requires every top-level type to live in a file
 * named after it, and nested types/members always live inside their
 * enclosing top-level type's file, so dropping the trailing segment always
 * yields that type's correct FQN — whether the trailing segment names a
 * static member (the common case) or a nested class
 * (`import static a.B.Inner;`, where `Inner` is itself a type — dropping
 * still resolves to `a.B`'s file, correct by the same rule). This can only
 * under-match silently (a static import reaching two-plus levels into
 * nested classes, e.g. `a.Outer.Middle.member`, where dropping one segment
 * gives `a.Outer.Middle` — still not a real file, so it simply won't match
 * anything, same as today) — it can never mismatch. So it's returned as an
 * ADDITIONAL candidate path from `extractImportPaths`, never a replacement:
 * `extractImportPath`'s pinned single-path return stays exactly as-is.
 *
 * Wildcard static imports (`import static a.B.*;`) are excluded: their
 * `extractImportPath` result is already the class's FQN (the trailing `.*`
 * is stripped above), so dropping another segment there would walk past the
 * class into its package — wrong, not merely imprecise.
 *
 * Regular (non-static) imports don't get this treatment either — the whole
 * path already IS the class's FQN there, so dropping a segment would be a
 * real regression, not a safe extra candidate.
 *
 * Kotlin has an analogous-looking shape (`import a.b.Foo.member` /
 * `import a.b.topLevelFn`) but no equivalent fix: its grammar gives both a
 * flat `identifier` of `simple_identifier` segments with no marker
 * distinguishing "class member access" from "bare top-level declaration" —
 * unlike Java, there's no `static` keyword (or anything else) to hang this
 * logic on, so guessing would risk the false-positive shape #868 warned
 * against. Left as an honest gap per the #864/#869 precedent.
 */
function staticMemberClassPath(node: SyntaxNode, path: string): string | null {
  if (!hasChildOfType(node, 'static') || hasChildOfType(node, 'asterisk')) return null;
  const lastDot = path.lastIndexOf('.');
  return lastDot > 0 ? path.slice(0, lastDot) : null;
}

/**
 * Java import extractor
 *
 * Handles all Java import patterns:
 * - import com.example.MyClass;              (single import)
 * - import com.example.*;                    (wildcard import)
 * - import static com.example.Utils.method;  (static import)
 * - import static com.example.Utils.*;       (static wildcard import)
 *
 * Standard library imports (java.*, javax.*) are filtered out.
 */
export class JavaImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['import_declaration'];

  extractImportPath(node: SyntaxNode): string | null {
    const path = this.getImportPath(node);
    if (!path || isJavaStdLib(path)) return null;
    return stripWildcardSuffix(path);
  }

  extractImportPaths(node: SyntaxNode): string[] {
    const path = this.extractImportPath(node);
    if (!path) return [];
    const classPath = staticMemberClassPath(node, path);
    return classPath ? [path, classPath] : toImportPathsArray(path);
  }

  processImportSymbols(node: SyntaxNode): { importPath: string; symbols: string[] } | null {
    const path = this.getImportPath(node);
    if (!path || isJavaStdLib(path)) return null;

    const parts = path.split('.');
    const lastPart = parts[parts.length - 1];

    // For wildcard imports, use the package name as the symbol
    if (lastPart === '*') {
      const packagePath = parts.slice(0, -1).join('.');
      const packageName = parts[parts.length - 2];
      return { importPath: packagePath, symbols: [packageName] };
    }

    return { importPath: path, symbols: [lastPart] };
  }

  processImportSymbolsList(node: SyntaxNode): Array<{ importPath: string; symbols: string[] }> {
    return toImportSymbolsArray(this.processImportSymbols(node));
  }

  private getImportPath(node: SyntaxNode): string | null {
    // Find the scoped_identifier or identifier child (import path)
    const pathChild = node.namedChildren.find(
      child => child.type === 'scoped_identifier' || child.type === 'identifier',
    );
    if (!pathChild) return null;

    const hasWildcard = hasChildOfType(node, 'asterisk');
    return hasWildcard ? `${pathChild.text}.*` : pathChild.text;
  }
}

// =============================================================================
// SYMBOL EXTRACTOR
// =============================================================================

/**
 * Java symbol extractor
 *
 * Handles:
 * - method_declaration (public void method() {})
 * - constructor_declaration (public MyClass() {})
 * - class_declaration (class MyClass {})
 * - interface_declaration (interface MyInterface {})
 * - enum_declaration (enum MyEnum {})
 * - record_declaration (record MyRecord(int x) {})
 *
 * `parentClass` is threaded into every type-declaration handler (not just
 * methods/constructors) so a nested type (`class Retrofit { public static
 * final class Builder { ... } }`) reports its enclosing type — the chunker
 * (`ast/chunker.ts`'s `processTopLevelNode`) already resolves this via
 * `JavaTraverser.findParentContainerName` for every top-level node regardless
 * of kind; previously only the method/constructor handlers accepted the
 * parameter, so a nested class/interface/enum/record silently lost it (#949 —
 * this is the confirmed repro: `Retrofit.Builder`, `RequestFactory.Builder`,
 * etc. all reported `parentClass: null`, making six same-named `Builder`
 * results indistinguishable except by file path).
 *
 * Call sites: method_invocation (direct calls and object.method() calls)
 */
export class JavaSymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = [
    'method_declaration',
    'constructor_declaration',
    'class_declaration',
    'interface_declaration',
    'enum_declaration',
    'record_declaration',
  ];

  extractSymbol(node: SyntaxNode, content: string, parentClass?: string): SymbolInfo | null {
    switch (node.type) {
      case 'method_declaration':
        return this.extractMethodInfo(node, content, parentClass);
      case 'constructor_declaration':
        return this.extractConstructorInfo(node, content, parentClass);
      case 'class_declaration':
        return this.extractClassInfo(node, parentClass);
      case 'interface_declaration':
        return this.extractInterfaceInfo(node, parentClass);
      case 'enum_declaration':
        return this.extractEnumInfo(node, parentClass);
      case 'record_declaration':
        return this.extractRecordInfo(node, parentClass);
      default:
        return null;
    }
  }

  extractCallSite(node: SyntaxNode): { symbol: string; line: number; key: string } | null {
    const line = node.startPosition.row + 1;

    // method_invocation: foo() or obj.foo()
    if (node.type === 'method_invocation') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return null;
      return { symbol: nameNode.text, line, key: `${nameNode.text}:${line}` };
    }

    // method_reference: String::valueOf — no field names, last named child is the method identifier
    if (node.type === 'method_reference') {
      const lastChild = node.namedChild(node.namedChildCount - 1);
      if (lastChild?.type === 'identifier') {
        return { symbol: lastChild.text, line, key: `${lastChild.text}:${line}` };
      }
    }

    return null;
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
      type: parentClass ? 'method' : 'function',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: extractSignature(node, content),
      parameters: extractParameters(node, content),
      returnType: extractJavaReturnType(node),
      complexity: calculateComplexity(node),
    };
  }

  private extractConstructorInfo(
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
      complexity: calculateComplexity(node),
    };
  }

  private extractClassInfo(node: SyntaxNode, parentClass?: string): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: clampSignatureLength(`class ${nameNode.text}${typeParamsAndHeritage(node)}`),
    };
  }

  private extractInterfaceInfo(node: SyntaxNode, parentClass?: string): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'interface',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: clampSignatureLength(`interface ${nameNode.text}${typeParamsAndHeritage(node)}`),
    };
  }

  private extractEnumInfo(node: SyntaxNode, parentClass?: string): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      // Enums have no type parameters in Java, but can implement interfaces
      // (`enum Status implements Foo`) — `typeParamsAndHeritage` still
      // applies cleanly since it's a no-op for the type-parameters half.
      signature: clampSignatureLength(`enum ${nameNode.text}${typeParamsAndHeritage(node)}`),
    };
  }

  private extractRecordInfo(node: SyntaxNode, parentClass?: string): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: clampSignatureLength(`record ${nameNode.text}${typeParamsAndHeritage(node)}`),
    };
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Check if a node has a `public` modifier.
 * Iterates the modifiers node's children for an exact `public` token
 * to avoid false positives from substring matching.
 */
function hasPublicModifier(node: SyntaxNode): boolean {
  const modifiers = node.children.find(child => child.type === 'modifiers');
  if (!modifiers) return false;
  return modifiers.children.some(child => child.type === 'public');
}

const ACCESS_MODIFIER_TYPES = new Set(['public', 'private', 'protected']);

/**
 * Check if a node has any explicit access modifier (public, private, protected).
 * Java has no `internal` modifier (unlike C#). Used to distinguish implicit
 * public interface members from explicitly non-public ones (Java 9+ private
 * interface methods).
 */
function hasExplicitAccessModifier(node: SyntaxNode): boolean {
  const modifiers = node.children.find(child => child.type === 'modifiers');
  if (!modifiers) return false;
  return modifiers.children.some(child => ACCESS_MODIFIER_TYPES.has(child.type));
}

/**
 * Generic type parameters and extends/implements heritage, exactly as
 * declared in source — the Java analog of C#'s `typeParamsAndBaseList`
 * (same underlying bug: `signature` for a type declaration reported only
 * its bare keyword and name, dropping `<T extends Comparable<T>>` and
 * `extends Bar<T> implements Baz, Qux` entirely). `type_parameters` and
 * `superclass`/`interfaces` (class/enum/record) are registered grammar
 * fields, but `extends_interfaces` (an interface extending other
 * interfaces) is NOT a field on `interface_declaration`, so it's found by
 * scanning `namedChildren` for consistency with the fielded case.
 *
 * Whitespace is collapsed to a single line (`collapseWhitespace`, matching
 * `extractSignature`'s convention) — a heritage clause can itself span
 * multiple physical lines (long generic bounds, an interleaved comment),
 * which would otherwise leak newlines into `signature`.
 */
function typeParamsAndHeritage(node: SyntaxNode): string {
  const typeParams = collapseWhitespace(node.childForFieldName('type_parameters')?.text);
  const superclass = collapseWhitespace(node.childForFieldName('superclass')?.text);
  const interfaces = collapseWhitespace(
    node.childForFieldName('interfaces')?.text ??
      node.namedChildren.find(child => child.type === 'extends_interfaces')?.text,
  );
  const heritage = [superclass, interfaces].filter(Boolean).join(' ');
  return `${typeParams}${heritage ? ` ${heritage}` : ''}`;
}

/**
 * Extract return type from a Java method_declaration.
 * Java uses a 'type' field instead of 'return_type'.
 */
function extractJavaReturnType(node: SyntaxNode): string | undefined {
  if (node.type !== 'method_declaration') return undefined;
  const typeNode = node.childForFieldName('type');
  if (!typeNode) return undefined;
  return typeNode.text;
}

/**
 * Find the first descendant of a specific type (breadth-first among children).
 */
function findDescendant(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (child.type === type) return child;
    const found = findDescendant(child, type);
    if (found) return found;
  }
  return null;
}

/**
 * Check if a node has a child of a specific type (including unnamed children).
 */
function hasChildOfType(node: SyntaxNode, type: string): boolean {
  return node.children.some(child => child.type === type);
}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const javaDefinition: LanguageDefinition = {
  id: 'java',
  extensions: ['java'],
  traverser: new JavaTraverser(),
  exportExtractor: new JavaExportExtractor(),
  importExtractor: new JavaImportExtractor(),
  symbolExtractor: new JavaSymbolExtractor(),

  // #925: a same-package test class carries no import for its subject at
  // all -- see LanguageDefinition.samePackageTestConvention's doc comment
  // for the full rationale (and why this needs no directory bounding).
  samePackageTestConvention: true,

  complexity: {
    decisionPoints: [
      'if_statement',
      'while_statement',
      'for_statement',
      'enhanced_for_statement',
      'do_statement',
      'catch_clause',
      'ternary_expression',
      'binary_expression',
      'switch_block_statement_group',
      'switch_rule',
    ],
    nestingTypes: [
      'if_statement',
      'while_statement',
      'for_statement',
      'enhanced_for_statement',
      'do_statement',
      'switch_expression',
      'catch_clause',
      'lambda_expression',
    ],
    nonNestingTypes: ['switch_block_statement_group', 'switch_rule', 'ternary_expression'],
    lambdaTypes: ['lambda_expression'],
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
      '>>>=',
      '&&',
      '||',
      '!',
      '&',
      '|',
      '^',
      '~',
      '<<',
      '>>',
      '>>>',
      '.',
      '?',
      ':',
      '::',
      '->',
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
      'instanceof',
      'break',
      'continue',
      'class',
      'extends',
      'implements',
      'interface',
      'enum',
      'record',
      'import',
      'package',
      'public',
      'private',
      'protected',
      'static',
      'final',
      'abstract',
      'synchronized',
      'volatile',
      'transient',
      'native',
      'void',
      'super',
      'this',
      'assert',
      'yield',
      'var',
    ]),
  },

  symbols: {
    callExpressionTypes: ['method_invocation', 'method_reference'],
  },
};

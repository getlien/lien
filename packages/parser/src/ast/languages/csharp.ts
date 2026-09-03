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
  collapseWhitespace,
} from '../extractors/symbol-helpers.js';
import { toImportPathsArray, toImportSymbolsArray } from '../extractors/types.js';
import { calculateComplexity } from '../complexity/index.js';

// =============================================================================
// TRAVERSER
// =============================================================================

/**
 * C# AST traverser
 *
 * C# has a class-based container structure similar to Java, with methods
 * inside class, interface, struct, record, and enum declarations. Unlike Java,
 * C# has namespaces that can nest declarations, and uses `declaration_list`
 * as the unified body node type for all containers.
 *
 * Lambda expressions can appear in variable declarations:
 *   Action a = () => { ... };
 *
 * `property_declaration` and `indexer_declaration` are target nodes too
 * (issue #871): properties are C#'s dominant public-API idiom (auto-props,
 * expression-bodied props, DTO/POCO surfaces), and without a dedicated chunk
 * per property, `api-delta`/`get_dependents`/`list_functions` are structurally
 * blind to a property being removed or changing type. Chunked as
 * `symbolType: 'method'` (see `extractPropertyInfo`) rather than a new
 * `'property'` symbolType — no language emits `'property'` today, and adding
 * one would ripple into `signature-delta.ts`, `complexity-delta.ts`, risk
 * scoring, and formatters for a single language's gap. Record primary-
 * constructor properties (`record Person(string Name)`) are NOT covered:
 * the grammar represents them as plain `parameter` nodes inside the record's
 * `parameter_list`, not `property_declaration` — a different, out-of-scope
 * node shape.
 */
export class CSharpTraverser implements LanguageTraverser {
  targetNodeTypes = [
    'method_declaration',
    'constructor_declaration',
    'property_declaration',
    'indexer_declaration',
  ];

  containerTypes = [
    'class_declaration',
    'interface_declaration',
    'struct_declaration',
    'record_declaration',
    'enum_declaration',
  ];

  declarationTypes = ['local_declaration_statement'];

  functionTypes = ['lambda_expression'];

  shouldExtractChildren(node: SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(node: SyntaxNode): boolean {
    if (node.type !== 'local_declaration_statement') return false;
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
      node.type === 'compilation_unit' ||
      node.type === 'declaration_list' ||
      node.type === 'namespace_declaration' ||
      node.type === 'file_scoped_namespace_declaration' ||
      // #970: anything inside `#if ... #endif` used to be invisible. The
      // grammar wraps it in a `preproc_if`, which was not transparent, so
      // `findTopLevelNodes` never descended and the declarations produced no
      // chunk and no symbol at all. Measured on serilog/serilog: this fix
      // takes the count of files collapsed to a single symbol-less
      // whole-file chunk from 16 to 9, recovering 7 -- the 9 that remain are
      // 7 legitimately trivial (GlobalUsings/AssemblyInfo/top-level Program)
      // and 2 that root in ERROR, which is #970's Bug 2, a tree-sitter
      // grammar limit no traverser change can reach.
      //
      // It hides MEMBERS too, not just top-level declarations — the issue
      // only documents the latter, but `declaration_list > preproc_if >
      // method_declaration` is the same blindness for a conditionally
      // compiled method, and that shape is far more common.
      //
      // `preproc_elif`/`preproc_else` are deliberately NOT here. The grammar
      // NESTS them inside `preproc_if`:
      //
      //     preproc_if
      //       identifier                <- the condition
      //       <#if branch declarations>
      //       preproc_elif
      //         <elif declarations>
      //         preproc_else
      //           <else declarations>
      //
      // so making them transparent as well would extract the same logical
      // declaration once per branch — `class Impl` twice for a plain
      // `#if/#else`, three times with an `#elif`. Duplicate symbols with the
      // same name are FABRICATION, and this repo has already paid for that
      // once (#1056: two unrelated files reporting an identical 144-file
      // dependent list). Omission is the cheaper error.
      //
      // The consequence, stated plainly: for `#if/#else`, only the `#if`
      // branch is indexed. Choosing correctly would require knowing the build
      // configuration, which a parser reading one file cannot. First branch is
      // deterministic; "whichever branch happens to be real" is not
      // available.
      //
      // `#region` needs nothing here — `preproc_region`/`preproc_endregion`
      // are SIBLINGS of the declarations they visually wrap, not parents, so
      // they never hid anything (verified against the grammar).
      node.type === 'preproc_if'
    );
  }

  findParentContainerName(node: SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (
        current.type === 'class_declaration' ||
        current.type === 'interface_declaration' ||
        current.type === 'struct_declaration' ||
        current.type === 'record_declaration' ||
        current.type === 'enum_declaration'
      ) {
        const nameNode = current.childForFieldName('name');
        return nameNode?.text;
      }
      current = current.parent;
    }
    return undefined;
  }

  findFunctionInDeclaration(node: SyntaxNode): DeclarationFunctionInfo {
    if (node.type !== 'local_declaration_statement') {
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
 * C# export extractor
 *
 * C# uses the `public` modifier for visibility — public declarations are
 * accessible outside the assembly. Unlike Java's `modifiers` wrapper node,
 * C# has individual `modifier` nodes as direct children of declarations.
 *
 * Exportable items:
 * - public class User {}
 * - public struct Point {}
 * - public interface IRepository {}
 * - public enum Status {}
 * - public record Person(string Name) {}
 * - public void Method() {}   (inside a class)
 * - Interface methods are implicitly public
 * - public string Name { get; set; }  (property)
 *
 * Internal (default access) declarations are NOT exported.
 */
export class CSharpExportExtractor implements LanguageExportExtractor {
  extractExports(rootNode: SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();

    const addExport = (name: string) => {
      if (name && !seen.has(name)) {
        seen.add(name);
        exports.push(name);
      }
    };

    this.walkDeclarations(rootNode, addExport);

    return exports;
  }

  private walkDeclarations(node: SyntaxNode, addExport: (name: string) => void): void {
    node.namedChildren.forEach(child => {
      // Recurse into namespaces to find type declarations
      if (child.type === 'namespace_declaration') {
        const body = child.childForFieldName('body');
        if (body) this.walkDeclarations(body, addExport);
        return;
      }

      // File-scoped namespaces: declarations are children of the namespace node
      if (child.type === 'file_scoped_namespace_declaration') {
        this.walkDeclarations(child, addExport);
        return;
      }

      this.extractFromNode(child, addExport);
    });
  }

  private extractFromNode(node: SyntaxNode, addExport: (name: string) => void): void {
    switch (node.type) {
      case 'class_declaration':
      case 'interface_declaration':
      case 'struct_declaration':
      case 'record_declaration':
      case 'enum_declaration': {
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
    if (
      member.type === 'method_declaration' ||
      member.type === 'constructor_declaration' ||
      member.type === 'property_declaration'
    ) {
      // Interface members without explicit modifiers are implicitly public.
      // C# 8+ allows private/protected/internal interface members — only export
      // those that are public or have no explicit visibility modifier.
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
    // C# field_declaration contains variable_declaration → variable_declarator(s)
    fieldDecl.namedChildren
      .filter(child => child.type === 'variable_declaration')
      .flatMap(varDecl => varDecl.namedChildren)
      .filter(declarator => declarator.type === 'variable_declarator')
      .forEach(declarator => {
        const nameNode = declarator.childForFieldName('name');
        if (nameNode) addExport(nameNode.text);
      });
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/**
 * Check if a C# import path is a standard library namespace.
 * Standard library namespaces start with System. or Microsoft.
 */
function isCSharpStdLib(importPath: string): boolean {
  return (
    importPath === 'System' ||
    importPath.startsWith('System.') ||
    importPath === 'Microsoft' ||
    importPath.startsWith('Microsoft.')
  );
}

/**
 * Check whether a `using_directive` node is a `global using` (issue #930).
 * The grammar represents `global` as an unnamed leading token sibling of
 * `using`, not a field, so it has to be found by scanning `.children`
 * (which includes unnamed tokens) rather than `.namedChildren` or
 * `childForFieldName`.
 *
 * A global using's effect isn't scoped to the file that declares it — it
 * applies project-wide, which is the entire point of the keyword — so the
 * declaring file (conventionally `GlobalUsings.cs`, itself typically just a
 * list of these directives with no other code) has no real dependency
 * relationship with the namespaces it lists. Every consumer downstream of
 * this extractor resolves a namespace-shaped import path against every file
 * physically under that namespace's path (see `path-matching.ts`'s
 * `matchesPythonModule`, which C#'s dotted paths also satisfy), so without
 * this check the declaring file becomes a spurious "importer" of, and a
 * spurious "test coverage" association for, every file in every namespace
 * it lists.
 */
function isGlobalUsingDirective(node: SyntaxNode): boolean {
  return node.children.some(child => !child.isNamed && child.type === 'global');
}

/**
 * C# import extractor
 *
 * Handles all C# using patterns:
 * - using Newtonsoft.Json;             (regular using)
 * - using static MyLib.Utils;          (static using)
 * - using Json = Newtonsoft.Json;      (alias using)
 * - global using Newtonsoft.Json;      (global using — see isGlobalUsingDirective)
 *
 * Standard library usings (System.*, Microsoft.*) are filtered out.
 */
export class CSharpImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['using_directive'];

  extractImportPath(node: SyntaxNode): string | null {
    const path = this.getImportPath(node);
    if (!path || isCSharpStdLib(path)) return null;
    return path;
  }

  extractImportPaths(node: SyntaxNode): string[] {
    return toImportPathsArray(this.extractImportPath(node));
  }

  processImportSymbols(node: SyntaxNode): { importPath: string; symbols: string[] } | null {
    const path = this.getImportPath(node);
    if (!path || isCSharpStdLib(path)) return null;

    // Check for alias using: using Json = Newtonsoft.Json;
    // In alias using, the alias identifier has the 'name' field
    const aliasNode = node.childForFieldName('name');
    if (aliasNode?.type === 'identifier') {
      return { importPath: path, symbols: [aliasNode.text] };
    }

    const parts = path.split('.');
    const lastPart = parts[parts.length - 1];
    return { importPath: path, symbols: [lastPart] };
  }

  processImportSymbolsList(node: SyntaxNode): Array<{ importPath: string; symbols: string[] }> {
    return toImportSymbolsArray(this.processImportSymbols(node));
  }

  private getImportPath(node: SyntaxNode): string | null {
    // A global using has no file-scoped dependency relationship — see
    // isGlobalUsingDirective — so it never contributes an import path.
    if (isGlobalUsingDirective(node)) return null;

    // qualified_name is always the import path when present
    const qualifiedName = node.namedChildren.find(c => c.type === 'qualified_name');
    if (qualifiedName) return qualifiedName.text;

    // For simple using (e.g., `using System;`), the identifier is the path
    // Skip the alias identifier (it has the 'name' field in alias using)
    const aliasNode = node.childForFieldName('name');
    const identifier = node.namedChildren.find(c => c.type === 'identifier' && c !== aliasNode);
    return identifier?.text ?? null;
  }
}

// =============================================================================
// SYMBOL EXTRACTOR
// =============================================================================

/**
 * C# symbol extractor
 *
 * Handles:
 * - method_declaration (public void Method() {})
 * - constructor_declaration (public MyClass() {})
 * - class_declaration (class MyClass {})
 * - interface_declaration (interface IMyInterface {})
 * - struct_declaration (struct MyStruct {})
 * - record_declaration (record MyRecord(int X) {})
 * - enum_declaration (enum MyEnum {})
 * - property_declaration (public string Name { get; set; } / public int Count => …)
 * - indexer_declaration (public int this[int index] { get; set; })
 *
 * `parentClass` is threaded into every type-declaration handler (not just
 * methods/properties) so a nested type (`public class Retrofit { public class
 * Builder { ... } }`) reports its enclosing type — the chunker
 * (`ast/chunker.ts`'s `processTopLevelNode`) already resolves this via
 * `CSharpTraverser.findParentContainerName` for every top-level node
 * regardless of kind; previously only the method/property handlers accepted
 * the parameter, so a nested class/interface/struct/record/enum silently lost
 * it (#949 — surfaced as `list_functions` being unable to tell one nested
 * `Builder` from an unrelated same-named nested `Builder` elsewhere in the
 * codebase).
 *
 * Call sites: invocation_expression (direct calls and obj.Method() calls)
 */
export class CSharpSymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = [
    'method_declaration',
    'constructor_declaration',
    'class_declaration',
    'interface_declaration',
    'struct_declaration',
    'record_declaration',
    'enum_declaration',
    'property_declaration',
    'indexer_declaration',
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
      case 'struct_declaration':
        return this.extractStructInfo(node, parentClass);
      case 'record_declaration':
        return this.extractRecordInfo(node, parentClass);
      case 'enum_declaration':
        return this.extractEnumInfo(node, parentClass);
      case 'property_declaration':
      case 'indexer_declaration':
        return this.extractPropertyInfo(node, content, parentClass);
      default:
        return null;
    }
  }

  extractCallSite(node: SyntaxNode): { symbol: string; line: number; key: string } | null {
    if (node.type !== 'invocation_expression') return null;

    const funcNode = node.childForFieldName('function');
    if (!funcNode) return null;

    const line = node.startPosition.row + 1;

    // Direct call: DoSomething()
    if (funcNode.type === 'identifier') {
      return { symbol: funcNode.text, line, key: `${funcNode.text}:${line}` };
    }

    // Member access call: obj.DoSomething()
    if (funcNode.type === 'member_access_expression') {
      const nameNode = funcNode.childForFieldName('name');
      if (nameNode) {
        return { symbol: nameNode.text, line, key: `${nameNode.text}:${line}` };
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
      returnType: extractCSharpReturnType(node),
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

  /**
   * Extract a property or indexer as a `method`-typed symbol (Route A,
   * issue #871 — see the rationale on `CSharpTraverser`). An indexer has no
   * `name` field in the grammar (it's accessed via `this[...]`), so it is
   * named literally `this`; C# forbids more than one indexer sharing a
   * parameter signature, so this can't collide the way an overload-set
   * already doesn't (same positional-pairing behavior as method overloads).
   *
   * The signature is built (not reused from `extractSignature`, which
   * bounds itself on a `body` field that property/indexer nodes don't have)
   * from the declaration head plus a normalized accessor shape, so a type
   * change or accessor added/removed is a real signature change, but editing
   * an expression-bodied getter's expression is not — mirroring how a
   * method's body is excluded from its own signature.
   */
  private extractPropertyInfo(
    node: SyntaxNode,
    content: string,
    parentClass?: string,
  ): SymbolInfo | null {
    const isIndexer = node.type === 'indexer_declaration';
    const name = isIndexer ? 'this' : node.childForFieldName('name')?.text;
    if (!name) return null;

    return {
      name,
      type: 'method',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: extractPropertySignature(node, content),
      parameters: isIndexer ? extractParameters(node, content) : undefined,
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
      signature: clampSignatureLength(`class ${nameNode.text}${typeParamsAndBaseList(node)}`),
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
      signature: clampSignatureLength(`interface ${nameNode.text}${typeParamsAndBaseList(node)}`),
    };
  }

  private extractStructInfo(node: SyntaxNode, parentClass?: string): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    return {
      name: nameNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentClass,
      signature: clampSignatureLength(`struct ${nameNode.text}${typeParamsAndBaseList(node)}`),
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
      signature: clampSignatureLength(`record ${nameNode.text}${typeParamsAndBaseList(node)}`),
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
      // Enums have no type parameters in C#, but can carry a base list — the
      // underlying integer type (`enum Status : byte`) — so this still runs
      // through the shared helper rather than a bespoke one-off.
      signature: clampSignatureLength(`enum ${nameNode.text}${typeParamsAndBaseList(node)}`),
    };
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Check if a node has a `public` modifier.
 * C# uses individual `modifier` nodes as direct children (not a `modifiers`
 * wrapper like Java). Iterates children for an exact `public` modifier.
 */
function hasPublicModifier(node: SyntaxNode): boolean {
  return node.children.some(child => child.type === 'modifier' && child.text === 'public');
}

const ACCESS_MODIFIERS = new Set(['public', 'private', 'protected', 'internal']);

/**
 * Check if a node has any explicit access modifier (public, private, protected, internal).
 * Used to distinguish implicit public interface members from explicitly non-public ones (C# 8+).
 */
function hasExplicitAccessModifier(node: SyntaxNode): boolean {
  return node.children.some(child => child.type === 'modifier' && ACCESS_MODIFIERS.has(child.text));
}

/**
 * Generic type parameters and base-type/interface list, exactly as the
 * source declares them (found in a post-release audit of 0.72.0: `signature`
 * for a type declaration reported only its bare keyword and name, so
 * `LogEventPropertyValueVisitor<TState, TResult>` lost its type parameters
 * entirely and `Logger : ILogger, ILogEventSink, IDisposable` came back as
 * bare `class Logger` — the single most useful fact about that class,
 * gone). `type_parameter_list` and `base_list` are not registered grammar
 * fields on class/struct/record/interface declarations (only
 * `delegate_declaration` happens to expose `type_parameters` as a field), so
 * both are found by scanning `namedChildren` instead of
 * `childForFieldName` — this works uniformly across all four container
 * kinds, including `record struct` (still a `record_declaration` node under
 * the hood) and enum's base list (its underlying integer type, e.g. `enum
 * Status : byte` — enums have no type parameters in C#, but do have this).
 *
 * Deliberately excludes `type_parameter_constraints_clause` (`where T :
 * class, new()`): building the signature from just these two named pieces,
 * rather than slicing the raw source text across the whole declaration
 * head, means the constraint clause — which sits between the base list and
 * the body — is never captured at all, not partially.
 *
 * Whitespace is collapsed to a single line (matching `extractSignature`'s
 * convention): a base list can itself span multiple physical lines, e.g.
 * Serilog's `Logger` class wraps a conditionally-compiled base in a
 * preprocessor block (`class Logger : ILogger\n#if X\n, IAsyncDisposable\n#endif\n{`)
 * — found via dogfooding against the real repo, not a hypothetical case.
 */
function typeParamsAndBaseList(node: SyntaxNode): string {
  const typeParams = node.namedChildren.find(child => child.type === 'type_parameter_list');
  const baseList = node.namedChildren.find(child => child.type === 'base_list');
  const typeParamsText = collapseWhitespace(typeParams?.text);
  const baseListText = collapseWhitespace(baseList?.text);
  return `${typeParamsText}${baseListText ? ` ${baseListText}` : ''}`;
}

/**
 * Extract return type from a C# method_declaration.
 * C# uses a 'returns' field instead of 'type'.
 */
function extractCSharpReturnType(node: SyntaxNode): string | undefined {
  if (node.type !== 'method_declaration') return undefined;
  const typeNode = node.childForFieldName('returns');
  if (!typeNode) return undefined;
  return typeNode.text;
}

/**
 * The declaration "head" of a property/indexer: everything up to whichever
 * of its `accessors` (`{ get; set; }`) or `value` (`=> expr`) field comes
 * first — e.g. "public int Count" for `public int Count => …` or
 * "public int this[int index]" for an indexer. Neither node type has a
 * `body` field, so `extractSignature`'s body-boundary trick doesn't apply
 * directly; this is its property/indexer equivalent.
 */
function propertyHead(node: SyntaxNode, content: string): string {
  const boundaries = [node.childForFieldName('accessors'), node.childForFieldName('value')].filter(
    (n): n is SyntaxNode => n !== null,
  );
  const end =
    boundaries.length > 0 ? Math.min(...boundaries.map(n => n.startIndex)) : node.endIndex;
  return content.slice(node.startIndex, end).replace(/\s+/g, ' ').trim();
}

/**
 * Accessor kinds (`get`/`set`/`init`/`add`/`remove`) present on a property or
 * indexer, normalized so an expression-bodied property (`=> expr`, no
 * `accessor_list`) reads as its semantic equivalent: get-only. This keeps
 * the accessor *contract* in the signature while excluding the getter's
 * actual expression, the same principle as excluding a method's body.
 */
function accessorKinds(node: SyntaxNode): string[] {
  const accessorList = node.childForFieldName('accessors');
  if (accessorList) {
    return accessorList.namedChildren
      .filter(child => child.type === 'accessor_declaration')
      .map(child => child.childForFieldName('name')?.text)
      .filter((kind): kind is string => !!kind);
  }
  return node.childForFieldName('value') ? ['get'] : [];
}

/** Full property/indexer signature: declaration head + normalized accessor shape. */
function extractPropertySignature(node: SyntaxNode, content: string): string {
  const head = propertyHead(node, content);
  const kinds = accessorKinds(node);
  const signature =
    kinds.length > 0 ? `${head} { ${kinds.map(kind => `${kind};`).join(' ')} }` : head;
  return clampSignatureLength(signature);
}

/**
 * Find the first descendant of a specific type (depth-first).
 */
function findDescendant(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (child.type === type) return child;
    const found = findDescendant(child, type);
    if (found) return found;
  }
  return null;
}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const csharpDefinition: LanguageDefinition = {
  id: 'csharp',
  extensions: ['cs'],
  traverser: new CSharpTraverser(),
  exportExtractor: new CSharpExportExtractor(),
  importExtractor: new CSharpImportExtractor(),
  symbolExtractor: new CSharpSymbolExtractor(),
  // Confirmed against real code (#875, AutoMapper/AutoMapper): a C# namespace
  // body gets implicit, unqualified access to every *enclosing* namespace's
  // public members (`namespace AutoMapper.UnitTests { ... }` can reference
  // `AutoMapper.TypeMap` with zero `using` directive — standard C# simple-
  // name resolution, not a convention). 355/364 of AutoMapper's UnitTests
  // files rely on exactly this, carrying no relevant `using` at all, so
  // import-based test-association has no per-file signal for them. This is
  // NOT `wholeModuleImports`: the 9/364 files with a real dotted
  // `using AutoMapper.X;` resolve correctly today via ordinary per-file
  // matching (#866/#868). C# usings are dotted, not slashed, so EVERY C#
  // import (including those real, working dotted ones) is "bare" by
  // `isUnresolvableWholeModuleImport`'s slash check — setting
  // `wholeModuleImports` here would discard all of them and regress #866.
  enclosingNamespaceAccess: true,

  // ADR-015 (#1038): verified against a real corpus (mediatr). Note for the
  // record: issue #1038's own "current state" table listed C# as already
  // setting `wholeModuleImports` -- that was incorrect. C# has only ever set
  // `enclosingNamespaceAccess` (above, a DIFFERENT, out-of-scope flag); this
  // is confirmed both by `registry.test.ts`'s pre-existing
  // `hasWholeModuleImports('csharp')).toBe(false)` assertion and by this
  // very file's own comment two lines up arguing against it. All three
  // matcher-path fields below are being declared for C# for the first time.
  // `wholeModuleImports: false`: per the comment above, C#'s dotted
  // `using` directives resolve correctly today via ordinary per-file
  // matching (`test/MediatR.DependencyInjectionTests/MicrosoftDependencyInjectionTests.cs:1-2`'s
  // `using MediatR.DependencyInjectionTests.Abstractions;` is a real, precise,
  // working per-file reference, not a whole-module-unresolvable one).
  wholeModuleImports: false,
  // `singleFileImports: false`: inapplicable, not merely unconfirmed --
  // `CSharpImportExtractor.getImportPath` returns the qualified name text
  // verbatim (dotted, e.g. `MediatR.Pipeline`), never converted to `/`, so a
  // C# import never reaches `matchesAtBoundaryPrecise`'s slash-based
  // multi-segment branch this flag gates.
  singleFileImports: false,
  // `namespaceStyleImports: false`: C# namespace/folder mirroring is
  // case-sensitive in practice -- confirmed exact-case in this corpus
  // (`namespace MediatR.Pipeline;` in `src/MediatR/Pipeline/RequestExceptionActionProcessorBehavior.cs`
  // matches `src/MediatR/Pipeline/` exactly, no case divergence the way
  // PHP's PSR-4 has). Setting this would risk the same case-insensitive
  // false-hub class #1028 fixed for Rust, for no confirmed benefit here.
  namespaceStyleImports: false,

  complexity: {
    decisionPoints: [
      'if_statement',
      'while_statement',
      'for_statement',
      'foreach_statement',
      'do_statement',
      'catch_clause',
      'conditional_expression',
      'binary_expression',
      'switch_section',
      'switch_expression_arm',
    ],
    nestingTypes: [
      'if_statement',
      'while_statement',
      'for_statement',
      'foreach_statement',
      'do_statement',
      'switch_expression',
      'catch_clause',
      'lambda_expression',
    ],
    nonNestingTypes: ['switch_section', 'switch_expression_arm', 'conditional_expression'],
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
      '&&',
      '||',
      '!',
      '&',
      '|',
      '^',
      '~',
      '<<',
      '>>',
      '.',
      '?',
      ':',
      '=>',
      '??',
      '??=',
      '?.',
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
      'foreach',
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
      'is',
      'as',
      'typeof',
      'sizeof',
      'nameof',
      'break',
      'continue',
      'class',
      'struct',
      'interface',
      'enum',
      'record',
      'namespace',
      'using',
      'public',
      'private',
      'protected',
      'internal',
      'static',
      'readonly',
      'const',
      'abstract',
      'virtual',
      'override',
      'sealed',
      'void',
      'base',
      'this',
      'var',
      'async',
      'await',
      'yield',
      'in',
      'out',
      'ref',
      'params',
      'delegate',
      'event',
      'where',
      'lock',
      'checked',
      'unchecked',
    ]),
  },

  symbols: {
    callExpressionTypes: ['invocation_expression'],
  },
};

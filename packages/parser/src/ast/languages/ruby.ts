import type { SymbolInfo, SyntaxNode } from '../types.js';
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
// SHARED HELPERS
// =============================================================================

/**
 * Ruby "import" methods. Unlike most languages, Ruby has no import *statement* —
 * dependencies are loaded via ordinary method calls (`require 'json'`,
 * `require_relative './foo'`, `load`, `autoload`). The grammar parses these as
 * `call` nodes, so the import extractor filters call nodes by their method name.
 */
const REQUIRE_METHODS = new Set(['require', 'require_relative', 'load', 'autoload']);

/**
 * Return the content of the first string literal in an `argument_list`
 * (e.g. the `'json'` in `require 'json'`). Returns null if absent or empty.
 */
function firstStringArgument(argsNode: SyntaxNode | null): string | null {
  if (!argsNode) return null;
  const stringNode = argsNode.namedChildren.find(c => c.type === 'string');
  const contentNode = stringNode?.namedChildren.find(c => c.type === 'string_content');
  return contentNode?.text ?? null;
}

/**
 * Extract the require path from a `call` node if it is a require-like call,
 * otherwise null (so non-import calls are skipped by the import extractor).
 */
function extractRequirePath(node: SyntaxNode): string | null {
  if (node.type !== 'call') return null;
  const method = node.childForFieldName('method');
  if (!method || !REQUIRE_METHODS.has(method.text)) return null;
  return firstStringArgument(node.childForFieldName('arguments'));
}

/**
 * Reduce a require path to a bare module name for the imported-symbols map.
 * `'../lib/foo'` → `foo`, `'active_record'` → `active_record`.
 */
function moduleBasename(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.rb$/, '');
}

// =============================================================================
// TRAVERSER
// =============================================================================

/**
 * Ruby AST traverser
 *
 * Ruby structure:
 * - Methods are defined with `def` (`method`) or `def self.x` (`singleton_method`)
 * - Classes and modules are containers whose methods we extract
 * - Container bodies are `body_statement` nodes
 */
export class RubyTraverser implements LanguageTraverser {
  targetNodeTypes = ['method', 'singleton_method'];

  containerTypes = [
    'class', // We extract methods, not the class itself
    'singleton_class', // `class << self`
  ];

  declarationTypes: string[] = [];

  functionTypes = ['method', 'singleton_method'];

  shouldExtractChildren(node: SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(_node: SyntaxNode): boolean {
    return false;
  }

  getContainerBody(node: SyntaxNode): SyntaxNode | null {
    if (this.containerTypes.includes(node.type)) {
      return node.childForFieldName('body');
    }
    return null;
  }

  shouldTraverseChildren(node: SyntaxNode): boolean {
    // `module` is treated as a transparent namespace: we traverse *through* it
    // (without it counting as a container nesting level) so that the common
    // `module → class → method` shape still yields method chunks. The shared
    // chunker caps extractable targets at one container deep, and a Ruby class
    // wrapped in a module would otherwise push methods out of range.
    return node.type === 'program' || node.type === 'body_statement' || node.type === 'module';
  }

  findParentContainerName(node: SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'class' || current.type === 'module') {
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
 * Ruby export extractor
 *
 * Ruby has no explicit export syntax. All top-level (module-level) definitions
 * are considered exported / loadable by other files:
 * - Classes: `class User; end`
 * - Modules: `module Billing; end`
 * - Methods: `def helper; end` and `def self.helper; end`
 * - Constants: `VERSION = '1.0'`
 */
export class RubyExportExtractor implements LanguageExportExtractor {
  private readonly exportableTypes = new Set(['method', 'singleton_method', 'class', 'module']);

  extractExports(rootNode: SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();

    const addExport = (name: string | undefined) => {
      if (name && !seen.has(name)) {
        seen.add(name);
        exports.push(name);
      }
    };

    rootNode.namedChildren.forEach(child => {
      if (this.exportableTypes.has(child.type)) {
        addExport(child.childForFieldName('name')?.text);
        return;
      }

      // Top-level constant assignment: `CONST = ...`
      if (child.type === 'assignment') {
        const left = child.childForFieldName('left');
        if (left?.type === 'constant') {
          addExport(left.text);
        }
      }
    });

    return exports;
  }
}

// =============================================================================
// IMPORT EXTRACTOR
// =============================================================================

/**
 * Ruby import extractor
 *
 * Handles require-like calls:
 * - require 'json'
 * - require_relative './foo'
 * - load 'config.rb'
 * - autoload :Bar, 'bar'
 */
export class RubyImportExtractor implements LanguageImportExtractor {
  // Require statements are method calls in Ruby; we filter by method name.
  readonly importNodeTypes = ['call'];

  extractImportPath(node: SyntaxNode): string | null {
    return extractRequirePath(node);
  }

  processImportSymbols(node: SyntaxNode): { importPath: string; symbols: string[] } | null {
    const importPath = extractRequirePath(node);
    if (!importPath) return null;
    return { importPath, symbols: [moduleBasename(importPath)] };
  }
}

// =============================================================================
// SYMBOL EXTRACTOR
// =============================================================================

/**
 * Ruby symbol extractor
 *
 * Handles:
 * - method (def foo)
 * - singleton_method (def self.foo)
 * - class (class Foo)
 * - module (module Foo) — mapped to the 'class' symbol type
 *
 * Call sites: call (foo(), obj.method())
 */
export class RubySymbolExtractor implements LanguageSymbolExtractor {
  readonly symbolNodeTypes = ['method', 'singleton_method', 'class', 'module'];

  extractSymbol(node: SyntaxNode, content: string, parentClass?: string): SymbolInfo | null {
    switch (node.type) {
      case 'method':
      case 'singleton_method':
        return this.extractMethodInfo(node, content, parentClass);
      case 'class':
        return this.extractClassInfo(node, 'class');
      case 'module':
        return this.extractClassInfo(node, 'module');
      default:
        return null;
    }
  }

  extractCallSite(node: SyntaxNode): { symbol: string; line: number; key: string } | null {
    if (node.type !== 'call') return null;

    const line = node.startPosition.row + 1;
    // For both `foo(...)` and `obj.foo(...)` the called name is the `method` field.
    const methodNode = node.childForFieldName('method');
    if (methodNode?.type === 'identifier') {
      return { symbol: methodNode.text, line, key: `${methodNode.text}:${line}` };
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
      complexity: calculateComplexity(node),
    };
  }

  private extractClassInfo(node: SyntaxNode, keyword: 'class' | 'module'): SymbolInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    // superclass node text includes the leading `<` (e.g. `< Base`).
    const superclass = node.childForFieldName('superclass');
    const signature = superclass
      ? `${keyword} ${nameNode.text} ${superclass.text}`
      : `${keyword} ${nameNode.text}`;

    return {
      name: nameNode.text,
      type: 'class',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature,
    };
  }
}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const rubyDefinition: LanguageDefinition = {
  id: 'ruby',
  extensions: ['rb'],
  traverser: new RubyTraverser(),
  exportExtractor: new RubyExportExtractor(),
  importExtractor: new RubyImportExtractor(),
  symbolExtractor: new RubySymbolExtractor(),

  complexity: {
    // Structural control-flow branch points. NOTE: Ruby's logical operators
    // (`&&`, `||`, `and`, `or`) are `binary` nodes, which the shared complexity
    // engine only counts for the `binary_expression`/`boolean_operator` node
    // types (JS/TS/Python). Counting generic `binary` here would also count
    // arithmetic, so logical operators are intentionally not scored for Ruby.
    decisionPoints: [
      'if',
      'elsif',
      'unless',
      'while',
      'until',
      'for',
      'when',
      'in_clause', // `case/in` pattern matching arm
      'rescue',
      'conditional', // ternary `a ? b : c`
      'if_modifier', // `x if y`
      'unless_modifier', // `x unless y`
      'while_modifier', // `x while y`
      'until_modifier', // `x until y`
    ],
    nestingTypes: ['if', 'unless', 'while', 'until', 'for', 'case', 'case_match', 'rescue'],
    nonNestingTypes: [
      'elsif',
      'when',
      'in_clause',
      'conditional',
      'if_modifier',
      'unless_modifier',
      'while_modifier',
      'until_modifier',
    ],
    lambdaTypes: ['block', 'do_block', 'lambda'],
    operatorSymbols: new Set([
      '+',
      '-',
      '*',
      '/',
      '%',
      '**',
      '==',
      '!=',
      '<',
      '>',
      '<=',
      '>=',
      '<=>',
      '=',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
      '**=',
      '||=',
      '&&=',
      '|=',
      '&=',
      '^=',
      '<<=',
      '>>=',
      '&',
      '|',
      '^',
      '~',
      '<<',
      '>>',
      '&&',
      '||',
      '!',
      '..',
      '...',
      '=>',
      '->',
      '::',
      '.',
      '&.',
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
    ]),
    operatorKeywords: new Set([
      'if',
      'elsif',
      'else',
      'unless',
      'while',
      'until',
      'for',
      'case',
      'when',
      'in',
      'do',
      'then',
      'begin',
      'rescue',
      'ensure',
      'raise',
      'return',
      'yield',
      'break',
      'next',
      'redo',
      'retry',
      'def',
      'class',
      'module',
      'self',
      'super',
      'and',
      'or',
      'not',
      'require',
      'require_relative',
      'lambda',
      'proc',
    ]),
  },

  symbols: {
    callExpressionTypes: ['call'],
  },
};

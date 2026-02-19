import PHPParser from 'tree-sitter-php';
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

  shouldExtractChildren(node: Parser.SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }

  isDeclarationWithFunction(_node: Parser.SyntaxNode): boolean {
    return false;
  }

  getContainerBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (
      node.type === 'class_declaration' ||
      node.type === 'trait_declaration' ||
      node.type === 'interface_declaration'
    ) {
      return node.childForFieldName('body');
    }
    return null;
  }

  shouldTraverseChildren(node: Parser.SyntaxNode): boolean {
    return node.type === 'program' || node.type === 'php' || node.type === 'declaration_list';
  }

  findParentContainerName(node: Parser.SyntaxNode): string | undefined {
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

  extractExports(rootNode: Parser.SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i);
      if (!child) continue;

      const childExports = this.extractExportsFromNode(child);
      childExports.forEach(exp => {
        if (exp && !seen.has(exp)) {
          seen.add(exp);
          exports.push(exp);
        }
      });
    }

    return exports;
  }

  private extractExportsFromNode(node: Parser.SyntaxNode): string[] {
    if (node.type === 'namespace_definition') {
      return this.extractExportsFromNamespace(node);
    }

    const name = this.extractExportableDeclaration(node);
    return name ? [name] : [];
  }

  private extractExportsFromNamespace(node: Parser.SyntaxNode): string[] {
    const exports: string[] = [];
    const body = node.childForFieldName('body');

    if (body) {
      for (let i = 0; i < body.namedChildCount; i++) {
        const child = body.namedChild(i);
        if (child) {
          const name = this.extractExportableDeclaration(child);
          if (name) exports.push(name);
        }
      }
    }

    return exports;
  }

  private extractExportableDeclaration(node: Parser.SyntaxNode): string | null {
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
 */
export class PHPImportExtractor implements LanguageImportExtractor {
  readonly importNodeTypes = ['namespace_use_declaration'];

  extractImportPath(node: Parser.SyntaxNode): string | null {
    return this.extractPHPUseDeclarationPath(node);
  }

  processImportSymbols(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const clause = node.namedChild(i);
      if (clause?.type !== 'namespace_use_clause') continue;

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

    return null;
  }

  private extractPHPUseDeclarationPath(node: Parser.SyntaxNode): string | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const clause = node.namedChild(i);
      if (clause?.type === 'namespace_use_clause') {
        return this.extractPHPQualifiedName(clause);
      }
    }
    return null;
  }

  private extractNamespaceParts(namespaceNode: Parser.SyntaxNode): string[] {
    const parts: string[] = [];
    for (let k = 0; k < namespaceNode.namedChildCount; k++) {
      const namePart = namespaceNode.namedChild(k);
      if (namePart?.type === 'name') {
        parts.push(namePart.text);
      }
    }
    return parts;
  }

  private extractQualifiedNameParts(qualifiedName: Parser.SyntaxNode): string[] {
    const parts: string[] = [];
    for (let j = 0; j < qualifiedName.namedChildCount; j++) {
      const part = qualifiedName.namedChild(j);
      if (part?.type === 'namespace_name') {
        parts.push(...this.extractNamespaceParts(part));
      } else if (part?.type === 'name') {
        parts.push(part.text);
      }
    }
    return parts;
  }

  private extractPHPQualifiedName(clause: Parser.SyntaxNode): string | null {
    for (let i = 0; i < clause.namedChildCount; i++) {
      const child = clause.namedChild(i);
      if (child?.type === 'qualified_name') {
        const parts = this.extractQualifiedNameParts(child);
        return parts.join('\\');
      }
    }
    return null;
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

  extractSymbol(node: Parser.SyntaxNode, content: string, parentClass?: string): SymbolInfo | null {
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

  extractCallSite(node: Parser.SyntaxNode): { symbol: string; line: number; key: string } | null {
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
}

// =============================================================================
// LANGUAGE DEFINITION
// =============================================================================

export const phpDefinition: LanguageDefinition = {
  id: 'php',
  extensions: ['php'],
  grammar: PHPParser.php,
  traverser: new PHPTraverser(),
  exportExtractor: new PHPExportExtractor(),
  importExtractor: new PHPImportExtractor(),
  symbolExtractor: new PHPSymbolExtractor(),

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

import type Parser from 'tree-sitter';
import type { LanguageTraverser, DeclarationFunctionInfo } from './types.js';

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
        // For `impl Type { ... }`, get the type name
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

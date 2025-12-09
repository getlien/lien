import type Parser from 'tree-sitter';
import type { LanguageTraverser, DeclarationFunctionInfo } from './types.js';

/**
 * PHP AST traverser
 * 
 * Handles PHP AST node types and traversal patterns.
 * PHP uses tree-sitter-php grammar.
 */
export class PHPTraverser implements LanguageTraverser {
  targetNodeTypes = [
    'function_definition',      // function foo() {}
    'method_declaration',       // public function bar() {}
  ];
  
  containerTypes = [
    'class_declaration',        // We extract methods, not the class itself
    'trait_declaration',        // PHP traits
    'interface_declaration',    // PHP interfaces (for interface methods)
  ];
  
  declarationTypes = [
    // PHP doesn't have arrow functions or const/let like JS
    // Functions are always defined with 'function' keyword
  ];
  
  functionTypes = [
    'function_definition',
    'method_declaration',
  ];
  
  shouldExtractChildren(node: Parser.SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }
  
  isDeclarationWithFunction(_node: Parser.SyntaxNode): boolean {
    // PHP doesn't have variable declarations with functions like JS/TS
    // Functions are always defined with 'function' keyword
    return false;
  }
  
  getContainerBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (node.type === 'class_declaration' || 
        node.type === 'trait_declaration' ||
        node.type === 'interface_declaration') {
      // In PHP, the body is called 'declaration_list'
      return node.childForFieldName('body');
    }
    return null;
  }
  
  shouldTraverseChildren(node: Parser.SyntaxNode): boolean {
    return node.type === 'program' ||           // Top-level PHP file
           node.type === 'php' ||               // PHP block
           node.type === 'declaration_list';    // Body of class/trait/interface
  }
  
  findParentContainerName(node: Parser.SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_declaration' || 
          current.type === 'trait_declaration') {
        const nameNode = current.childForFieldName('name');
        return nameNode?.text;
      }
      current = current.parent;
    }
    return undefined;
  }
  
  findFunctionInDeclaration(_node: Parser.SyntaxNode): DeclarationFunctionInfo {
    // PHP doesn't have this pattern
    return {
      hasFunction: false,
      functionNode: null,
    };
  }
}


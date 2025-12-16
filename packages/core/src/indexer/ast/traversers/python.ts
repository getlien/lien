import type Parser from 'tree-sitter';
import type { LanguageTraverser, DeclarationFunctionInfo } from './types.js';

/**
 * Python AST traverser
 * 
 * Handles Python AST node types and traversal patterns.
 * Python has a simpler structure than TypeScript/JavaScript:
 * - Functions are defined with 'def' or 'async def'
 * - No variable declarations with functions (unlike JS const x = () => {})
 * - Classes contain methods (which are just functions)
 */
export class PythonTraverser implements LanguageTraverser {
  targetNodeTypes = [
    'function_definition',
    'async_function_definition',
  ];
  
  containerTypes = [
    'class_definition',  // We extract methods, not the class itself
  ];
  
  declarationTypes = [
    // Python doesn't have const/let/var declarations like JS/TS
    // Functions are always defined with 'def' or 'async def'
  ];
  
  functionTypes = [
    'function_definition',
    'async_function_definition',
  ];
  
  shouldExtractChildren(node: Parser.SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }
  
  isDeclarationWithFunction(_node: Parser.SyntaxNode): boolean {
    // Python doesn't have variable declarations with functions like JS/TS
    // Functions are always defined with 'def' or 'async def'
    return false;
  }
  
  getContainerBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (node.type === 'class_definition') {
      // In Python, the class body is called 'block'
      return node.childForFieldName('body');
    }
    return null;
  }
  
  shouldTraverseChildren(node: Parser.SyntaxNode): boolean {
    return node.type === 'module' ||  // Top-level Python file
           node.type === 'block';     // Body of class/function
  }
  
  findParentContainerName(node: Parser.SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_definition') {
        const nameNode = current.childForFieldName('name');
        return nameNode?.text;
      }
      current = current.parent;
    }
    return undefined;
  }
  
  /**
   * Python doesn't have this pattern (const x = () => {})
   * Functions are always defined with 'def' or 'async def'
   */
  findFunctionInDeclaration(_node: Parser.SyntaxNode): DeclarationFunctionInfo {
    return {
      hasFunction: false,
      functionNode: null,
    };
  }
}


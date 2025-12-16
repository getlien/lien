import type Parser from 'tree-sitter';
import type { LanguageTraverser, DeclarationFunctionInfo } from './types.js';

/**
 * TypeScript/JavaScript AST traverser
 * 
 * Handles TypeScript and JavaScript AST node types and traversal patterns.
 * Both languages share the same AST structure (via tree-sitter-typescript).
 */
export class TypeScriptTraverser implements LanguageTraverser {
  targetNodeTypes = [
    'function_declaration',
    'function',
    'interface_declaration',
    'method_definition',
    'lexical_declaration',    // For const/let with arrow functions
    'variable_declaration',   // For var with functions
  ];
  
  containerTypes = [
    'class_declaration',      // We extract methods, not the class itself
  ];
  
  declarationTypes = [
    'lexical_declaration',    // const/let
    'variable_declaration',   // var
  ];
  
  functionTypes = [
    'arrow_function',
    'function_expression',
    'function',
  ];
  
  shouldExtractChildren(node: Parser.SyntaxNode): boolean {
    return this.containerTypes.includes(node.type);
  }
  
  isDeclarationWithFunction(node: Parser.SyntaxNode): boolean {
    return this.declarationTypes.includes(node.type);
  }
  
  getContainerBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (node.type === 'class_declaration') {
      return node.childForFieldName('body');
    }
    return null;
  }
  
  shouldTraverseChildren(node: Parser.SyntaxNode): boolean {
    return node.type === 'program' || 
           node.type === 'export_statement' ||
           node.type === 'class_body';
  }
  
  findParentContainerName(node: Parser.SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_declaration') {
        const nameNode = current.childForFieldName('name');
        return nameNode?.text;
      }
      current = current.parent;
    }
    return undefined;
  }
  
  /**
   * Check if a declaration node contains a function (arrow, function expression, etc.)
   */
  findFunctionInDeclaration(node: Parser.SyntaxNode): DeclarationFunctionInfo {
    const search = (n: Parser.SyntaxNode, depth: number): Parser.SyntaxNode | null => {
      if (depth > 3) return null; // Don't search too deep
      
      if (this.functionTypes.includes(n.type)) {
        return n;
      }
      
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) {
          const result = search(child, depth + 1);
          if (result) return result;
        }
      }
      
      return null;
    };
    
    const functionNode = search(node, 0);
    return {
      hasFunction: functionNode !== null,
      functionNode,
    };
  }
}

/**
 * JavaScript uses the same traverser as TypeScript
 */
export class JavaScriptTraverser extends TypeScriptTraverser {}


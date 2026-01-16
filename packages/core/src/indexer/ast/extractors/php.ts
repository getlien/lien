import type Parser from 'tree-sitter';
import type { LanguageExportExtractor } from './types.js';

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
  /**
   * Node types that represent exportable PHP declarations
   */
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
  
  /**
   * Extract PHP exports from a single AST node
   * Handles both direct declarations and namespace definitions
   */
  private extractExportsFromNode(node: Parser.SyntaxNode): string[] {
    if (node.type === 'namespace_definition') {
      return this.extractExportsFromNamespace(node);
    }
    
    const name = this.extractExportableDeclaration(node);
    return name ? [name] : [];
  }
  
  /**
   * Extract exports from within a PHP namespace definition
   */
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
  
  /**
   * Extract the name from a PHP exportable declaration (class, trait, interface, function)
   */
  private extractExportableDeclaration(node: Parser.SyntaxNode): string | null {
    if (this.exportableTypes.has(node.type)) {
      const nameNode = node.childForFieldName('name');
      return nameNode ? nameNode.text : null;
    }
    
    return null;
  }
}

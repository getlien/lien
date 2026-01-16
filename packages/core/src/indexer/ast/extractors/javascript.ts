import type Parser from 'tree-sitter';
import type { LanguageExportExtractor } from './types.js';

/**
 * JavaScript/TypeScript export extractor
 * 
 * Handles explicit export statements:
 * - Named exports: export { foo, bar }
 * - Declaration exports: export function foo() {}, export const bar = ...
 * - Default exports: export default ...
 * - Re-exports: export { foo } from './module'
 */
export class JavaScriptExportExtractor implements LanguageExportExtractor {
  extractExports(rootNode: Parser.SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();
    
    const addExport = (name: string) => {
      if (name && !seen.has(name)) {
        seen.add(name);
        exports.push(name);
      }
    };
    
    // Process only top-level export statements
    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i);
      if (child?.type === 'export_statement') {
        this.extractExportStatementSymbols(child, addExport);
      }
    }
    
    return exports;
  }
  
  /**
   * Extract symbols from a single export statement
   */
  private extractExportStatementSymbols(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
    // Check for default export
    const defaultKeyword = node.children.find(c => c.type === 'default');
    if (defaultKeyword) {
      addExport('default');
    }
    
    // Check for declaration (export function/const/class)
    const declaration = node.childForFieldName('declaration');
    if (declaration) {
      this.extractDeclarationExports(declaration, addExport);
    }
    
    // Check for export clause (export { foo, bar })
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'export_clause') {
        this.extractExportClauseSymbols(child, addExport);
      }
    }
  }
  
  /**
   * Extract exported names from a declaration (function, const, class, interface)
   */
  private extractDeclarationExports(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
    // function/class/interface declaration
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      addExport(nameNode.text);
      return;
    }
    
    // lexical_declaration: const/let declarations
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child?.type === 'variable_declarator') {
          const varName = child.childForFieldName('name');
          if (varName) {
            addExport(varName.text);
          }
        }
      }
    }
  }
  
  /**
   * Extract symbol names from export clause: export { foo, bar as baz }
   */
  private extractExportClauseSymbols(node: Parser.SyntaxNode, addExport: (name: string) => void): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'export_specifier') {
        // Use alias if present, otherwise use the name
        const aliasNode = child.childForFieldName('alias');
        const nameNode = child.childForFieldName('name');
        const exported = aliasNode?.text || nameNode?.text;
        if (exported) {
          addExport(exported);
        }
      }
    }
  }
}

/**
 * TypeScript uses the same export extraction as JavaScript
 */
export class TypeScriptExportExtractor extends JavaScriptExportExtractor {}

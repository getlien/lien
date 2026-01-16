import type Parser from 'tree-sitter';
import type { LanguageExportExtractor } from './types.js';

/**
 * Python export extractor
 * 
 * Python doesn't have explicit export syntax. All module-level (top-level)
 * declarations are considered exported (importable by other modules):
 * - Classes: class User: ...
 * - Functions: def helper(): ...
 * - Async functions: async def fetch_data(): ...
 * 
 * Note: Only top-level definitions are tracked. Nested functions/classes
 * inside other functions are not considered exports.
 */
export class PythonExportExtractor implements LanguageExportExtractor {
  /**
   * Node types that represent exportable Python declarations
   */
  private readonly exportableTypes = new Set([
    'class_definition',
    'function_definition',
    'async_function_definition',
  ]);
  
  extractExports(rootNode: Parser.SyntaxNode): string[] {
    const exports: string[] = [];
    const seen = new Set<string>();
    
    const addExport = (name: string) => {
      if (name && !seen.has(name)) {
        seen.add(name);
        exports.push(name);
      }
    };
    
    // Process only top-level nodes (module-level definitions)
    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i);
      if (!child) continue;
      
      // Handle decorated definitions (@dataclass, @property, etc.)
      // Decorators wrap the actual definition in a 'decorated_definition' node
      if (child.type === 'decorated_definition') {
        const definition = child.childForFieldName('definition');
        if (definition && this.exportableTypes.has(definition.type)) {
          const nameNode = definition.childForFieldName('name');
          if (nameNode) addExport(nameNode.text);
        }
        continue;
      }
      
      // Extract name from exportable node types
      if (this.exportableTypes.has(child.type)) {
        const nameNode = child.childForFieldName('name');
        if (nameNode) addExport(nameNode.text);
      }
    }
    
    return exports;
  }
}

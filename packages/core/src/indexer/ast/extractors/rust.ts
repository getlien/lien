import type Parser from 'tree-sitter';
import type { LanguageExportExtractor } from './types.js';

/**
 * Rust export extractor
 *
 * Rust uses `pub` visibility to mark items as exported. Items with a
 * `visibility_modifier` child (e.g., `pub`, `pub(crate)`) are considered exports.
 *
 * Exportable items:
 * - pub fn helper() {}
 * - pub struct User {}
 * - pub enum Status {}
 * - pub trait Serialize {}
 * - pub type Alias = ...
 * - pub const VALUE: ... = ...
 * - pub static GLOBAL: ... = ...
 * - pub mod submodule;
 * - pub use other::Thing;  (re-exports)
 */
export class RustExportExtractor implements LanguageExportExtractor {
  /**
   * Node types that represent exportable Rust declarations
   */
  private readonly exportableTypes = new Set([
    'function_item',
    'struct_item',
    'enum_item',
    'trait_item',
    'type_item',
    'const_item',
    'static_item',
    'mod_item',
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

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i);
      if (!child) continue;
      if (!this.hasVisibilityModifier(child)) continue;

      this.extractExportName(child, addExport);
    }

    return exports;
  }

  /**
   * Extract the export name from a pub-visible node.
   * Handles use declarations (re-exports) and standard exportable items.
   */
  private extractExportName(
    node: Parser.SyntaxNode,
    addExport: (name: string) => void
  ): void {
    if (node.type === 'use_declaration') {
      const argument = node.childForFieldName('argument');
      const name = argument ? this.extractUseExportName(argument) : null;
      if (name) addExport(name);
      return;
    }

    if (this.exportableTypes.has(node.type)) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) addExport(nameNode.text);
    }
  }

  /**
   * Check if a node has a visibility modifier (pub, pub(crate), etc.)
   */
  private hasVisibilityModifier(node: Parser.SyntaxNode): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'visibility_modifier') return true;
    }
    return false;
  }

  /**
   * Extract the name from a use declaration's argument
   * e.g., `foo::Bar` -> "Bar", `foo::*` -> null, `foo::{A, B}` -> null
   */
  private extractUseExportName(node: Parser.SyntaxNode): string | null {
    // Simple path: `use foo::Bar;` -> extract last segment
    if (node.type === 'scoped_identifier') {
      const nameNode = node.childForFieldName('name');
      return nameNode?.text ?? null;
    }
    // Direct identifier: `use Bar;`
    if (node.type === 'identifier') {
      return node.text;
    }
    // Glob or use list: `use foo::*` or `use foo::{A, B}` — skip
    return null;
  }
}

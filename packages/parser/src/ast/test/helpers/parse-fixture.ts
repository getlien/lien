import { parseAST } from '../../parser.js';
import type { SyntaxNode } from '../../types.js';
import type { SupportedLanguage } from '../../languages/registry.js';

/**
 * Parse `code` via the package's own public parseAST() (native is the only
 * backend as of ADR-013 Phase 4-B -- the legacy node-tree-sitter fallback
 * was removed) and return the root SyntaxNode.
 *
 * Replaces the pre-4-B `new Parser()` + `parser.setLanguage(Grammar)` +
 * `parser.parse(code)` trio that language/*.test.ts and extractors.test.ts
 * used to build trees directly against node-tree-sitter grammars.
 *
 * @throws Error if parseAST fails to produce a tree (a genuine parse
 *   failure, not something these fixture-driven tests expect to hit).
 */
export function mustParse(code: string, language: SupportedLanguage): SyntaxNode {
  const { tree, error } = parseAST(code, language);
  if (!tree) {
    throw new Error(`mustParse(${language}) failed to produce a tree: ${error}`);
  }
  return tree.rootNode;
}

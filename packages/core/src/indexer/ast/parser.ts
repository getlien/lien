import Parser from 'tree-sitter';
import { getLanguage, detectLanguage as registryDetectLanguage } from './languages/registry.js';
import type { SupportedLanguage } from './languages/registry.js';
import type { ASTParseResult } from './types.js';

/**
 * Cache for parser instances to avoid recreating them
 */
const parserCache = new Map<SupportedLanguage, Parser>();

/**
 * Get or create a cached parser instance for a language
 */
function getParser(language: SupportedLanguage): Parser {
  if (!parserCache.has(language)) {
    const parser = new Parser();
    const grammar = getLanguage(language).grammar;

    parser.setLanguage(grammar);
    parserCache.set(language, parser);
  }

  return parserCache.get(language)!;
}

/**
 * Detect language from file extension.
 * Re-exported from the language registry for backwards compatibility.
 */
export const detectLanguage = registryDetectLanguage;

/**
 * Check if a file is supported for AST parsing
 */
export function isASTSupported(filePath: string): boolean {
  return detectLanguage(filePath) !== null;
}

/**
 * Parse source code into an AST using Tree-sitter
 *
 * **Known Limitation:** Tree-sitter may throw "Invalid argument" errors on very large files
 * (1000+ lines). This is a limitation of Tree-sitter's internal buffer handling. When this
 * occurs, callers should fall back to line-based chunking (handled automatically by chunker.ts).
 *
 * @param content - Source code to parse
 * @param language - Programming language
 * @returns Parse result with tree or error
 */
export function parseAST(content: string, language: SupportedLanguage): ASTParseResult {
  try {
    const parser = getParser(language);
    const tree = parser.parse(content);

    // Check for parse errors (hasError is a property, not a method)
    if (tree.rootNode.hasError) {
      return {
        tree,
        error: 'Parse completed with errors',
      };
    }

    return { tree };
  } catch (error) {
    return {
      tree: null,
      error: error instanceof Error ? error.message : 'Unknown parse error',
    };
  }
}

/**
 * Clear parser cache (useful for testing)
 */
export function clearParserCache(): void {
  parserCache.clear();
}

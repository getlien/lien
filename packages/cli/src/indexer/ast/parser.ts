import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';
import PHPParser from 'tree-sitter-php';
import { extname } from 'path';
import type { ASTParseResult, SupportedLanguage } from './types.js';

/**
 * Cache for parser instances to avoid recreating them
 */
const parserCache = new Map<SupportedLanguage, Parser>();

/**
 * Tree-sitter language grammar type
 * (Tree-sitter doesn't export a specific Language type, so we define one)
 */
type TreeSitterLanguage = object;

/**
 * Language configuration mapping
 */
const languageConfig: Record<SupportedLanguage, TreeSitterLanguage> = {
  typescript: TypeScript.typescript,
  javascript: JavaScript,
  php: PHPParser.php, // Note: tree-sitter-php exports both 'php' (mixed HTML/PHP) and 'php_only'
};

/**
 * Get or create a cached parser instance for a language
 */
function getParser(language: SupportedLanguage): Parser {
  if (!parserCache.has(language)) {
    const parser = new Parser();
    const grammar = languageConfig[language];
    
    if (!grammar) {
      throw new Error(`No grammar available for language: ${language}`);
    }
    
    parser.setLanguage(grammar);
    parserCache.set(language, parser);
  }
  
  return parserCache.get(language)!;
}

/**
 * Detect language from file extension
 * Uses path.extname() to handle edge cases like multiple dots in filenames
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
  // extname returns extension with leading dot (e.g., '.ts')
  // Remove the dot and convert to lowercase
  const ext = extname(filePath).slice(1).toLowerCase();
  
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'php':
      return 'php';
    default:
      return null;
  }
}

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


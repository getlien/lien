import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';
import type { ASTParseResult, SupportedLanguage } from './types.js';

/**
 * Cache for parser instances to avoid recreating them
 */
const parserCache = new Map<SupportedLanguage, Parser>();

/**
 * Language configuration mapping
 */
const languageConfig: Record<SupportedLanguage, any> = {
  typescript: TypeScript.typescript,
  javascript: JavaScript, // Use proper JavaScript parser
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
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
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
 * Parse source code into an AST
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


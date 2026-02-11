import type { LanguageTraverser } from '../traversers/types.js';
import type {
  LanguageExportExtractor,
  LanguageImportExtractor,
  LanguageSymbolExtractor,
} from '../extractors/types.js';
import type { SupportedLanguage } from './registry.js';

/**
 * Tree-sitter language grammar type.
 * Using any due to type incompatibility between parser packages and tree-sitter core.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TreeSitterLanguage = any;

/**
 * Complete definition for a language supported by AST parsing.
 *
 * Each supported language has a single definition file that assembles
 * all language-specific data (grammar, traverser, extractor, complexity
 * constants, symbol types) into one place.
 */
export interface LanguageDefinition {
  /** Language identifier (e.g., 'typescript', 'python') */
  id: SupportedLanguage;

  /** File extensions without dots (e.g., ['ts', 'tsx']) */
  extensions: string[];

  /** Tree-sitter grammar object for parsing */
  grammar: TreeSitterLanguage;

  /** Language-specific AST traverser instance */
  traverser: LanguageTraverser;

  /** Language-specific export extractor instance */
  exportExtractor: LanguageExportExtractor;

  /** Language-specific import extractor instance (optional for backwards compatibility) */
  importExtractor?: LanguageImportExtractor;

  /** Language-specific symbol extractor instance (optional for backwards compatibility) */
  symbolExtractor?: LanguageSymbolExtractor;

  /** Complexity metric configuration */
  complexity: {
    /** Cyclomatic: AST node types that represent decision points */
    decisionPoints: string[];

    /** Cognitive: node types that increase complexity AND increment nesting */
    nestingTypes: string[];

    /** Cognitive: node types that add complexity but don't nest */
    nonNestingTypes: string[];

    /** Cognitive: lambda/closure types that add complexity when nested */
    lambdaTypes: string[];

    /** Halstead: operator symbol characters (e.g., +, -, &&) */
    operatorSymbols: Set<string>;

    /** Halstead: keyword operators (e.g., if, while, return) */
    operatorKeywords: Set<string>;
  };

  /** Symbol extraction configuration */
  symbols: {
    /** AST node types representing function/method calls */
    callExpressionTypes: string[];
  };
}

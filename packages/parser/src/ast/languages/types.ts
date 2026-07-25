import type { LanguageTraverser } from '../traversers/types.js';
import type {
  LanguageExportExtractor,
  LanguageImportExtractor,
  LanguageSymbolExtractor,
} from '../extractors/types.js';
import type { SupportedLanguage } from './registry.js';

/**
 * Complete definition for a language supported by AST parsing.
 *
 * Each supported language has a single definition file that assembles
 * all language-specific data (traverser, extractor, complexity constants,
 * symbol types) into one place. Prior to ADR-013 Phase 4-B this also held
 * a `grammar` field (the node-tree-sitter grammar object); the native
 * backend has no equivalent -- @liendev/parser-native selects its grammar
 * internally by language id (see ast/parser.ts's parseTree call).
 */
export interface LanguageDefinition {
  /** Language identifier (e.g., 'typescript', 'python') */
  id: SupportedLanguage;

  /** File extensions without dots (e.g., ['ts', 'tsx']) */
  extensions: string[];

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

  /**
   * True when this language's typical test files import their subject as a
   * whole module (e.g. Swift's `import Alamofire` / `@testable import
   * Alamofire`) rather than a specific per-file/per-symbol path, so
   * `chunk.metadata.imports` carries no per-file signal an import-based
   * test-association matcher (`matchesFile`) can ever resolve to a specific
   * source file. This is a structural gap, not a matching bug (#869) — no
   * heuristic recovers it here. Absent/false (the default for every
   * language except Swift) means the existing per-file import matching
   * applies as before; unset is NOT the same as "confirmed false", it's just
   * unconfirmed, so only set this where the whole-module convention has
   * been verified against real code.
   */
  wholeModuleImports?: boolean;

  /**
   * True when this language lets a nested namespace body reference an
   * *enclosing* namespace's members unqualified, with no `using`/`import`
   * directive at all (C# confirmed — see ECMA-334 simple-name resolution:
   * `namespace AutoMapper.UnitTests { ... }` gets implicit access to
   * `AutoMapper`'s public members purely because it's a dotted-nested
   * namespace, never emitting an import for it). Unlike `wholeModuleImports`,
   * this does NOT mean per-file import matching is universally useless for
   * the language — C#'s dotted `using X.Y;` still resolves real per-file
   * associations correctly (#866/#868) — so this must stay a *separate* flag
   * a caller only consults as a last-resort, empty-associations fallback
   * (see `hasEnclosingNamespaceAccess` and its one call site in
   * `annotate-cmd.ts`'s `formatTests`), never folded into
   * `wholeModuleImports` or `isUnresolvableWholeModuleImport` (#875).
   */
  enclosingNamespaceAccess?: boolean;
}

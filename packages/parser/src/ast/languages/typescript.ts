import type { LanguageDefinition } from './types.js';
import {
  TypeScriptTraverser,
  TypeScriptExportExtractor,
  TypeScriptImportExtractor,
  TypeScriptSymbolExtractor,
  jsTsComplexityConfig,
} from './javascript.js';

export const typescriptDefinition: LanguageDefinition = {
  id: 'typescript',
  extensions: ['ts', 'tsx'],
  traverser: new TypeScriptTraverser(),
  exportExtractor: new TypeScriptExportExtractor(),
  importExtractor: new TypeScriptImportExtractor(),
  symbolExtractor: new TypeScriptSymbolExtractor(),

  complexity: jsTsComplexityConfig,

  symbols: {
    callExpressionTypes: ['call_expression', 'new_expression'],
  },
};

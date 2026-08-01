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

  // ADR-015 (#1038): verified against a real corpus (zod), not inherited.
  // TypeScript's import extractor stores the raw specifier text verbatim
  // (see `javascript.ts`'s shared `JavaScriptImportExtractor`), but a
  // relative (`./x`) or workspace-package specifier is already resolved to a
  // concrete file upstream (`ast/symbols.ts`'s `resolveRelativeImport`/
  // `resolveWorkspaceImport`), before `matchesFile` ever runs -- so a bare
  // specifier that reaches these flags is a genuinely external npm package
  // with no corresponding local file, never the language's own typical
  // whole-module test-import convention Swift's flag exists for.
  // `wholeModuleImports: false`: no whole-module-only import shape exists --
  // every internal zod import found (`packages/zod/src/v3/types.ts:10-35`)
  // is an ordinary relative specifier (`"./errors.js"`, `"./helpers/util.js"`).
  wholeModuleImports: false,
  // `singleFileImports: false`: preserves the permissive default. A real
  // bare MULTI-segment specifier does occur (`zod/v3` in
  // `packages/zod/src/v3/tests/array.test.ts:4`, a package.json `exports`
  // subpath resolving to exactly one file, `src/v3/index.ts`), but it
  // doesn't reach Strategies 1/2 at all (no literal substring match against
  // the normalized target once path-matching runs -- a separate, pre-existing
  // gap in subpath-`exports` resolution, not something this flag governs
  // either way), so there is no live case for this flag to disambiguate.
  singleFileImports: false,
  // `namespaceStyleImports: false`: TypeScript specifiers are relative paths
  // or npm package names, never a case-insensitive directory-mirroring
  // namespace -- confirmed no such convention in the zod corpus.
  namespaceStyleImports: false,

  complexity: jsTsComplexityConfig,

  symbols: {
    callExpressionTypes: ['call_expression', 'new_expression'],
  },
};

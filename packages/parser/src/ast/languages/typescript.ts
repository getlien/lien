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
  // (see `javascript.ts`'s shared `JavaScriptImportExtractor`), and a
  // relative (`./x`) specifier is resolved to a concrete file upstream
  // (`ast/symbols.ts`'s `resolveRelativeImport`) before `matchesFile` ever
  // runs. Correction from an earlier draft of this comment, caught during
  // verification: it is NOT true that every remaining bare specifier is a
  // genuinely external npm package. `resolveWorkspaceImport` only resolves
  // an EXACT bare package name from an npm/yarn `workspaces` field
  // (`workspace-packages.ts`) -- zod itself is a pnpm workspace (no npm
  // `workspaces` field; `pnpm-workspace.yaml` is deliberately out of that
  // resolver's v1 scope), so zod's own 165 internal SUBPATH self-references
  // (`zod/v3`, `zod/v4`, etc. -- see `singleFileImports` below) reach these
  // flags unresolved too, not because they're external, but because subpath
  // `exports` resolution is a separate, out-of-scope gap. Either way --
  // genuinely external, or an unresolved internal subpath -- neither is the
  // language's own typical whole-module test-import convention Swift's flag
  // exists for, so the value below is unaffected; only the reasoning
  // needed correcting.
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

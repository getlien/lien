import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { detectLanguage as registryDetectLanguage } from './languages/registry.js';
import type { SupportedLanguage } from './languages/registry.js';
import type { ASTParseResult } from './types.js';
import { resolveParserBackend } from './backend.js';
import { buildCompatTree } from './native/index.js';
import type { WireNode } from '@liendev/parser-native';

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
 * Thrown when the native parser binding itself fails to load (no
 * prebuilt/local build for this platform) -- as distinct from a per-file
 * parse failure. This is a systemic, process-wide condition: ADR-013
 * Phase 4-B removed the legacy node-tree-sitter backend that per-file
 * failures used to fall back to, so this must propagate rather than be
 * swallowed by generic error handling.
 *
 * Callers that catch broad `Error`s around AST parsing (notably
 * chunker.ts's `astFallback` catch, which otherwise degrades any thrown
 * error to line-based chunking) MUST check for this type with
 * `instanceof` and re-throw it unconditionally -- see chunker.ts.
 */
export class NativeBindingLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeBindingLoadError';
  }
}

/**
 * Lazily-loaded, cached handle on the native binding. `null` until a
 * successful load (see loadNativeBinding); a failed load is cached
 * separately in nativeLoadError instead.
 */
let nativeBinding: typeof import('@liendev/parser-native') | null = null;

/**
 * Cached failure from the one and only load attempt this process will ever
 * make (see loadNativeBinding) -- reused on every subsequent call so a
 * missing prebuilt/local build pays the (failing) require() exactly once,
 * not once per file, while still surfacing the same actionable error on
 * every call.
 */
let nativeLoadError: NativeBindingLoadError | null = null;

/**
 * Walk up node_modules directories from `startDir` looking for `packageName`.
 * Used instead of a specifier-based resolver (see loadNativeBinding) so this
 * works identically whether the package is a workspace symlink (dev) or a
 * real node_modules copy (published consumer).
 */
function findPackageDir(startDir: string, packageName: string): string {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', packageName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not resolve "${packageName}" from "${startDir}"`);
    }
    dir = parent;
  }
}

/**
 * Load (and cache) the native parseTree() binding, or throw a clear,
 * actionable error naming the platform and the remedy.
 *
 * @liendev/parser-native is ESM-only (its package.json exports map has no
 * "require"/"default" condition), so a bare `require('@liendev/parser-native')`
 * would throw ERR_PACKAGE_PATH_NOT_EXPORTED -- and `import.meta.resolve`
 * (the alternative) is not implemented by Vitest's module runner, which
 * this package's own test suite runs under. `import()` is async and
 * parseAST must stay synchronous (it is a widely-used sync API today), so
 * instead: locate the package directory with a plain node_modules walk
 * (see findPackageDir), read its own package.json to find the real entry
 * file, and `require()` that resolved absolute path directly. Direct-path
 * `require()` is governed only by the target file's own nearest
 * package.json "type" field, not by any exports-map condition matching --
 * Node's `require(esm)` support (stable by default since Node 22.12, below
 * this monorepo's >=22.21.0 floor) loads that plain synchronous ESM file
 * (no top-level await) synchronously.
 *
 * ADR-013 Phase 4-B removed the legacy (node-tree-sitter) fallback, so a
 * load failure here is no longer a per-file, silently-degradable condition
 * -- there is no other backend left to hand parsing off to. It is thrown
 * (not returned as `{tree: null, error}`), once, with a message that names
 * the remedy; see parseAST for why this must propagate rather than be
 * folded into the normal per-file parse-error result shape.
 */
function loadNativeBinding(): typeof import('@liendev/parser-native') {
  if (nativeBinding) return nativeBinding;
  if (nativeLoadError) throw nativeLoadError;

  try {
    const startDir = path.dirname(fileURLToPath(import.meta.url));
    const packageDir = findPackageDir(startDir, '@liendev/parser-native');
    const pkgJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      main?: string;
      exports?: { '.'?: { import?: string } };
    };
    const entry = pkgJson.exports?.['.']?.import ?? pkgJson.main ?? 'index.js';
    const require = createRequire(import.meta.url);
    nativeBinding = require(
      path.join(packageDir, entry),
    ) as typeof import('@liendev/parser-native');
    return nativeBinding;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    nativeLoadError = new NativeBindingLoadError(
      `[lien] Failed to load the native parser binding (@liendev/parser-native) on ` +
        `${process.platform}-${process.arch}: ${reason}\n` +
        `This usually means no prebuilt @liendev/parser-native package exists for your ` +
        `platform/arch and no local build was found. See docs/architecture/native-parser.md ` +
        `for how to build one. (The legacy node-tree-sitter backend has been removed ` +
        `(see ADR-013), so there is no fallback.)`,
    );
    throw nativeLoadError;
  }
}

/**
 * Parse source code into an AST via @liendev/parser-native plus the compat
 * deserializer in ./native/ -- see docs/architecture/native-parser.md for
 * the wire format and compat contract.
 *
 * `loadNativeBinding()` is deliberately called outside the try/catch below:
 * a binding that cannot load at all is a systemic, process-wide failure
 * (missing prebuilt/local build), not a per-file parse problem, and ADR-013
 * Phase 4-B removed the legacy backend that used to catch that fall. Letting
 * it throw once (loudly, with an actionable message, as a `NativeBindingLoadError`)
 * is preferable to folding it into `{tree: null, error}` -- the latter reads
 * identically to an ordinary per-file syntax error and would let every file
 * in a scan silently degrade to line-based chunking. Callers that catch
 * broad errors around parsing (chunker.ts's `astFallback`) check for
 * `NativeBindingLoadError` specifically and re-throw it regardless of
 * fallback policy, so this guarantee holds all the way up to `chunkFile`.
 * A genuine per-file issue (a JSON.parse or compat-tree-build failure on
 * this file's own output) still returns `{tree: null, error}` as before.
 *
 * @param content - Source code to parse
 * @param language - Programming language
 * @returns Parse result with tree or error
 * @throws NativeBindingLoadError if the native binding cannot be loaded at
 *   all. @throws Error if LIEN_PARSER is set to an invalid or retired value
 *   (see ./backend.ts).
 */
export function parseAST(content: string, language: SupportedLanguage): ASTParseResult {
  resolveParserBackend(); // validates LIEN_PARSER; throws on invalid/retired values

  const { parseTree } = loadNativeBinding();

  try {
    const wireRoot: WireNode = JSON.parse(parseTree(language, content));
    const tree = buildCompatTree(wireRoot, content);

    if (tree.rootNode.hasError) {
      return { tree, error: 'Parse completed with errors' };
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
 * Clear parser cache (useful for testing). Resets the native-load-failure
 * cache (see loadNativeBinding) so a test can simulate a fresh process --
 * the native binding handle itself (nativeBinding) is intentionally left
 * cached, since a successful load is always safe to reuse.
 */
export function clearParserCache(): void {
  nativeLoadError = null;
}

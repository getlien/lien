import Parser from 'tree-sitter';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { getLanguage, detectLanguage as registryDetectLanguage } from './languages/registry.js';
import type { SupportedLanguage } from './languages/registry.js';
import type { ASTParseResult } from './types.js';
import { resolveParserBackend, isBackendUnset } from './backend.js';
import { buildCompatTree } from './native/index.js';
import type { WireNode } from '@liendev/parser-native';

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
 * Lazily-loaded, cached handle on the native binding.
 */
let nativeBinding: typeof import('@liendev/parser-native') | null = null;

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
 * Load (and cache) the native parseTree() binding. Only ever called from
 * the native path below -- legacy mode must never load the binary.
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
 */
function loadNativeBinding(): typeof import('@liendev/parser-native') {
  if (!nativeBinding) {
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
  }
  return nativeBinding;
}

/**
 * Legacy (node-tree-sitter) parse path.
 */
function parseLegacy(content: string, language: SupportedLanguage): ASTParseResult {
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
 * Native (@liendev/parser-native) parse path. No parser-instance cache is
 * needed: unlike node-tree-sitter's stateful Parser object, parseTree() is
 * a single stateless call per parse -- there is no long-lived native
 * object to reuse or evict on the JS side.
 */
function parseNative(content: string, language: SupportedLanguage): ASTParseResult {
  try {
    const { parseTree } = loadNativeBinding();
    const wireRoot: WireNode = JSON.parse(parseTree(language, content));
    const tree = buildCompatTree(wireRoot, content);

    if (tree.rootNode.hasError) {
      return {
        tree: tree as unknown as Parser.Tree,
        error: 'Parse completed with errors',
      };
    }

    return { tree: tree as unknown as Parser.Tree };
  } catch (error) {
    return {
      tree: null,
      error: error instanceof Error ? error.message : 'Unknown parse error',
    };
  }
}

/**
 * Cached decision for the default (LIEN_PARSER unset) path: whether the
 * native binding failed to *load* and every subsequent call this process
 * must run legacy instead. `null` = not yet decided. Populated once by
 * shouldFallBackToLegacy() so a missing prebuilt/local build only pays the
 * (failing) load attempt once per process, not once per file.
 */
let fellBackToLegacy: boolean | null = null;

/**
 * Transitional fallback (ADR-013 Phase 4-A): on the default path only
 * (LIEN_PARSER unset), attempt to load the native binding and, on failure,
 * permanently switch this process to legacy while emitting exactly one
 * console.warn naming the platform, the fallback, and the remedy.
 *
 * This only covers *load* failure -- the binding cannot be obtained at all
 * (e.g. no prebuilt package for this platform/arch and no local build
 * present). A per-file parse error from an already-loaded binding (a real
 * syntax error, `hasError`, etc.) must never reach here -- that is normal
 * chunker-fallback territory handled entirely inside parseNative's own
 * try/catch, which still runs afterwards for every file.
 *
 * An explicit `LIEN_PARSER=native` never calls this -- see parseAST -- so
 * CI's dedicated native job and any user who opted in on purpose keep
 * today's fail-into-`{tree:null,error}` semantics instead of a silent
 * downgrade.
 */
function shouldFallBackToLegacy(): boolean {
  if (fellBackToLegacy !== null) return fellBackToLegacy;

  try {
    loadNativeBinding();
    fellBackToLegacy = false;
  } catch (error) {
    fellBackToLegacy = true;
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[lien] Native parser binding failed to load on ${process.platform}-${process.arch}: ${reason}\n` +
        `Falling back to the legacy (node-tree-sitter) parser backend for the rest of this run. ` +
        `This usually means no prebuilt @liendev/parser-native package exists for your platform ` +
        `and no local build was found. To build one, see ` +
        `docs/architecture/native-parser.md; to silence this warning, set LIEN_PARSER=legacy ` +
        `explicitly. (Legacy is scheduled for removal in a future release -- see ADR-013.)`,
    );
  }

  return fellBackToLegacy;
}

/**
 * Parse source code into an AST.
 *
 * Backend selected by LIEN_PARSER (see ./backend.ts), defaulting to
 * 'native' (@liendev/parser-native plus the compat deserializer in
 * ./native/ -- see docs/architecture/native-parser.md for the wire format
 * and compat contract). 'legacy' (node-tree-sitter) remains a transitional,
 * explicit opt-out. Both paths return the same {tree, error} shape.
 *
 * On the default (unset) path, a native binding that fails to *load*
 * transparently falls back to legacy for the rest of the process -- see
 * shouldFallBackToLegacy above. An explicit LIEN_PARSER=native does not
 * fall back.
 *
 * **Known Limitation (legacy only):** Tree-sitter may throw "Invalid argument" errors on very
 * large files (1000+ lines). This is a limitation of Tree-sitter's internal buffer handling. When
 * this occurs, callers should fall back to line-based chunking (handled automatically by
 * chunker.ts). native-parser.md section 5 notes this is a node-tree-sitter-specific quirk that
 * the native backend is not expected to reproduce.
 *
 * @param content - Source code to parse
 * @param language - Programming language
 * @returns Parse result with tree or error
 */
export function parseAST(content: string, language: SupportedLanguage): ASTParseResult {
  const backend = resolveParserBackend();
  if (backend === 'legacy') {
    return parseLegacy(content, language);
  }
  if (isBackendUnset() && shouldFallBackToLegacy()) {
    return parseLegacy(content, language);
  }
  return parseNative(content, language);
}

/**
 * Clear parser cache (useful for testing). Resets the legacy backend's
 * parser-instance cache and the default-path native-load-fallback decision
 * (see shouldFallBackToLegacy) -- the native binding handle itself
 * (nativeBinding) is intentionally left cached, since a successful load is
 * always safe to reuse.
 */
export function clearParserCache(): void {
  parserCache.clear();
  fellBackToLegacy = null;
}

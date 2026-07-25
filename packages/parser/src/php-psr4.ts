import fs from 'fs';
import path from 'path';

/**
 * Resolves PHP Composer PSR-4 autoload mappings (`composer.json`'s
 * `autoload.psr-4` / `autoload-dev.psr-4`) to a `Map<namespacePrefix, dir>`,
 * and resolves a raw PHP import specifier against that map.
 *
 * This closes the PHP test-association blind spot (#867): the PHP import
 * extractor emits fully namespace-qualified specifiers (e.g.
 * `GuzzleHttp\Cookie\SetCookie`), but `composer.json` is the only place that
 * declares the real mapping from a namespace prefix to a source directory
 * (`"GuzzleHttp\\": "src/"`) — the namespace root essentially never equals a
 * literal directory name, so `matchesPHPNamespace`'s directory-alignment
 * guess in `path-matching.ts` fails for the standard, non-Laravel PSR-4
 * layout. Mirrors `workspace-packages.ts`'s pattern exactly: parse the
 * manifest once per workspace root, cache the result, and treat "no manifest"
 * / "no match" as a no-op so every non-PHP or non-Composer project sees zero
 * behavior change.
 *
 * v1 scope (deliberately KISS/YAGNI, per #867's plan): only `autoload.psr-4`
 * and `autoload-dev.psr-4` are read. `classmap`/`files` autoloading, and
 * PSR-0, are out of scope — add if/when a real repo needs them.
 */

/** A minimal shape for the fields of composer.json this module reads. */
interface ComposerJsonShape {
  autoload?: { 'psr-4'?: unknown };
  'autoload-dev'?: { 'psr-4'?: unknown };
}

/** Per-workspace-root cache so repeated calls during a single index run are O(1) map lookups. */
const psr4MapCache = new Map<string, Map<string, string>>();

/** Clears the cached PSR-4 maps. Exported for test isolation. */
export function clearPsr4Cache(): void {
  psr4MapCache.clear();
}

function readComposerJson(filePath: string): ComposerJsonShape | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as ComposerJsonShape) : null;
  } catch {
    return null;
  }
}

/** Ensure a PSR-4 namespace prefix ends in exactly one trailing `\`. */
function normalizeNamespacePrefix(prefix: string): string {
  return prefix.endsWith('\\') ? prefix : `${prefix}\\`;
}

/** Ensure a PSR-4 source directory has no leading `./` and exactly one trailing `/`. */
function normalizeSourceDir(dir: string): string {
  const cleaned = dir.replace(/^\.\//, '');
  return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
}

/**
 * Merge one `autoload`/`autoload-dev` PSR-4 section into `map`. Composer
 * allows a prefix to map to either a single directory string or an array of
 * fallback directories — the first entry is the common case and the only one
 * handled here (a fallback dir is, by definition, a secondary location).
 */
function collectPsr4Entries(section: unknown, map: Map<string, string>): void {
  if (!section || typeof section !== 'object') return;

  for (const [prefix, value] of Object.entries(section as Record<string, unknown>)) {
    const dir = Array.isArray(value)
      ? value.find((v): v is string => typeof v === 'string')
      : value;
    if (typeof dir !== 'string' || dir.length === 0) continue;
    map.set(normalizeNamespacePrefix(prefix), normalizeSourceDir(dir));
  }
}

/**
 * Build (or retrieve from cache) the PSR-4 namespace-prefix -> source-dir map
 * for a workspace root.
 *
 * Returns an empty map when there is no `composer.json`, or it declares no
 * `autoload.psr-4`/`autoload-dev.psr-4` map — callers can pass the result
 * straight through with zero behavior change.
 *
 * @param workspaceRoot - Absolute path to the project root.
 */
export function resolvePsr4Map(workspaceRoot: string): Map<string, string> {
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');

  const cached = psr4MapCache.get(normalizedRoot);
  if (cached) return cached;

  const map = new Map<string, string>();
  const composerJson = readComposerJson(path.join(normalizedRoot, 'composer.json'));
  if (composerJson) {
    collectPsr4Entries(composerJson.autoload?.['psr-4'], map);
    collectPsr4Entries(composerJson['autoload-dev']?.['psr-4'], map);
  }

  psr4MapCache.set(normalizedRoot, map);
  return map;
}

/**
 * Resolve a raw PHP import specifier (e.g. `GuzzleHttp\Cookie\SetCookie`) to
 * a workspace-relative path (e.g. `src/Cookie/SetCookie`), using a PSR-4 map
 * built by `resolvePsr4Map`.
 *
 * Runs on the RAW backslash-separated specifier as emitted by
 * `PHPImportExtractor` — this resolution step happens in
 * `resolveImportSpecifier` (`ast/symbols.ts`) *before* `path-matching.ts`'s
 * `normalizePath` converts `\` to `/`, so the prefix lookup below is
 * deliberately backslash-aware rather than operating on an already-slashed
 * form.
 *
 * Matches the LONGEST registered namespace prefix (a project can declare
 * several via `autoload` + `autoload-dev`, and a more specific prefix like
 * `Foo\Bar\` must win over a broader `Foo\` if both are registered), replaces
 * it with the mapped directory, and converts the remaining namespace
 * separators to `/`.
 *
 * No-op (returns `specifier` unchanged) when the map is empty or no prefix
 * matches — non-PSR-4 specifiers and non-Composer projects see zero behavior
 * change.
 *
 * @param specifier - The raw (pre-`normalizePath`) PHP import specifier.
 * @param psr4Map - Map of namespace prefix (trailing `\`) -> source dir (trailing `/`).
 */
export function resolvePsr4Import(specifier: string, psr4Map: ReadonlyMap<string, string>): string {
  if (psr4Map.size === 0) return specifier;

  let bestPrefix: string | undefined;
  for (const prefix of psr4Map.keys()) {
    if (specifier.startsWith(prefix) && (!bestPrefix || prefix.length > bestPrefix.length)) {
      bestPrefix = prefix;
    }
  }
  if (!bestPrefix) return specifier;

  const dir = psr4Map.get(bestPrefix) as string;
  const rest = specifier.slice(bestPrefix.length).replace(/\\/g, '/');
  return `${dir}${rest}`;
}

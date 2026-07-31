import fs from 'fs';
import path from 'path';

/**
 * Resolves PHP Composer PSR-4 autoload mappings (`composer.json`'s
 * `autoload.psr-4` / `autoload-dev.psr-4`) to a `Map<namespacePrefix, dir[]>`,
 * and resolves a raw PHP import specifier against that map.
 *
 * This closes the PHP test-association blind spot (#867): the PHP import
 * extractor emits fully namespace-qualified specifiers (e.g.
 * `GuzzleHttp\Cookie\SetCookie`), but `composer.json` is the only place that
 * declares the real mapping from a namespace prefix to a source directory
 * (`"GuzzleHttp\\": "src/"`) — the namespace root essentially never equals a
 * literal directory name, so `matchesPHPNamespace`'s directory-alignment
 * guess in `path-matching.ts` fails for the standard, non-Laravel PSR-4
 * layout. Mirrors `workspace-packages.ts`'s pattern: parse the manifest once
 * per workspace root, cache the result, and treat "no manifest" / "no match"
 * as a no-op so every non-PHP or non-Composer project sees zero behavior
 * change.
 *
 * v1 scope (deliberately KISS/YAGNI, per #867's plan): only `autoload.psr-4`
 * and `autoload-dev.psr-4` are read. `classmap`/`files` autoloading, and
 * PSR-0, are out of scope — add if/when a real repo needs them.
 *
 * A namespace prefix can map to MORE THAN ONE directory, and both #1002 and
 * Composer's own docs confirm this isn't an edge case:
 * - The same prefix commonly appears in BOTH `autoload` and `autoload-dev`
 *   (Monolog's own `composer.json` declares `"Monolog\\": "src/Monolog"` in
 *   `autoload` AND `"Monolog\\": "tests/Monolog"` in `autoload-dev` — the
 *   standard PHP library convention of a library's tests sharing its own
 *   namespace). Both directories are simultaneously correct: `Monolog\Logger`
 *   really does live under `src/Monolog`, and `Monolog\LoggerTest` really
 *   does live under `tests/Monolog`.
 * - Composer also lets a single section map one prefix to an ARRAY of
 *   fallback directories, searched in order.
 * A flat `Map<prefix, string>` can hold only one answer, so the second write
 * silently discarded the first (#1002: `autoload-dev` is processed after
 * `autoload`, so it always won, and every `use Monolog\Logger;` in
 * `src/Monolog` resolved to the nonexistent `tests/Monolog/Logger`). The map
 * therefore stores `string[]` per prefix — every directory from every
 * section, in declaration order (`autoload` entries first, `autoload-dev`
 * appended after) — and `resolvePsr4Import` tries each candidate in turn,
 * preferring one that exists on disk. See its own doc comment for the
 * candidate-selection order.
 */

/** A minimal shape for the fields of composer.json this module reads. */
interface ComposerJsonShape {
  autoload?: { 'psr-4'?: unknown };
  'autoload-dev'?: { 'psr-4'?: unknown };
}

/** Per-workspace-root cache so repeated calls during a single index run are O(1) map lookups. */
const psr4MapCache = new Map<string, Map<string, string[]>>();

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

/**
 * Ensure a PSR-4 source directory has no leading `./` and exactly one
 * trailing `/` -- EXCEPT the empty string, which is Composer's own way of
 * mapping a namespace prefix directly onto the project root (no `src/`
 * subdirectory at all). That must stay `''`, not `'/'`: `resolvePsr4Import`
 * concatenates this directly onto the specifier's remaining path, and a
 * literal `/` prefix would produce an absolute-looking `/Command/Command`
 * instead of the correct workspace-relative `Command/Command`.
 */
function normalizeSourceDir(dir: string): string {
  const cleaned = dir.replace(/^\.\//, '');
  if (cleaned.length === 0) return '';
  return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
}

/**
 * Merge one `autoload`/`autoload-dev` PSR-4 section into `map`, APPENDING
 * each prefix's directories rather than overwriting (#1002). Composer allows
 * a prefix to map to either a single directory string or an array of
 * fallback directories, searched in order — both shapes are normalized to
 * (one or more) entries appended onto that prefix's candidate list, so a
 * prefix declared in both `autoload` and `autoload-dev` (the standard
 * library convention: a package's tests share its own namespace) keeps BOTH
 * directories, and a fallback-directory array keeps every entry, not just
 * the first.
 */
function collectPsr4Entries(section: unknown, map: Map<string, string[]>): void {
  if (!section || typeof section !== 'object') return;

  for (const [prefix, value] of Object.entries(section as Record<string, unknown>)) {
    const rawDirs = Array.isArray(value) ? value : [value];
    // An empty string is a VALID Composer PSR-4 mapping -- "map this
    // namespace prefix directly onto the project root", used by libraries
    // with no `src/` subdirectory (e.g. symfony/console's own
    // `"Symfony\\Component\\Console\\": ""`, #925). Only a genuinely
    // non-string value (missing/malformed entry) should be skipped.
    const dirs = rawDirs.filter((v): v is string => typeof v === 'string').map(normalizeSourceDir);
    if (dirs.length === 0) continue;

    const key = normalizeNamespacePrefix(prefix);
    const existing = map.get(key);
    if (existing) {
      existing.push(...dirs);
    } else {
      map.set(key, dirs);
    }
  }
}

/**
 * Build (or retrieve from cache) the PSR-4 namespace-prefix -> source-dir[]
 * map for a workspace root.
 *
 * Returns an empty map when there is no `composer.json`, or it declares no
 * `autoload.psr-4`/`autoload-dev.psr-4` map — callers can pass the result
 * straight through with zero behavior change.
 *
 * `autoload` is collected before `autoload-dev`, so when a prefix is declared
 * in both, its candidate array always has the `autoload` (production)
 * directory first — see `resolvePsr4Import`'s tie-break, which relies on
 * this ordering.
 *
 * @param workspaceRoot - Absolute path to the project root.
 */
export function resolvePsr4Map(workspaceRoot: string): Map<string, string[]> {
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');

  const cached = psr4MapCache.get(normalizedRoot);
  if (cached) return cached;

  const map = new Map<string, string[]>();
  const composerJson = readComposerJson(path.join(normalizedRoot, 'composer.json'));
  if (composerJson) {
    collectPsr4Entries(composerJson.autoload?.['psr-4'], map);
    collectPsr4Entries(composerJson['autoload-dev']?.['psr-4'], map);
  }

  psr4MapCache.set(normalizedRoot, map);
  return map;
}

/** True when `<workspaceRoot>/<candidate>.php` exists on disk. */
function existsAsPhpFile(workspaceRoot: string, candidate: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, `${candidate}.php`));
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
 * `Foo\Bar\` must win over a broader `Foo\` if both are registered), then
 * builds one candidate resolved path per directory registered for that
 * prefix (#1002 — a prefix can have more than one, see `resolvePsr4Map`'s doc
 * comment) and picks among them:
 * 1. If `workspaceRoot` is given, the first candidate that exists on disk as
 *    a real `.php` file wins. PSR-4's own contract (the file's basename must
 *    equal the class name) makes this a precise existence check, not a
 *    heuristic — and because `resolvePsr4Map` puts `autoload`'s directory
 *    before `autoload-dev`'s, iterating in order already prefers the
 *    production root on a tie (both candidates happen to exist).
 * 2. Otherwise (no `workspaceRoot`, or no candidate exists on disk — e.g. the
 *    specifier is genuinely unresolvable), fall back to the first-registered
 *    candidate: `autoload`'s directory when the prefix is declared there,
 *    same as before #1002 for the single-candidate case.
 *
 * This deliberately keeps a single best-guess `string` return (not
 * `string[]`) rather than pushing candidate selection onto callers: its only
 * caller, `resolveImportSpecifier` (`ast/symbols.ts`), folds the result into
 * both a flat `imports: string[]` array AND a `Record<importPath,
 * symbols[]>` map keyed by this return value — plumbing multiple candidates
 * through both shapes would ripple well past this module for a case the
 * existence check above already resolves correctly in the overwhelming
 * common case (a real file exists under exactly one of the candidate roots).
 *
 * No-op (returns `specifier` unchanged) when the map is empty or no prefix
 * matches — non-PSR-4 specifiers and non-Composer projects see zero behavior
 * change.
 *
 * @param specifier - The raw (pre-`normalizePath`) PHP import specifier.
 * @param psr4Map - Map of namespace prefix (trailing `\`) -> candidate source dirs (each trailing `/`).
 * @param workspaceRoot - Absolute project root, used to disambiguate multiple
 *   candidates by checking which resolves to a real file. Omit (e.g. in unit
 *   tests exercising the map directly) to always get the first-registered
 *   candidate.
 */
export function resolvePsr4Import(
  specifier: string,
  psr4Map: ReadonlyMap<string, string[]>,
  workspaceRoot?: string,
): string {
  if (psr4Map.size === 0) return specifier;

  let bestPrefix: string | undefined;
  for (const prefix of psr4Map.keys()) {
    if (specifier.startsWith(prefix) && (!bestPrefix || prefix.length > bestPrefix.length)) {
      bestPrefix = prefix;
    }
  }
  if (!bestPrefix) return specifier;

  const dirs = psr4Map.get(bestPrefix) as string[];
  const rest = specifier.slice(bestPrefix.length).replace(/\\/g, '/');
  const candidates = dirs.map(dir => `${dir}${rest}`);
  if (candidates.length === 1) return candidates[0];

  if (workspaceRoot) {
    const existing = candidates.find(candidate => existsAsPhpFile(workspaceRoot, candidate));
    if (existing) return existing;
  }
  return candidates[0];
}

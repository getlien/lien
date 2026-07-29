import fs from 'fs';
import path from 'path';

/**
 * Resolves a JS/TS relative import that points at a DIRECTORY (rather than a
 * file) to that directory's real module entry point, using Node/TypeScript's
 * own `index.<ext>` convention. A sibling to `workspace-packages.ts`'s
 * entry-file detection, scoped to a single directory rather than a whole npm
 * workspace package.
 *
 * Closes #953: `resolveRelativeImport` (`./utils/path-matching.ts`) correctly
 * joins a specifier like `../..` against its importer's directory (producing
 * e.g. `src`), but a bare directory name names no file of its own. Left
 * unresolved, it falls through to `matchesFile`'s fuzzy-matching strategies —
 * Strategy 2's Go-shaped "package directory" leniency, or Strategy 5's Python
 * bare-module matching (`matchesParentPythonPackage`) — each tuned for a
 * REAL multi-file-package semantic in a *different* language. For a
 * TypeScript relative import neither applies, so the bare directory
 * specifier fabricates a dependent edge to every file anywhere under that
 * directory instead of the one real edge: the directory's own entry point.
 * Resolving `src` -> `src/index` here means the specifier now names one
 * concrete file, so it participates in ordinary EXACT-match resolution — no
 * fuzzy-strategy involvement needed for this shape at all. See
 * `dependency-analyzer.ts`'s `addFuzzyMatchChunks` for the match-time half of
 * this fix (a residual guard for the directory-has-no-entry-file case this
 * function can't do anything about).
 *
 * Silence beats invention when the directory has no recognized entry file:
 * this returns `specifier` UNCHANGED rather than guessing, so downstream
 * matching still has to prove a real edge exists.
 */

const INDEX_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Per-absolute-directory cache: the `index.<ext>` filename it resolved to, or `null`. */
const directoryEntryCache = new Map<string, string | null>();

/** Clears the cached directory-entry lookups. Exported for test isolation. */
export function clearJsDirectoryIndexCache(): void {
  directoryEntryCache.clear();
}

function isDirectory(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/** Find (or retrieve from cache) the `index.<ext>` file inside `absDir`, if any. */
function findIndexFile(absDir: string): string | null {
  const cached = directoryEntryCache.get(absDir);
  if (cached !== undefined) return cached;

  let found: string | null = null;
  for (const ext of INDEX_EXTENSIONS) {
    if (fs.existsSync(path.join(absDir, `index${ext}`))) {
      found = `index${ext}`;
      break;
    }
  }
  directoryEntryCache.set(absDir, found);
  return found;
}

/**
 * Resolve `specifier` (already relative-resolved to a workspace-relative-ish
 * path by `resolveRelativeImport`) to `<specifier>/index` when it names a
 * real on-disk directory with a recognized `index.<ext>` entry file, using
 * `workspaceRoot` to build the absolute path for the filesystem check.
 *
 * No-op (`specifier` unchanged) when:
 * - `workspaceRoot` is undefined.
 * - `<workspaceRoot>/<specifier>` isn't a directory at all — the common
 *   case: an ordinary file-shaped relative import, already correctly matched
 *   without this step.
 * - It IS a directory but has no recognized `index.<ext>` file (a directory
 *   of loose files with no barrel) — left unresolved rather than guessed;
 *   `dependency-analyzer.ts`'s per-chunk Python-strategy guard is the
 *   residual defense for this case.
 *
 * @param specifier - The already relative-resolved specifier.
 * @param workspaceRoot - Absolute path to the project root (for the existence check).
 */
export function resolveJsDirectoryIndex(
  specifier: string,
  workspaceRoot: string | undefined,
): string {
  if (!workspaceRoot) return specifier;

  const absCandidate = path.join(workspaceRoot, specifier);
  if (!isDirectory(absCandidate)) return specifier;

  const entryFile = findIndexFile(absCandidate);
  if (!entryFile) return specifier;

  const entryBase = entryFile.replace(/\.[^.]+$/, '');
  return `${specifier}/${entryBase}`;
}

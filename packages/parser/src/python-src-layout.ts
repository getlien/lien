import fs from 'fs';
import path from 'path';

/**
 * Detects whether a Python project uses the "src layout" convention (source
 * lives under `src/<package>/` rather than directly at the repo root — the
 * layout Python packaging guides recommend, and the one Flask itself uses)
 * and, if so, resolves a bare or dotted absolute Python import specifier
 * against that root.
 *
 * This closes the second half of the bare-package-import blind spot (#901):
 * once `matchesPythonModule` (`./utils/path-matching.ts`) accepts a bare,
 * dot-free specifier (`import flask`), it still can't match
 * `src/flask/__init__.py` on its own — Python's own module-resolution
 * semantics treat the bare name as root-relative (`flask/__init__.py`), but
 * a src-layout project's real root is one directory deeper.
 *
 * Unlike PHP's PSR-4 (`./php-psr4.ts`) and Go's module prefix
 * (`./go-module.ts`), src layout has no reliably-declared manifest field to
 * read: `pyproject.toml`'s most minimal build backend (`flit_core`, the one
 * Flask itself uses) only declares the *package name*
 * (`[tool.flit.module] name = "flask"`) — flit finds the package by probing
 * `<name>/` and `src/<name>/` on disk, not from a declared directory field.
 * setuptools' `[tool.setuptools.packages.find] where = ["src"]` IS an
 * explicit declaration, but is commonly omitted too (modern setuptools
 * auto-detects a top-level `src/`). Detection here is therefore
 * filesystem-based rather than manifest-based: a real, on-disk `src/`
 * directory containing at least one Python package (a subdirectory with its
 * own `__init__.py`) is itself the deterministic signal — no parsing of, or
 * guessing about, any particular manifest field.
 *
 * v1 scope (KISS/YAGNI, mirroring the PSR-4/Go-module precedent): only the
 * conventional `src/` directory name is recognized. A custom
 * `packages.find(where=[...])` value is out of scope — add if/when a real
 * repo needs it.
 *
 * One thing this is NOT scoped to skip, though: a repo can contain more than
 * one Python project (Flask's own repo does — `examples/celery/` and
 * `examples/tutorial/` each have their own nested `src/<pkg>/` or flat-layout
 * package, unrelated to the top-level `src/flask/`). `detectPythonSrcLayoutRoot`
 * only answers "does *a* src/ layout exist at the workspace root" as a cheap
 * pre-filter; `resolvePythonSrcLayoutImport` verifies the SPECIFIC candidate
 * path it's about to produce actually exists on disk before rewriting a
 * specifier, precisely so that e.g. `examples/celery/make_celery.py`'s
 * `import task_app` (its own nested package, at
 * `examples/celery/src/task_app/`) does NOT get misresolved against the
 * top-level `src/` root as `src/task_app` (which doesn't exist there) —
 * confirmed against Flask's real repo during #901's fix.
 */

/** Per-workspace-root cache so repeated calls during a single index run are O(1). */
const srcLayoutRootCache = new Map<string, string | undefined>();

/** Clears the cached src-layout roots. Exported for test isolation. */
export function clearPythonSrcLayoutCache(): void {
  srcLayoutRootCache.clear();
}

/** True when `srcDir` contains at least one real Python package (a subdirectory with `__init__.py`). */
function hasPythonPackageChild(srcDir: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(
    entry => entry.isDirectory() && fs.existsSync(path.join(srcDir, entry.name, '__init__.py')),
  );
}

/**
 * Detect (or retrieve from cache) whether `workspaceRoot` is a Python
 * src-layout project.
 *
 * Returns `'src'` (the detected root directory, relative to `workspaceRoot`)
 * when a `src/` directory exists there and contains at least one real
 * Python package; `undefined` otherwise — callers can treat that as "no
 * resolution" with zero behavior change, exactly like `resolveGoModulePrefix`.
 *
 * @param workspaceRoot - Absolute path to the project root.
 */
export function detectPythonSrcLayoutRoot(workspaceRoot: string): string | undefined {
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');

  if (srcLayoutRootCache.has(normalizedRoot)) {
    return srcLayoutRootCache.get(normalizedRoot);
  }

  const srcDir = path.join(normalizedRoot, 'src');
  const isSrcLayout =
    fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory() && hasPythonPackageChild(srcDir);
  const root = isSrcLayout ? 'src' : undefined;

  srcLayoutRootCache.set(normalizedRoot, root);
  return root;
}

/** True when `<workspaceRoot>/<srcLayoutRoot>/<asPath>` is a real package (`__init__.py`) or module (`.py` file). */
function existsUnderSrcRoot(workspaceRoot: string, srcLayoutRoot: string, asPath: string): boolean {
  const candidateDir = path.join(workspaceRoot, srcLayoutRoot, asPath);
  return (
    fs.existsSync(`${candidateDir}.py`) || fs.existsSync(path.join(candidateDir, '__init__.py'))
  );
}

/**
 * Resolve a raw, absolute Python import specifier (e.g. `flask`,
 * `flask.globals`) to a repo-relative path (e.g. `src/flask`,
 * `src/flask/globals`), by prepending the project's detected src-layout
 * root — but only when that exact candidate path is confirmed to exist on
 * disk (see this module's doc comment for why: a repo can hold more than one
 * Python project, and an unrelated nested package must not be misresolved
 * against an outer, unrelated `src/` root just because both happen to be
 * named `src/`).
 *
 * No-op (returns `specifier` unchanged) when `srcLayoutRoot` is `undefined`,
 * `specifier` is already a resolved path rather than a raw absolute
 * specifier (contains `/`, or starts with `.`), or the candidate path
 * doesn't exist. A relative import (`from .foo import X`) is resolved
 * against the *importing file's own* directory in
 * `resolveImportSpecifier`'s earlier relative-import step (`ast/symbols.ts`),
 * which already lands under `src/` because that's where the importing file
 * itself lives — running this step on it too would double-prefix an
 * already-correct path. Only bare/dotted absolute specifiers (`import
 * flask`, `from flask.globals import g`) reach this step unresolved.
 *
 * @param specifier - The raw (or already relative-resolved) Python import specifier.
 * @param srcLayoutRoot - The project's detected src-layout root, or `undefined`.
 * @param workspaceRoot - Absolute path to the project root (for the existence check).
 */
export function resolvePythonSrcLayoutImport(
  specifier: string,
  srcLayoutRoot: string | undefined,
  workspaceRoot: string | undefined,
): string {
  if (!srcLayoutRoot || !workspaceRoot || specifier.includes('/') || specifier.startsWith('.')) {
    return specifier;
  }
  const asPath = specifier.replace(/\./g, '/');
  if (!existsUnderSrcRoot(workspaceRoot, srcLayoutRoot, asPath)) return specifier;
  return `${srcLayoutRoot}/${asPath}`;
}

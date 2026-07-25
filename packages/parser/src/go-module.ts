import fs from 'fs';
import path from 'path';

/**
 * Resolves a Go module's declared import-path prefix from `go.mod`'s single
 * `module` directive, and strips that prefix from a raw Go import path.
 *
 * This closes the Go test-association blind spot (#867): Go imports are
 * always full module paths (e.g. `github.com/gin-gonic/gin/binding`), never
 * relative, and the module's own root segment (`github.com/gin-gonic/gin`)
 * never corresponds to a literal directory in a real checkout — the repo is
 * cloned to whatever local directory name the user chose, never literally
 * `github.com/gin-gonic/gin`. `go.mod`'s `module` line is the one place the
 * project declares its own import-path prefix, so once it's known, stripping
 * it is exact string-prefix removal — no guessing needed. Mirrors
 * `workspace-packages.ts`'s pattern: parse once per workspace root, cache the
 * result, no-op when the manifest is absent.
 */

/** Per-workspace-root cache so repeated calls during a single index run are O(1). */
const goModulePrefixCache = new Map<string, string | undefined>();

/** Clears the cached module prefixes. Exported for test isolation. */
export function clearGoModuleCache(): void {
  goModulePrefixCache.clear();
}

/** Parse the `module <path>` directive from a go.mod file's contents. */
function parseModuleLine(content: string): string | undefined {
  const match = content.match(/^\s*module\s+(\S+)/m);
  return match?.[1];
}

function readModuleLine(filePath: string): string | undefined {
  try {
    return parseModuleLine(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Build (or retrieve from cache) the Go module import-path prefix for a
 * workspace root.
 *
 * Returns `undefined` when there is no `go.mod`, or it has no parseable
 * `module` line — callers can treat that as "no resolution" with zero
 * behavior change.
 *
 * @param workspaceRoot - Absolute path to the project root.
 */
export function resolveGoModulePrefix(workspaceRoot: string): string | undefined {
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');

  if (goModulePrefixCache.has(normalizedRoot)) {
    return goModulePrefixCache.get(normalizedRoot);
  }

  const modulePrefix = readModuleLine(path.join(normalizedRoot, 'go.mod'));
  goModulePrefixCache.set(normalizedRoot, modulePrefix);
  return modulePrefix;
}

/**
 * Resolve a raw Go import path (e.g. `github.com/gin-gonic/gin/binding`) to a
 * repo-relative path (e.g. `binding`), by stripping the project's own module
 * prefix as declared in `go.mod`.
 *
 * No-op (returns `specifier` unchanged) when `modulePrefix` is undefined, or
 * the specifier doesn't start with `<modulePrefix>/` — imports of other
 * modules (real external dependencies) and non-Go-module projects see zero
 * behavior change. Same-package imports (a bare import equal to the module
 * prefix itself, with no further path segment) are left unchanged too: Go's
 * own same-package test convention needs no import statement at all, so this
 * case doesn't arise for the cross-package test-association gap #867 targets.
 *
 * @param specifier - The raw Go import path.
 * @param modulePrefix - The project's `go.mod` `module` value, or `undefined`.
 */
export function resolveGoModuleImport(specifier: string, modulePrefix: string | undefined): string {
  if (!modulePrefix) return specifier;
  const withSlash = `${modulePrefix}/`;
  return specifier.startsWith(withSlash) ? specifier.slice(withSlash.length) : specifier;
}

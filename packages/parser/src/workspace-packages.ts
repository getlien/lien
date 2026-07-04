import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';

/**
 * Resolves npm-style `workspaces` globs (root `package.json`) to a map of
 * workspace package name -> workspace-relative source entry file.
 *
 * This closes the monorepo cross-package blind spot in dependency analysis:
 * imports like `import { X } from '@scope/pkg'` are stored RAW by the import
 * extractors (see `resolveRelativeImport` in `./utils/path-matching.ts`,
 * which only rewrites `./`/`../` specifiers). Without this map, a bare
 * package specifier never matches any indexed file, so `get_dependents`
 * can't see across package boundaries.
 *
 * v1 scope (deliberately KISS/YAGNI):
 * - Only the npm `workspaces: string[]` form is read (also accepts the
 *   `{ workspaces: { packages: string[] } }` shape some tooling emits).
 *   Yarn/pnpm-specific workspace config files (`pnpm-workspace.yaml`) are
 *   out of scope — add if/when a real repo needs it.
 * - Only the BARE package specifier is resolved (`@scope/pkg`), mapped to
 *   the package's SOURCE entry (e.g. `packages/parser/src/index.ts`), not
 *   its built `main` (`dist/index.js` isn't indexed). Deep/subpath imports
 *   (`@scope/pkg/subpath`) pass through unresolved — no cross-package
 *   import in this codebase uses that form, and honoring package.json
 *   `exports` maps for arbitrary subpaths is real complexity for no
 *   observed benefit.
 * - Entry file detection tries `main`/`module` (rewriting a leading
 *   `dist|build|lib|out/` segment to `src/` and swapping the compiled
 *   extension for a source one), then falls back to the `src/index.<ext>`
 *   convention. No `package.json#exports` map resolution.
 */

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** A minimal shape for the fields of package.json this module reads. */
interface PackageJsonShape {
  name?: unknown;
  main?: unknown;
  module?: unknown;
  workspaces?: unknown;
}

/** Per-workspace-root cache so repeated calls during a single index run are O(1) map lookups. */
const workspaceMapCache = new Map<string, Map<string, string>>();

/** Clears the cached workspace package maps. Exported for test isolation. */
export function clearWorkspacePackageCache(): void {
  workspaceMapCache.clear();
}

function readPackageJson(filePath: string): PackageJsonShape | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PackageJsonShape) : null;
  } catch {
    return null;
  }
}

/** Extract the `workspaces` globs, supporting both the array and `{ packages }` shapes. */
function getWorkspaceGlobs(rootPackageJson: PackageJsonShape): string[] {
  const { workspaces } = rootPackageJson;
  if (Array.isArray(workspaces)) {
    return workspaces.filter((g): g is string => typeof g === 'string');
  }
  if (workspaces && typeof workspaces === 'object' && 'packages' in workspaces) {
    const packages = (workspaces as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      return packages.filter((g): g is string => typeof g === 'string');
    }
  }
  return [];
}

/**
 * Resolve workspace globs to member directories (workspace-relative, POSIX
 * separators). Negated patterns (`!packages/excluded`) filter out matches
 * from earlier patterns, mirroring npm's own workspace resolution.
 */
function resolveMemberDirs(workspaceRoot: string, globs: string[]): string[] {
  const includePatterns = globs.filter(g => !g.startsWith('!'));
  const excludePatterns = globs.filter(g => g.startsWith('!')).map(g => g.slice(1));

  const matched = new Set<string>();
  for (const pattern of includePatterns) {
    const results = globSync(pattern, { cwd: workspaceRoot, ignore: excludePatterns });
    for (const result of results) {
      const relDir = result.replace(/\\/g, '/');
      const absDir = path.join(workspaceRoot, relDir);
      if (isDirectory(absDir)) {
        matched.add(relDir);
      }
    }
  }
  return Array.from(matched);
}

function isDirectory(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/** Strip a leading build-output directory segment and swap it for `src/`. */
function toSourceDir(compiledPath: string): string {
  return compiledPath.replace(/^(?:\.\/)?(dist|build|lib|out)\//, 'src/');
}

/**
 * Candidate source entry paths for a package, in priority order: derived
 * from `main`/`module` first, falling back to the `src/index.<ext>`
 * convention. The first candidate that exists on disk wins.
 */
function deriveEntryCandidates(pkg: PackageJsonShape): string[] {
  const candidates: string[] = [];

  const addFromField = (value: unknown): void => {
    if (typeof value !== 'string' || value.length === 0) return;
    const cleaned = value.replace(/^\.\//, '');
    const sourceDir = toSourceDir(cleaned);
    const base = sourceDir.replace(/\.[cm]?[jt]sx?$/, '');
    for (const ext of SOURCE_EXTENSIONS) candidates.push(`${base}${ext}`);
  };

  addFromField(pkg.main);
  addFromField(pkg.module);
  for (const ext of SOURCE_EXTENSIONS) candidates.push(`src/index${ext}`);

  return candidates;
}

function findEntryFile(pkgDirAbs: string, pkg: PackageJsonShape): string | null {
  for (const candidate of deriveEntryCandidates(pkg)) {
    if (fs.existsSync(path.join(pkgDirAbs, candidate))) {
      return candidate;
    }
  }
  return null;
}

/**
 * Build (or retrieve from cache) the workspace package name -> source entry
 * file map for a workspace root.
 *
 * Returns an empty map for non-monorepo projects (no root `package.json`, or
 * no `workspaces` field) — callers can pass the result straight through with
 * zero behavior change.
 *
 * @param workspaceRoot - Absolute path to the workspace/monorepo root.
 */
export function resolveWorkspacePackageEntries(workspaceRoot: string): Map<string, string> {
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');

  const cached = workspaceMapCache.get(normalizedRoot);
  if (cached) return cached;

  const map = new Map<string, string>();
  const rootPackageJson = readPackageJson(path.join(normalizedRoot, 'package.json'));
  const globs = rootPackageJson ? getWorkspaceGlobs(rootPackageJson) : [];

  if (globs.length > 0) {
    for (const memberDir of resolveMemberDirs(normalizedRoot, globs)) {
      const memberPkg = readPackageJson(path.join(normalizedRoot, memberDir, 'package.json'));
      if (!memberPkg || typeof memberPkg.name !== 'string') continue;

      const entry = findEntryFile(path.join(normalizedRoot, memberDir), memberPkg);
      if (!entry) continue;

      map.set(memberPkg.name, path.posix.join(memberDir, entry));
    }
  }

  workspaceMapCache.set(normalizedRoot, map);
  return map;
}

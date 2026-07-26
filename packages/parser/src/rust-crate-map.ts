import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';

/**
 * Resolves Rust Cargo workspace member crate names to their source
 * directories, building a `Map<crateName (underscore form), crateSrcDir>`
 * from the workspace root's `Cargo.toml` `[workspace] members` list plus each
 * matched member's own `[package] name` (and the root's own `[package]`, for
 * a single-crate project or a workspace root that's also a member crate).
 *
 * This closes the Rust test-association blind spot (#903 -- the third leg of
 * #867, alongside PHP's `composer.json` PSR-4 map and Go's `go.mod` module
 * path): Cargo always compiles a crate's `tests/` directory as a SEPARATE
 * crate, so an integration test references the crate under test by its
 * PUBLISHED name (`use tokio_util::codec::Framed;`), never `crate::` --
 * `convertRustModulePath` (`ast/languages/rust.ts`) has no way to tell that
 * apart from a genuinely external crates.io dependency, and drops it. Once a
 * workspace's member crate names are known, resolving `<crate>::<rest>` into
 * `<crateDir>/src/<rest>` is exact string substitution -- the same shape as
 * `workspace-packages.ts`'s existing pattern (parse once per workspace root,
 * cache the result, no-op when the manifest is absent).
 *
 * v1 scope (deliberately KISS/YAGNI, matching #867's PHP/Go precedent): only
 * `[workspace] members` (glob-expanded, mirroring `workspace-packages.ts`'s
 * `resolveMemberDirs`) and each matched member's own `[package] name` are
 * read. `[dependencies] path = "..."` entries, workspace `exclude`, and
 * virtual-manifest edge cases beyond a plain `[workspace]`/`[package]` split
 * are out of scope -- add if/when a real repo needs them. Only WORKSPACE-
 * member crates are ever mapped; a crate that merely appears in
 * `[dependencies]` (with no workspace-membership relationship) stays
 * external -- no guessing, per #868's precedent.
 */

/** Per-workspace-root cache so repeated calls during a single index run are O(1) map lookups. */
const rustCrateMapCache = new Map<string, Map<string, string>>();

/** Clears the cached crate maps. Exported for test isolation. */
export function clearRustCrateMapCache(): void {
  rustCrateMapCache.clear();
}

function readCargoToml(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Extract a top-level TOML table's body text -- everything between a
 * `[header]` line and the next line starting with `[` (or end of file).
 * Deliberately naive line-based scanning: sufficient for the narrow
 * `[package]`/`[workspace]` shapes this module reads, not a general TOML
 * parser.
 */
function extractTableBody(content: string, header: string): string | null {
  const lines = content.split('\n');
  const startIndex = lines.findIndex(line => line.trim() === header);
  if (startIndex === -1) return null;

  const bodyLines: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (/^\s*\[/.test(line)) break;
    bodyLines.push(line);
  }
  return bodyLines.join('\n');
}

/** Extract `[package] name = "..."` from a Cargo.toml's contents, if present. */
function extractPackageName(content: string): string | undefined {
  const body = extractTableBody(content, '[package]');
  if (!body) return undefined;
  const match = body.match(/^\s*name\s*=\s*"([^"]+)"/m);
  return match?.[1];
}

/**
 * Extract `[workspace] members = [...]` from a Cargo.toml's contents, as raw
 * (possibly glob) entries, e.g. `"tokio"`, `"crates/*"`. Handles the array
 * spanning multiple lines -- Cargo's own convention once a workspace has more
 * than a couple of members (see tokio-rs/tokio's own root manifest).
 *
 * The `members` key is matched anchored to the start of a line (allowing only
 * leading whitespace) rather than as a bare substring search. Cargo also
 * supports a distinct `default-members` key in the same `[workspace]` table,
 * and TOML formatters commonly place it first (alphabetically before
 * `members`) -- an unanchored `/members\s*=\s*\[/` would match the "members
 * = [" tail of "default-members = [" and silently extract THAT array
 * instead, dropping the real workspace members.
 */
function extractWorkspaceMemberGlobs(content: string): string[] {
  const body = extractTableBody(content, '[workspace]');
  if (!body) return [];

  const arrayMatch = body.match(/^[ \t]*members\s*=\s*\[([\s\S]*?)\]/m);
  if (!arrayMatch) return [];

  const quoted = arrayMatch[1].match(/"([^"]+)"/g) ?? [];
  return quoted.map(q => q.slice(1, -1));
}

function isDirectory(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/** Resolve workspace member globs to member directories (workspace-relative, POSIX separators). */
function resolveMemberDirs(workspaceRoot: string, globs: string[]): string[] {
  const matched = new Set<string>();
  for (const pattern of globs) {
    for (const result of globSync(pattern, { cwd: workspaceRoot })) {
      const relDir = result.replace(/\\/g, '/');
      if (isDirectory(path.join(workspaceRoot, relDir))) {
        matched.add(relDir);
      }
    }
  }
  return Array.from(matched);
}

/** Normalize a Cargo package name to the identifier form used in `use` paths (hyphens -> underscores). */
function toRustIdentifier(crateName: string): string {
  return crateName.replace(/-/g, '_');
}

/** Add a `crateName -> memberDir/src` entry to `map`, when `content` declares a `[package] name`. */
function addPackageEntry(
  map: Map<string, string>,
  memberDir: string,
  content: string | null,
): void {
  if (!content) return;
  const name = extractPackageName(content);
  if (!name) return;
  map.set(toRustIdentifier(name), path.posix.join(memberDir, 'src'));
}

/**
 * Build (or retrieve from cache) the crate-name -> crate-`src/`-dir map for a
 * Cargo workspace (or a single-crate project's own package).
 *
 * Returns an empty map when there is no root `Cargo.toml` -- callers can pass
 * the result straight through with zero behavior change.
 *
 * @param workspaceRoot - Absolute path to the project root.
 */
export function resolveRustCrateMap(workspaceRoot: string): Map<string, string> {
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');

  const cached = rustCrateMapCache.get(normalizedRoot);
  if (cached) return cached;

  const map = new Map<string, string>();
  const rootManifest = readCargoToml(path.join(normalizedRoot, 'Cargo.toml'));
  if (rootManifest) {
    // The workspace root is sometimes itself a member crate (a `[package]`
    // and a `[workspace]` both present in the same manifest).
    addPackageEntry(map, '.', rootManifest);

    const memberGlobs = extractWorkspaceMemberGlobs(rootManifest);
    for (const memberDir of resolveMemberDirs(normalizedRoot, memberGlobs)) {
      const memberManifest = readCargoToml(path.join(normalizedRoot, memberDir, 'Cargo.toml'));
      addPackageEntry(map, memberDir, memberManifest);
    }
  }

  rustCrateMapCache.set(normalizedRoot, map);
  return map;
}

/**
 * Resolve a raw Rust module path (e.g. `tokio_util::codec::Framed` --
 * already confirmed by `convertRustModulePath` NOT to start with
 * `crate::`/`self::`/`super::`) against a workspace's crate map, by matching
 * its root segment (the part before the first `::`, or the whole path if
 * there is none) against a known workspace crate name.
 *
 * No-op (returns `null`, i.e. "still looks external") when `crateMap` is
 * absent/empty or the root segment doesn't match any known crate -- a
 * genuinely external crates.io dependency (`serde`, `futures`, ...) is never
 * in the map, so it's dropped exactly as it was before this fix (#868's "no
 * guessing" precedent: only real workspace members ever resolve).
 *
 * @param modulePath - The raw (non-crate/self/super) `use` path.
 * @param crateMap - Map of crate name (underscore form) -> crate `src/` dir, from `resolveRustCrateMap`.
 */
export function resolveRustCrateImport(
  modulePath: string,
  crateMap: ReadonlyMap<string, string> | undefined,
): string | null {
  if (!crateMap || crateMap.size === 0) return null;

  const sepIndex = modulePath.indexOf('::');
  const root = sepIndex === -1 ? modulePath : modulePath.slice(0, sepIndex);
  const crateDir = crateMap.get(root);
  if (!crateDir) return null;

  const rest = sepIndex === -1 ? '' : modulePath.slice(sepIndex + 2).replace(/::/g, '/');
  return rest ? `${crateDir}/${rest}` : crateDir;
}

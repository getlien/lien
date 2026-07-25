import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Resolve symlinks so the same physical directory always yields the same
 * string, regardless of how the caller spelled the path (a symlinked path
 * segment, `--root <symlink>`, a hook-provided cwd, etc.). Falls back to
 * `path.resolve` — same normalization `extractRepoId` always had — when the
 * path doesn't exist yet or `realpath` fails for any other reason (e.g.
 * permissions); a non-canonical hash is still stable, just not
 * symlink-normalized.
 */
function canonicalize(projectRoot: string): string {
  try {
    return fs.realpathSync(projectRoot);
  } catch {
    return path.resolve(projectRoot);
  }
}

/**
 * Extract repository identifier from project root.
 * Uses project name + path hash for stable, unique identification.
 *
 * Canonicalizes symlinks first (see `canonicalize`) so `lien index` from a
 * project's physical directory and `lien serve --root <symlink-to-it>` (or
 * any other caller passing a differently-spelled path to the same physical
 * directory) resolve to the same repo ID instead of silently creating a
 * second, empty index (#858).
 */
export function extractRepoId(projectRoot: string): string {
  const canonicalRoot = canonicalize(projectRoot);
  const projectName = path.basename(canonicalRoot);
  const pathHash = crypto.createHash('md5').update(canonicalRoot).digest('hex').substring(0, 8);
  return `${projectName}-${pathHash}`;
}

/**
 * Resolve `p` to its canonical (symlink-free) form so a later `path.relative`
 * against another canonicalized path can't straddle a symlinked ancestor —
 * e.g. macOS's `/tmp` -> `/private/tmp` — and compute a relative path between
 * two different roots (`../../../../tmp/...` instead of the intended
 * `src/foo.ts`). `process.cwd()` already returns the OS-canonicalized form,
 * but a path arriving as a raw argument (an MCP tool's `filepath`, a hook's
 * `tool_input.file_path`) does not, so the mismatch only shows up once both
 * sides are compared.
 *
 * Never throws: `fs.realpathSync` throws on a path that doesn't exist (a
 * plausible, non-exceptional case here — these run inside hooks and CLI
 * commands that must never crash on a stale or mistyped path). Falls back to
 * realpath-ing the parent directory and re-attaching the basename (handles a
 * deleted file whose containing directory still exists), and finally to `p`
 * unchanged if even that fails.
 */
import fs from 'fs';
import path from 'path';

export function canonicalizePath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
    } catch {
      return p;
    }
  }
}

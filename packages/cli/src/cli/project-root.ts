import fs from 'fs';
import path from 'path';

/**
 * Walk upward from `start` looking for a `.git` marker (file or dir).
 * Falls back to the resolved start path if none is found.
 * Lets the gate/store stay stable when commands are run from a subdir.
 */
export function resolveProjectRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  const fsRoot = path.parse(dir).root;
  // Loop is inclusive of fsRoot — a repo rooted at / (or a drive root) is
  // rare but valid, and should still be detected before falling back.
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    if (dir === fsRoot) break;
    dir = path.dirname(dir);
  }
  return path.resolve(start);
}

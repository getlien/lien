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
  while (dir !== fsRoot) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.resolve(start);
}

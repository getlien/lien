import fs from 'fs';
import path from 'path';
import { type AbsolutePath, toAbsolutePath } from '../types/paths.js';

/**
 * Walk upward from `start` looking for a `.git` marker (file or dir).
 * Falls back to the resolved start path if none is found.
 *
 * Return type is `AbsolutePath` because `path.resolve` always produces an
 * absolute path. Downstream code can rely on this without runtime checks.
 */
export function resolveProjectRoot(start: string = process.cwd()): AbsolutePath {
  let dir = path.resolve(start);
  const fsRoot = path.parse(dir).root;
  // Loop is inclusive of fsRoot — a repo rooted at / (or a drive root) is
  // rare but valid, and should still be detected before falling back.
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return toAbsolutePath(dir);
    }
    if (dir === fsRoot) break;
    dir = path.dirname(dir);
  }
  return toAbsolutePath(path.resolve(start));
}

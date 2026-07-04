import fs from 'fs/promises';
import path from 'path';
import { getIndexDir } from '@liendev/parser';
import { INDEX_FORMAT_VERSION } from '../constants.js';
import { detectLinkedWorktree } from '../git/worktree.js';
import { STRUCTURAL_DB_FILENAME } from './sqlite/schema.js';

const MANIFEST_FILE = 'manifest.json';

/** How `createVectorDB` should back a given project root. */
export type IndexStrategy =
  | { mode: 'standalone' }
  | {
      mode: 'overlay';
      /** Main checkout working-tree path. */
      mainRoot: string;
      /** `~/.lien/indices/<main-repoId>` — read-only base. */
      baseIndexDir: string;
      /** `~/.lien/indices/<worktree-repoId>` — writable overlay. */
      overlayIndexDir: string;
    };

/** Injectable logger for the fallback hints. Silent by default so library-level
 *  `createVectorDB` calls (status, complexity, annotate, …) don't nag on every
 *  invocation; `serve` and `index` opt in, where the hint is actionable. */
export interface ResolveOptions {
  warn?: (message: string) => void;
}

// "warn once" per base index dir, process-wide. Keyed by baseIndexDir so two
// worktrees of different repos each get their own single warning.
const warnedKeys = new Set<string>();

function warnOnce(warn: (m: string) => void, key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  warn(message);
}

/** @internal reset the once-warned memo (tests only). */
export function _resetWarnMemo(): void {
  warnedKeys.clear();
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function realpathSafe(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return path.resolve(p);
  }
}

/** Read the base manifest's formatVersion, or null if unreadable/absent. */
async function readBaseFormatVersion(baseIndexDir: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(path.join(baseIndexDir, MANIFEST_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as { formatVersion?: number };
    return typeof parsed.formatVersion === 'number' ? parsed.formatVersion : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether a project root should use a standalone index or a shared-base
 * overlay. Never throws — every uncertain condition degrades to standalone.
 *
 * Overlay mode requires ALL of:
 *  - `LIEN_WORKTREE_STANDALONE` is not set to `1` (escape hatch),
 *  - the root is a linked worktree with a resolvable, distinct main checkout,
 *  - the main checkout has a `structural.db` AND a `manifest.json` (the base
 *    per-file content hashes the overlay diff relies on),
 *  - the base manifest's `formatVersion` matches the current schema.
 */
export async function resolveIndexStrategy(
  projectRoot: string,
  opts: ResolveOptions = {},
): Promise<IndexStrategy> {
  const warn = opts.warn ?? (() => {});

  if (process.env.LIEN_WORKTREE_STANDALONE === '1') {
    return { mode: 'standalone' };
  }

  const { isLinkedWorktree, mainRoot } = await detectLinkedWorktree(projectRoot);
  if (!isLinkedWorktree || !mainRoot) {
    return { mode: 'standalone' };
  }

  // Defensive: a main root that resolves to the current root offers no base.
  const [realMain, realRoot] = await Promise.all([
    realpathSafe(mainRoot),
    realpathSafe(projectRoot),
  ]);
  if (realMain === realRoot) {
    return { mode: 'standalone' };
  }

  const baseIndexDir = getIndexDir(mainRoot);
  const hasDb = await fileExists(path.join(baseIndexDir, STRUCTURAL_DB_FILENAME));
  const hasManifest = await fileExists(path.join(baseIndexDir, MANIFEST_FILE));
  if (!hasDb || !hasManifest) {
    warnOnce(
      warn,
      baseIndexDir,
      `[Lien] Worktree detected but the main checkout at ${mainRoot} has no complete index — ` +
        `using a standalone index. Run \`lien index\` in the main checkout to share its index across worktrees.`,
    );
    return { mode: 'standalone' };
  }

  const baseFormat = await readBaseFormatVersion(baseIndexDir);
  if (baseFormat !== null && baseFormat !== INDEX_FORMAT_VERSION) {
    warnOnce(
      warn,
      baseIndexDir,
      `[Lien] Main checkout index format v${baseFormat} is incompatible with current v${INDEX_FORMAT_VERSION} — ` +
        `using a standalone worktree index until the main checkout is reindexed.`,
    );
    return { mode: 'standalone' };
  }

  return {
    mode: 'overlay',
    mainRoot,
    baseIndexDir,
    overlayIndexDir: getIndexDir(projectRoot),
  };
}

import path from 'path';
import pLimit from 'p-limit';
import { computeContentHash } from '@liendev/parser';
import { DEFAULT_CONCURRENCY } from '../constants.js';
import type { OverlayBackend } from '../vectordb/overlay-backend.js';
import { scanFilesToIndex } from './index.js';
import { indexMultipleFiles, normalizeToRelativePath } from './incremental.js';

/** Per-classification counts from an overlay build. */
export interface OverlayBuildResult {
  /** Files present in the worktree but not in the base index. */
  added: number;
  /** Files present in both but with different content. */
  modified: number;
  /** Files present in the base index but gone from the worktree. */
  deleted: number;
  /** Files identical to the base — served from the base, not the overlay. */
  unchanged: number;
}

/**
 * (Re)build a worktree overlay by diffing the worktree's current content
 * against the base index's per-file content hashes (state-based, not
 * git-history-based).
 *
 * Only files that diverge from the base (added + modified) are chunked into the
 * overlay; unchanged files are served from the base. Deleted files (in base,
 * gone from the worktree) are masked. Modified files are masked implicitly by
 * `OverlayBackend.deleteByFile`, which the incremental write path calls before
 * inserting the new rows.
 *
 * Idempotent: clears the overlay's chunks + mask first, so it doubles as the
 * staleness-revalidation path when the base has been reindexed.
 */
export async function buildOverlay(
  overlay: OverlayBackend,
  options: { verbose?: boolean } = {},
): Promise<OverlayBuildResult> {
  const rootDir = overlay.worktreeRoot;
  const baseHashes = overlay.getBaseHashes();

  // Start from a clean slate so a rebuild after a base reindex can't leave stale
  // overlay rows or mask entries behind.
  await overlay.clear();

  const files = await scanFilesToIndex(rootDir);

  const currentPaths = new Set<string>();
  const diverged: string[] = []; // absolute paths to (re)index into the overlay
  let added = 0;
  let modified = 0;

  const limit = pLimit(DEFAULT_CONCURRENCY);
  await Promise.all(
    files.map(file =>
      limit(async () => {
        const rel = normalizeToRelativePath(file, rootDir);
        const abs = path.isAbsolute(file) ? file : path.join(rootDir, file);
        currentPaths.add(rel);

        const baseHash = baseHashes.get(rel);
        if (baseHash === undefined) {
          added++;
          diverged.push(abs);
          return;
        }
        const currentHash = await computeContentHash(abs);
        if (currentHash !== baseHash) {
          modified++;
          diverged.push(abs);
        }
      }),
    ),
  );

  // Deleted: in the base manifest but no longer in the worktree → mask only.
  let deleted = 0;
  for (const baseFile of baseHashes.keys()) {
    if (!currentPaths.has(baseFile)) {
      overlay.maskBasePath(baseFile);
      deleted++;
    }
  }

  // Chunk + persist the diverged files. indexMultipleFiles calls deleteByFile
  // (which masks modified files that exist in the base) then insertBatch.
  if (diverged.length > 0) {
    await indexMultipleFiles(diverged, overlay, { verbose: options.verbose, rootDir });
  }

  await overlay.recordBaseBuild();

  return {
    added,
    modified,
    deleted,
    unchanged: currentPaths.size - added - modified,
  };
}

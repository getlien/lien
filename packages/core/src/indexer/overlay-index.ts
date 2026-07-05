import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import pLimit from 'p-limit';
import { chunkFile, computeContentHash, extractRepoId } from '@liendev/parser';
import type { ChunkMetadata } from '@liendev/parser';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  INDEX_FORMAT_VERSION,
} from '../constants.js';
import type { OverlayBackend } from '../vectordb/overlay-backend.js';
import { ManifestManager, type FileEntry } from './manifest.js';
import { scanFilesToIndex } from './index.js';
import { normalizeToRelativePath } from './incremental.js';

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
  /**
   * Whether this build changed the overlay's content (and therefore bumped the
   * version stamp). `false` when the rebuild reproduced a byte-identical overlay
   * — the guard that stops multiple `lien serve` processes from mutually
   * re-triggering rebuilds forever (see the concurrency notes in
   * docs/architecture/worktree-aware-indexing.md).
   */
  changed: boolean;
}

/** One diverged (added or modified) worktree file. */
interface DivergedFile {
  rel: string; // relative, forward-slash path (storage + mask key)
  abs: string; // absolute path (filesystem reads)
  hash: string; // current content hash (drives the content signature)
}

/** Indexing-format inputs baked into the overlay signature. If any of these
 *  change (a Lien upgrade bumps `INDEX_FORMAT_VERSION`, or the chunking
 *  parameters move), the same worktree content chunks differently — so the
 *  signature must differ and force one real rebuild, or the no-op fast path
 *  would keep serving stale-format chunk rows forever. */
export interface OverlaySignatureFormat {
  formatVersion: number;
  chunkSize: number;
  chunkOverlap: number;
}

/**
 * Content signature of an overlay: a hash over the indexing-format salt plus
 * the sorted (diverged file → content hash) pairs plus the sorted mask set.
 * Two builds with the same signature would produce a byte-identical overlay,
 * so the second can skip the swap + version bump. Cheap: reuses hashes already
 * computed during the diff.
 *
 * Exported for tests; production callers go through `buildOverlay`, which
 * supplies the real format constants.
 */
export function computeOverlaySignature(
  diverged: Array<{ rel: string; hash: string }>,
  maskFiles: readonly string[],
  format: OverlaySignatureFormat,
): string {
  const salt = `format=${format.formatVersion};chunk=${format.chunkSize}/${format.chunkOverlap}`;
  const files = diverged.map(d => `${d.rel}\t${d.hash}`).sort();
  const masks = [...maskFiles].sort();
  const canonical = `${salt}\n${files.join('\n')}\n--mask--\n${masks.join('\n')}`;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/**
 * (Re)build a worktree overlay by diffing the worktree's current content
 * against the base index's per-file content hashes (state-based, not
 * git-history-based).
 *
 * Only files that diverge from the base (added + modified) are chunked into the
 * overlay; unchanged files are served from the base; deleted files (in base,
 * gone from the worktree) are masked. Modified files are both masked (base row
 * suppressed) and chunked (overlay row served).
 *
 * Concurrency-hardened (see docs/architecture/worktree-aware-indexing.md):
 *   - The overlay swap (clear + repopulate mask & chunks) is applied in ONE
 *     transaction via `OverlayBackend.applyRebuild`, so concurrent readers on
 *     other connections never observe a masked-but-unreplaced file.
 *   - A rebuild that reproduces the identical overlay does NOT bump the version
 *     stamp (`changed: false`), so peer serves don't see a phantom change and
 *     re-trigger their own rebuilds. All the async file I/O (scan, hash, chunk)
 *     happens here, OUTSIDE the write transaction, because better-sqlite3
 *     transactions must be synchronous.
 */
export async function buildOverlay(
  overlay: OverlayBackend,
  options: { verbose?: boolean } = {},
): Promise<OverlayBuildResult> {
  const rootDir = overlay.worktreeRoot;
  const baseHashes = overlay.getBaseHashes();

  // ── Diff the worktree against the base (hash every file once) ───────────
  const files = await scanFilesToIndex(rootDir);
  const currentPaths = new Set<string>();
  const diverged: DivergedFile[] = [];
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
        const currentHash = await computeContentHash(abs);
        if (baseHash === undefined) {
          added++;
          diverged.push({ rel, abs, hash: currentHash });
        } else if (currentHash !== baseHash) {
          modified++;
          diverged.push({ rel, abs, hash: currentHash });
        }
      }),
    ),
  );

  // Masked base paths: modified (in base AND diverged) + deleted (in base, gone
  // from the worktree). Added files are never in base, so never masked.
  const maskFiles: string[] = [];
  let deleted = 0;
  for (const baseFile of baseHashes.keys()) {
    if (!currentPaths.has(baseFile)) {
      maskFiles.push(baseFile);
      deleted++;
    }
  }
  for (const d of diverged) {
    if (baseHashes.has(d.rel)) maskFiles.push(d.rel);
  }

  const counts = {
    added,
    modified,
    deleted,
    unchanged: currentPaths.size - added - modified,
  };
  const signature = computeOverlaySignature(diverged, maskFiles, {
    formatVersion: INDEX_FORMAT_VERSION,
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
  });
  const baseIndexDir = overlay.baseIndexDir;
  const baseStamp = await overlay.getBaseStamp();

  // ── Fast path: overlay already matches → no swap, no bump ───────────────
  // Refresh only the base stamp so needsRebuild() settles, then bail. This is
  // the common case for a serve (re)starting on an unchanged worktree, and is
  // what keeps piled-up serves from churning the version stamp.
  if (overlay.overlaySignatureMatches(signature)) {
    overlay.refreshBaseStamp(baseIndexDir, baseStamp);
    return { ...counts, changed: false };
  }

  // ── Chunk the diverged files into in-memory batches (async I/O) ─────────
  const repoId = extractRepoId(rootDir);
  const chunkBatches: Array<{ metadatas: ChunkMetadata[]; contents: string[] }> = [];
  const manifestEntries: FileEntry[] = [];
  await Promise.all(
    diverged.map(d =>
      limit(async () => {
        const content = await fs.readFile(d.abs, 'utf-8');
        const chunks = chunkFile(d.rel, content, {
          chunkSize: DEFAULT_CHUNK_SIZE,
          chunkOverlap: DEFAULT_CHUNK_OVERLAP,
          useAST: true,
          astFallback: 'line-based',
          repoId,
        });
        const stats = await fs.stat(d.abs);
        if (chunks.length > 0) {
          chunkBatches.push({
            metadatas: chunks.map(c => c.metadata),
            contents: chunks.map(c => c.content),
          });
        }
        manifestEntries.push({
          filepath: d.rel,
          lastModified: stats.mtimeMs,
          chunkCount: chunks.length,
          contentHash: d.hash,
        });
        if (options.verbose) {
          console.error(`[Lien] overlay: staged ${d.rel} (${chunks.length} chunks)`);
        }
      }),
    ),
  );

  // ── Apply atomically; bump + persist manifest only on a real change ─────
  const { changed } = overlay.applyRebuild({
    chunkBatches,
    maskFiles,
    baseIndexDir,
    baseStamp,
    signature,
  });

  if (changed) {
    const overlayManifest = new ManifestManager(overlay.dbPath);
    if (manifestEntries.length > 0) {
      await overlayManifest.updateFiles(manifestEntries);
    }
    // Provenance for `lien gc`: the overlay's source root is the worktree, so a
    // deleted worktree leaves an orphan-detectable overlay index.
    await overlayManifest.recordSourceRoot(path.resolve(overlay.worktreeRoot));
    await overlay.bumpVersion();
  }

  return { ...counts, changed };
}

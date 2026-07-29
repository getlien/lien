import { ManifestManager } from '@liendev/core';
import type { VectorDBInterface } from '@liendev/core';
import { getCanonicalPath } from '@liendev/parser';

/**
 * Of `filepaths`, the subset with no entry in the index manifest at all.
 *
 * `get_files_context`, `get_dependents`, and `get_complexity` all answer
 * questions about a caller-supplied filepath by querying the chunk/dependency
 * data for that path — and a path the index has never heard of (a typo'd
 * directory prefix, wrong case, a file outside the indexed project) produces
 * exactly the same shape as a real file that legitimately has zero
 * chunks/dependents/violations: an empty result, reported with full
 * confidence. That silent conflation is dangerous specifically because these
 * are the tools an agent is told to trust before editing — an unknown path
 * masquerading as "this file has no dependents" reads as "safe to edit
 * carelessly".
 *
 * The manifest (`ManifestManager.getIndexedFiles()`) is the cheap way to
 * break the tie: it's the indexer's own ledger of "these paths are indexed",
 * independent of how many chunks each one produced, so a lookup here doesn't
 * require a full `scanAll` and doesn't get confused by a file that is indexed
 * but genuinely empty.
 */
export async function findUnindexedPaths(
  vectorDB: VectorDBInterface,
  filepaths: readonly string[],
  workspaceRoot: string,
): Promise<string[]> {
  // Fail open, mirroring ManifestManager.load()'s own policy: this is a
  // diagnostic add-on, not load-bearing, so a missing/unreadable manifest
  // must never surface as a false "unindexed" claim or crash the handler.
  try {
    const manifest = new ManifestManager(vectorDB.dbPath);
    const indexedFiles = await manifest.getIndexedFiles();
    const indexedCanonical = new Set(indexedFiles.map(f => getCanonicalPath(f, workspaceRoot)));
    return filepaths.filter(fp => !indexedCanonical.has(getCanonicalPath(fp, workspaceRoot)));
  } catch {
    return [];
  }
}

/**
 * Render an unmissable note for filepaths the index has no record of,
 * mirroring the imperative, `⚠ Lien:`-prefixed tone of
 * `formatComplexityHeadroomWarning` (get-files-context.ts) — this is the same
 * "make it unmissable" step, just for a different signal. Returns `undefined`
 * when every path is known, so callers can spread it in conditionally without
 * an extra length check.
 */
export function formatUnindexedPathsNote(unindexedPaths: readonly string[]): string | undefined {
  if (unindexedPaths.length === 0) return undefined;
  const list = unindexedPaths.map(p => `"${p}"`).join(', ');
  return (
    `⚠ Lien: not found in the index: ${list}. This is NOT the same as "indexed with ` +
    `no results" — do not treat it as a low-risk or dependency-free file. Check for a ` +
    `typo (missing/extra directory prefix, wrong case) before editing; try search_code ` +
    `or list_functions to find the real path, or run "lien index" if the file was added recently.`
  );
}

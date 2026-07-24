/**
 * Doc-reference lookup for a removed exported symbol — the deterministic
 * "shift docs-drift left" half of the blast-radius nudge (see
 * docs/architecture/blast-radius-nudge.md's docRefs section). When `lien
 * api-delta` detects a REMOVED export, this looks up which indexed
 * documentation ('doc'-type) chunks still name it, so the same warning can
 * say "N docs reference X: path1, path2, path3" without a second, separate
 * pass.
 *
 * Zero LLM: an index scan narrowed by the same word-boundary +
 * distinctiveness matching primitives the review pass's docs-drift-signals.ts
 * uses (`@liendev/parser`'s `doc-reference-matching.ts` — shared, not
 * duplicated) so a generic symbol name (`index`, `config`) can't spam the
 * warning with incidental prose hits.
 */

import type { VectorDBInterface, SearchResult } from '@liendev/core';
import { wordBoundaryRe, isDistinctiveToken, type CodeChunk } from '@liendev/parser';

/** Distinct doc file paths shown inline before falling back to "+N more". */
export const MAX_DOC_REF_PATHS = 3;

export interface DocReferenceResult {
  /** Distinct doc files that genuinely reference the symbol (post word-boundary + distinctiveness filtering). */
  count: number;
  /** Up to `MAX_DOC_REF_PATHS` file paths, sorted. */
  paths: string[];
}

const EMPTY_RESULT: DocReferenceResult = { count: 0, paths: [] };

function toDocChunk(result: SearchResult): CodeChunk {
  return { content: result.content, metadata: result.metadata } as CodeChunk;
}

/** Doc-type chunks whose content contains a genuine word-boundary occurrence of `symbolName`. */
function collectMatchingDocChunks(allChunks: SearchResult[], symbolName: string): CodeChunk[] {
  const re = wordBoundaryRe(symbolName);
  return allChunks
    .filter(r => r.metadata.type === 'doc' && r.content.includes(symbolName))
    .map(toDocChunk)
    .filter(c => re.test(c.content));
}

/**
 * Best-effort, fail-open lookup: any thrown error (closed db, corrupt store,
 * etc.) yields `null` — callers treat that identically to "zero references
 * found" (omit the docRefs line). This runs only on an already-detected
 * removal (the rare event `lien api-delta` already pays a full index scan
 * for via `findDependents`), so an independent scan here is an accepted,
 * bounded extra cost, not a hot-path concern.
 */
export async function findDocReferences(
  vectorDB: VectorDBInterface,
  symbolName: string,
): Promise<DocReferenceResult | null> {
  try {
    const allChunks = await vectorDB.scanAll();
    const docChunks = collectMatchingDocChunks(allChunks, symbolName);
    if (docChunks.length === 0) return EMPTY_RESULT;

    // A generic symbol name (e.g. `index`, `config`) that also reads as ordinary prose
    // elsewhere in the corpus must not spam the warning — suppress entirely rather than
    // report a misleading "N docs reference X" for an incidental word match.
    if (!isDistinctiveToken(symbolName, docChunks)) return EMPTY_RESULT;

    const files = [...new Set(docChunks.map(c => c.metadata.file))].sort();
    return { count: files.length, paths: files.slice(0, MAX_DOC_REF_PATHS) };
  } catch {
    return null;
  }
}

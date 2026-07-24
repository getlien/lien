/**
 * Exported-symbol signature-delta primitive — the content-based, zero-index
 * detector behind `lien api-delta` (FEATURE 1 / the blast-radius nudge).
 *
 * CLAUDE.md mandates running `get_dependents` before changing or removing the
 * signature of an exported symbol, but nothing enforced it at edit time. This
 * module answers, from two content strings alone, whether an edit changed or
 * removed the signature of a symbol that was part of the file's public API —
 * the deterministic half of the nudge; enrichment (dependent counts, risk)
 * happens separately, best-effort, against the index (see `api-delta-cmd.ts`).
 *
 * Reuses `complexity-delta.ts`'s exact qualified-name matching (function-level
 * renames are not tracked, same as there). Covers exported top-level functions
 * and exported class methods only — interface method signatures, exported
 * type-alias function types, aliased re-exports, default exports, and
 * TypeScript overload-declaration-only changes are known, safe-direction
 * (silent) misses — see docs/architecture/blast-radius-nudge.md's "Known
 * limitations".
 */

import { chunkFile } from '@liendev/parser';
import type { ChunkMetadata, FileContentChange } from '@liendev/parser';

export type ExportedSymbolChangeKind = 'signature-changed' | 'removed';

export interface ExportedSymbolChange {
  /** Display name, parentClass-qualified when present: "Foo.bar" or "bar". */
  symbol: string;
  /** Bare name, for get_dependents / findDependents symbol tracking. */
  symbolName: string;
  parentClass?: string;
  kind: ExportedSymbolChangeKind;
  /** Present only for 'signature-changed'. */
  beforeSignature?: string;
  /** Present only for 'signature-changed'. */
  afterSignature?: string;
}

export interface ExportedSignatureDelta {
  filepath: string;
  /** Empty => stay silent; caller (api-delta-cmd) treats this as "nothing to nudge". */
  changes: ExportedSymbolChange[];
}

/** Qualified match key — identical to complexity-delta's `functionKey`. */
function functionKey(meta: ChunkMetadata): string {
  return `${meta.parentClass ?? ''}::${meta.symbolName ?? ''}`;
}

/**
 * Whether a chunk is part of the file's exported API surface. Top-level
 * functions are exported when their own name is in the file's exported-name
 * list; methods are exported when their *class* is (methods don't appear in
 * `exports` by name — see the premise verification in the PR description).
 * Hard-private JS methods (`#foo`) are never external API surface even on an
 * exported class, and are filtered out before this is ever called (see
 * `functionMetadataByKey` below), so this never needs to special-case them.
 */
function isExportedChunk(meta: ChunkMetadata): boolean {
  if (meta.symbolType === 'function') {
    return !!meta.symbolName && (meta.exports?.includes(meta.symbolName) ?? false);
  }
  if (meta.symbolType === 'method') {
    return !!meta.parentClass && (meta.exports?.includes(meta.parentClass) ?? false);
  }
  return false;
}

/**
 * Chunk content into function/method metadata, grouped by qualified key and
 * sorted by startLine so same-keyed functions (overloads) pair positionally —
 * mirrors complexity-delta.ts's `functionMetadataByKey` exactly, so the two
 * detectors can never structurally disagree on what counts as "the same
 * function across versions". Hard-private methods (`#foo`) are dropped here:
 * they can never break an external caller, so they should never surface as
 * either a removal or a signature change.
 */
function functionMetadataByKey(
  filepath: string,
  content: string | null,
): Map<string, ChunkMetadata[]> {
  const byKey = new Map<string, ChunkMetadata[]>();
  if (content === null) return byKey;

  const chunks = chunkFile(filepath, content, { useAST: true, astFallback: 'line-based' });
  for (const { metadata } of chunks) {
    if (metadata.symbolType !== 'function' && metadata.symbolType !== 'method') continue;
    if (!metadata.symbolName) continue;
    if (metadata.symbolName.startsWith('#')) continue;
    const key = functionKey(metadata);
    const list = byKey.get(key) ?? [];
    list.push(metadata);
    byKey.set(key, list);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => a.startLine - b.startLine);
  }
  return byKey;
}

/**
 * Normalize a signature string for equality comparison only (display still
 * uses the raw `before.signature`/`after.signature`). Collapses whitespace
 * runs (including newlines) to nothing around structural punctuation, so a
 * pure reflow — wrapping params onto multiple lines, adding/removing a
 * trailing comma, or changing comma spacing (`f(a,b)` vs `f(a, b)`) — is
 * invisible to the comparison. Deliberately does NOT touch identifier text:
 * a positional parameter rename (`f(a)` -> `f(input)`) still produces a
 * different normalized string and still fires — that's a real API-surface
 * change in keyword-argument languages (e.g. Python), not noise. See the
 * "Known limitations" section of docs/architecture/blast-radius-nudge.md.
 */
function normalizeSignature(signature: string): string {
  return signature
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .replace(/,\)/g, ')')
    .trim();
}

/** Build the display name / bare name / parentClass triple for a matched pair's anchor. */
function symbolIdentity(
  anchor: ChunkMetadata,
): Pick<ExportedSymbolChange, 'symbol' | 'symbolName' | 'parentClass'> {
  const symbolName = anchor.symbolName ?? '';
  const parentClass = anchor.parentClass;
  return {
    symbol: parentClass ? `${parentClass}.${symbolName}` : symbolName,
    symbolName,
    parentClass,
  };
}

/**
 * Classify one matched (before?, after?) pair. Returns null when there is
 * nothing to report: never exported (on either side — a newly-added export
 * breaks no existing caller, so it is deliberately not flagged either), or
 * exported on both sides with an unchanged signature.
 */
function classifyPair(
  before: ChunkMetadata | undefined,
  after: ChunkMetadata | undefined,
): ExportedSymbolChange | null {
  const wasExported = before !== undefined && isExportedChunk(before);
  if (!wasExported) return null;

  const isExportedNow = after !== undefined && isExportedChunk(after);
  if (!isExportedNow) {
    // Deleted, or the export was dropped while the function still exists —
    // either way, existing callers will break. The highest-blast-radius case.
    return { ...symbolIdentity(before), kind: 'removed' };
  }

  const beforeSig = before.signature ?? '';
  const afterSig = after.signature ?? '';
  if (normalizeSignature(beforeSig) !== normalizeSignature(afterSig)) {
    return {
      ...symbolIdentity(after),
      kind: 'signature-changed',
      beforeSignature: before.signature,
      afterSignature: after.signature,
    };
  }

  return null; // exported on both sides, signature unchanged — silent
}

/** Worse (higher blast radius) first; deterministic tie-break by symbol name. */
function compareChanges(a: ExportedSymbolChange, b: ExportedSymbolChange): number {
  if (a.kind !== b.kind) return a.kind === 'removed' ? -1 : 1;
  return a.symbol.localeCompare(b.symbol);
}

/**
 * Compute the exported-signature delta for a single file's before/after
 * content. Pure, content-only — zero LLM, zero index, zero git — so it is
 * fully unit-testable with two content strings.
 */
export function computeExportedSignatureDelta(change: FileContentChange): ExportedSignatureDelta {
  const beforePath = change.oldPath ?? change.filepath;
  const beforeByKey = functionMetadataByKey(beforePath, change.before);
  const afterByKey = functionMetadataByKey(change.filepath, change.after);

  const allKeys = new Set<string>([...beforeByKey.keys(), ...afterByKey.keys()]);
  const changes: ExportedSymbolChange[] = [];

  for (const key of allKeys) {
    const beforeList = beforeByKey.get(key) ?? [];
    const afterList = afterByKey.get(key) ?? [];
    const pairs = Math.max(beforeList.length, afterList.length);
    for (let i = 0; i < pairs; i++) {
      const result = classifyPair(beforeList[i], afterList[i]);
      if (result) changes.push(result);
    }
  }

  changes.sort(compareChanges);

  return { filepath: change.filepath, changes };
}

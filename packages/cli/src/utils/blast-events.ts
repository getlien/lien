/**
 * Local, append-only JSONL event log for `lien api-delta` runs that found at
 * least one exported-signature change — the raw material behind `lien
 * stats`'s "exported-signature nudge" section. Sibling to `delta-events.ts`,
 * not sharing its `DeltaEvent` shape: a blast-radius event has no exit code,
 * mode, or complexity-crossing counts to speak of, and `lien api-delta` is
 * advisory-only (no gate), so overloading `DeltaEvent` would mean bolting on
 * fields that don't apply to either concept.
 *
 * One line is appended to `<indexDir>/blast-events.jsonl` (the same per-repo
 * directory `delta-events.jsonl` lives in) per changed file that had at least
 * one exported-signature change or removal — never for a clean edit, so
 * `lien stats`'s "runs" count answers "edits that changed an exported
 * signature", not "edits observed". There is no network call anywhere in this
 * file, no telemetry, nothing phones home.
 *
 * Kill switch: `LIEN_BLAST_EVENTS=off` disables recording entirely (reading
 * still works, so history already on disk stays visible to `lien stats`).
 */

import fs from 'fs/promises';
import path from 'path';
import { getIndexDir } from '@liendev/core';
import type { ExportedSymbolChangeKind } from './signature-delta.js';

export const BLAST_EVENTS_FILENAME = 'blast-events.jsonl';

/**
 * The persisted shape of an attribution caveat — structurally identical to
 * `get-dependents.ts`'s `AttributionCaveat`, but `reason` is a plain
 * `string`, not that type's closed `AttributionCaveatReason` union. A JSONL
 * line on disk was written by whatever version of Lien ran at the time, so
 * a `reason` here is only ever verified to be A string, never verified to
 * be a CURRENT member of that union — a reason added in a later version
 * (read by an older `lien stats`), or one retired since, both round-trip
 * here as an honest but unrecognized string, rather than being silently
 * dropped or miscoerced into a value that was never actually recorded.
 * `isValidAttributionCaveat` below enforces exactly this and nothing more.
 * A consumer that keys on `.reason` must handle an unrecognized value
 * explicitly — the same defensive-read idiom `riskBucket`
 * (`blast-stats.ts`) already uses for `riskLevel`, never an assumption that
 * it's one of today's five.
 */
export interface PersistedAttributionCaveat {
  reason: string;
  note: string;
}

/** Trigger: once the log exceeds this many bytes, trim it down. */
export const MAX_BYTES_BEFORE_TRIM = 2 * 1024 * 1024; // 2 MB
/** How many of the most recent lines survive a trim (oldest lines are dropped). */
export const KEEP_LINES_AFTER_TRIM = 2000;

export interface BlastEventChange {
  symbol: string;
  kind: ExportedSymbolChangeKind;
  /** null when the index was unavailable or `findDependents` failed (degraded). */
  dependentCount: number | null;
  untestedDependentCount: number | null;
  riskLevel: string | null;
  /**
   * Distinct doc chunks referencing this symbol (see
   * docs/architecture/blast-radius-nudge.md's docRefs section) — only
   * meaningful for a `removed` change. `undefined` on any event recorded
   * before this field existed; readers must treat that the same as `null`
   * (unknown/not computed), never as "zero references".
   */
  docRefCount?: number | null;
  /**
   * Same five-reason vocabulary `get_dependents` exposes as
   * `attributionCaveat` (#1097) -- present when `dependentCount`/`riskLevel`
   * above can't be trusted as a verified clear (e.g. a Java/Kotlin/Swift/C#
   * same-unit-access blind spot). `null` when enrichment found nothing to
   * hedge. `undefined` on any event recorded before this field existed;
   * readers must treat that the same as `null` (unknown/not computed),
   * never as "verified clear" -- an older line's absence of this key says
   * nothing about whether a caveat would have applied.
   */
  attributionCaveat?: PersistedAttributionCaveat | null;
}

export interface BlastEvent {
  /** ISO-8601 timestamp of when the run completed. */
  timestamp: string;
  filepath: string;
  /** Every exported-symbol change detected in this file this run. Never empty. */
  changes: BlastEventChange[];
  /** True when at least one change was enriched against the index. */
  enriched: boolean;
}

/** `LIEN_BLAST_EVENTS=off` disables recording. Reading is never gated by this. */
export function blastEventsEnabled(): boolean {
  return process.env.LIEN_BLAST_EVENTS !== 'off';
}

/** Absolute path to the JSONL log for `rootDir`'s index directory. */
export function blastEventsFilePath(rootDir: string): string {
  return path.join(getIndexDir(rootDir), BLAST_EVENTS_FILENAME);
}

/**
 * Append one event, then trim from the front once the log has grown past
 * `MAX_BYTES_BEFORE_TRIM` — bounded, no silent unbounded growth. Best-effort
 * throughout: any failure (unwritable disk, a race with a concurrent writer)
 * is swallowed so recording can never break `lien api-delta` itself.
 */
export async function recordBlastEvent(rootDir: string, event: BlastEvent): Promise<void> {
  if (!blastEventsEnabled()) return;
  try {
    const filePath = blastEventsFilePath(rootDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
    await trimIfOversized(filePath);
  } catch {
    // Best-effort: recording must never break `lien api-delta` itself.
  }
}

function byteSizeOf(lines: string[]): number {
  return Buffer.byteLength(`${lines.join('\n')}\n`, 'utf-8');
}

/** Truncate-from-front once the log exceeds the byte cap — see delta-events.ts's twin for the full rationale. */
async function trimIfOversized(filePath: string): Promise<void> {
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats || stats.size <= MAX_BYTES_BEFORE_TRIM) return;

  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.length > 0);

  let kept = lines.length > KEEP_LINES_AFTER_TRIM ? lines.slice(-KEEP_LINES_AFTER_TRIM) : lines;
  while (kept.length > 1 && byteSizeOf(kept) > MAX_BYTES_BEFORE_TRIM) {
    kept = kept.slice(1);
  }

  if (kept.length === lines.length) return; // nothing to trim
  await fs.writeFile(filePath, `${kept.join('\n')}\n`, 'utf-8');
}

/** A recorded count field: a real number, or `null` for "checked, unknown/degraded". */
function isValidNumberOrNull(value: unknown): boolean {
  return typeof value === 'number' || value === null;
}

/** Same as `isValidNumberOrNull`, plus `undefined` — for a field added after some
 *  events were already on disk, where an older line simply won't have the key. */
function isValidOptionalNumber(value: unknown): boolean {
  return value === undefined || isValidNumberOrNull(value);
}

/**
 * `attributionCaveat` is `undefined` (a pre-#1097 line), `null` (nothing to
 * hedge), or a `PersistedAttributionCaveat` -- a plain string `reason` plus
 * a string `note`, deliberately NOT checked against the current
 * `AttributionCaveatReason` union (see that type's own doc comment): this
 * validator's job is only to reject a shape that couldn't have come from
 * `recordBlastEvent` at all (a torn write, a hand-edited line, a wrong
 * type), not to reject a foreign-but-honest reason string written by a
 * different version of Lien.
 */
function isValidAttributionCaveat(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return typeof c.reason === 'string' && typeof c.note === 'string';
}

function isValidBlastEventChange(value: unknown): value is BlastEventChange {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.symbol !== 'string') return false;
  if (c.kind !== 'signature-changed' && c.kind !== 'removed') return false;
  if (!isValidNumberOrNull(c.dependentCount)) return false;
  if (!isValidNumberOrNull(c.untestedDependentCount)) return false;
  if (typeof c.riskLevel !== 'string' && c.riskLevel !== null) return false;
  if (!isValidOptionalNumber(c.docRefCount)) return false;
  if (!isValidAttributionCaveat(c.attributionCaveat)) return false;
  return true;
}

/**
 * Shape-validate a parsed JSONL line before trusting it as a `BlastEvent` — a
 * torn write or hand-edited line must not crash a downstream consumer
 * (`computeBlastWindowStats`'s per-change iteration). Skipped like a
 * JSON.parse failure, not thrown.
 */
function isValidBlastEvent(value: unknown): value is BlastEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.timestamp !== 'string') return false;
  if (typeof v.filepath !== 'string') return false;
  if (typeof v.enriched !== 'boolean') return false;
  return (
    Array.isArray(v.changes) && v.changes.length > 0 && v.changes.every(isValidBlastEventChange)
  );
}

/**
 * Read every recorded event for `rootDir`, oldest first. A missing log (never
 * ran `lien api-delta` here, or the kill switch has always been on) yields an
 * empty array. A malformed line is skipped rather than failing the whole read.
 */
export async function readBlastEvents(rootDir: string): Promise<BlastEvent[]> {
  let content: string;
  try {
    content = await fs.readFile(blastEventsFilePath(rootDir), 'utf-8');
  } catch {
    return [];
  }

  const events: BlastEvent[] = [];
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isValidBlastEvent(parsed)) events.push(parsed);
    } catch {
      // Skip a torn/corrupted line rather than failing the whole read.
    }
  }
  return events;
}

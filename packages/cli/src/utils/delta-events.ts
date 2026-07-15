/**
 * Local, append-only JSONL event log for `lien delta` runs — the raw material
 * behind `lien stats`. Strictly local: one line is appended to
 * `<indexDir>/delta-events.jsonl` (the same per-repo directory the structural
 * index lives in, resolved via `getIndexDir` from `@liendev/parser`) on every
 * `lien delta` invocation — manual, plugin-hook-driven (`delta-write.sh`), or
 * CI `--base` runs. There is no network call anywhere in this file, no
 * telemetry, nothing phones home. See docs/architecture/lien-delta.md
 * ("Measuring the nudge loop") for the full design and honest limitations.
 *
 * Kill switch: `LIEN_DELTA_EVENTS=off` disables recording entirely (reading
 * still works, so history already on disk stays visible to `lien stats`).
 */

import fs from 'fs/promises';
import path from 'path';
import { getIndexDir } from '@liendev/parser';
import type { ComplexityMetricType } from '@liendev/parser';

export const DELTA_EVENTS_FILENAME = 'delta-events.jsonl';

/** Trigger: once the log exceeds this many bytes, trim it down. */
export const MAX_BYTES_BEFORE_TRIM = 2 * 1024 * 1024; // 2 MB
/** How many of the most recent lines survive a trim (oldest lines are dropped). */
export const KEEP_LINES_AFTER_TRIM = 2000;

/** One (function, metric) pair with a failing verdict in a single delta run. */
export interface DeltaFlaggedFunction {
  filepath: string;
  /** Qualified name matching the CLI report's display name, e.g. "MyClass.doThing". */
  symbol: string;
  metric: ComplexityMetricType;
}

export interface DeltaEventCounts {
  /** crossed + newOverThreshold — the count that fails the gate (matches the CLI's "N new crossing(s)" line). */
  crossings: number;
  newOverThreshold: number;
  improved: number;
}

export interface DeltaEvent {
  /** ISO-8601 timestamp of when the run completed. */
  timestamp: string;
  mode: 'normal' | 'soft';
  exitCode: number;
  counts: DeltaEventCounts;
  /** Every (function, metric) pair with a failing verdict this run. Empty when clean. */
  flagged: DeltaFlaggedFunction[];
}

/** `LIEN_DELTA_EVENTS=off` disables recording. Reading is never gated by this. */
export function deltaEventsEnabled(): boolean {
  return process.env.LIEN_DELTA_EVENTS !== 'off';
}

/** Absolute path to the JSONL log for `rootDir`'s index directory. */
export function deltaEventsFilePath(rootDir: string): string {
  return path.join(getIndexDir(rootDir), DELTA_EVENTS_FILENAME);
}

/**
 * Append one event, then trim from the front once the log has grown past
 * `MAX_BYTES_BEFORE_TRIM` — bounded, no silent unbounded growth. Best-effort
 * throughout: any failure (unwritable disk, race with a concurrent writer) is
 * swallowed so recording can never break the `lien delta` gate it instruments.
 */
export async function recordDeltaEvent(rootDir: string, event: DeltaEvent): Promise<void> {
  if (!deltaEventsEnabled()) return;
  try {
    const filePath = deltaEventsFilePath(rootDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
    await trimIfOversized(filePath);
  } catch {
    // Best-effort: recording must never break `lien delta` itself.
  }
}

function byteSizeOf(lines: string[]): number {
  return Buffer.byteLength(`${lines.join('\n')}\n`, 'utf-8');
}

/**
 * Truncate-from-front once the log exceeds the byte cap: first drop down to
 * the newest KEEP_LINES_AFTER_TRIM lines (the cheap, common case), then — since
 * a handful of unusually large events can themselves exceed the byte cap while
 * staying well under the line-count cap — keep dropping the oldest surviving
 * line until back under budget. Never drops below a single line, so one
 * oversized event stays visible rather than silently vanishing (that residual
 * line can still exceed the cap only in the pathological case of one event
 * whose own JSON is larger than the cap).
 */
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

/** Validates one element of `flagged` — every field `functionKey` (delta-stats.ts) destructures. */
function isValidFlaggedFunction(value: unknown): value is DeltaFlaggedFunction {
  if (typeof value !== 'object' || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.filepath === 'string' && typeof f.symbol === 'string' && typeof f.metric === 'string'
  );
}

/**
 * Shape-validate a parsed JSONL line before trusting it as a `DeltaEvent`.
 * Valid JSON with the wrong shape (e.g. a torn write that dropped `flagged`,
 * a `flagged` element that is `null`, or a hand-edited line) must not crash a
 * downstream consumer like `computeDeltaWindowStats`'s
 * `e.flagged.map(functionKey)` (which destructures `filepath`/`symbol` off
 * each element) — it's treated the same as a JSON.parse failure: the whole
 * line is skipped, not thrown.
 */
function isValidDeltaEvent(value: unknown): value is DeltaEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.timestamp !== 'string') return false;
  if (v.mode !== 'normal' && v.mode !== 'soft') return false;
  if (typeof v.exitCode !== 'number') return false;
  if (typeof v.counts !== 'object' || v.counts === null) return false;
  const counts = v.counts as Record<string, unknown>;
  if (
    typeof counts.crossings !== 'number' ||
    typeof counts.newOverThreshold !== 'number' ||
    typeof counts.improved !== 'number'
  ) {
    return false;
  }
  return Array.isArray(v.flagged) && v.flagged.every(isValidFlaggedFunction);
}

/**
 * Read every recorded event for `rootDir`, oldest first. A missing log (never
 * ran `lien delta` here, or the kill switch has always been on) yields an
 * empty array. A malformed line — invalid JSON, or valid JSON with the wrong
 * shape (e.g. a torn write from a crash mid-append) — is skipped rather than
 * failing the whole read or crashing a downstream consumer.
 */
export async function readDeltaEvents(rootDir: string): Promise<DeltaEvent[]> {
  let content: string;
  try {
    content = await fs.readFile(deltaEventsFilePath(rootDir), 'utf-8');
  } catch {
    return [];
  }

  const events: DeltaEvent[] = [];
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isValidDeltaEvent(parsed)) events.push(parsed);
    } catch {
      // Skip a torn/corrupted line rather than failing the whole read.
    }
  }
  return events;
}

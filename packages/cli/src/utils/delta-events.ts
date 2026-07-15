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

/** Truncate-from-front: keep only the newest KEEP_LINES_AFTER_TRIM lines once oversized. */
async function trimIfOversized(filePath: string): Promise<void> {
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats || stats.size <= MAX_BYTES_BEFORE_TRIM) return;

  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.length > 0);
  if (lines.length <= KEEP_LINES_AFTER_TRIM) return;

  const kept = lines.slice(-KEEP_LINES_AFTER_TRIM);
  await fs.writeFile(filePath, `${kept.join('\n')}\n`, 'utf-8');
}

/**
 * Read every recorded event for `rootDir`, oldest first. A missing log (never
 * ran `lien delta` here, or the kill switch has always been on) yields an
 * empty array. A malformed line (e.g. a torn write from a crash mid-append) is
 * skipped rather than failing the whole read.
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
      events.push(JSON.parse(line) as DeltaEvent);
    } catch {
      // Skip a torn/corrupted line rather than failing the whole read.
    }
  }
  return events;
}

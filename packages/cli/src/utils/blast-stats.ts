/**
 * Pure aggregation over recorded `lien api-delta` events (see
 * `blast-events.ts`) — the numbers behind `lien stats`'s "exported-signature
 * nudge" section. No I/O: takes an in-memory event array, so it's trivially
 * unit-testable with synthetic event sequences.
 */

import type { BlastEvent } from './blast-events.js';

export type BlastRiskBucket = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

const RISK_BUCKETS: readonly BlastRiskBucket[] = ['low', 'medium', 'high', 'critical', 'unknown'];

export interface BlastWindowStats {
  windowDays: number;
  /** Edits in the window that changed or removed an exported symbol's signature. */
  runs: number;
  /** Distinct (filepath, symbol) pairs changed at least once in the window. */
  distinctSymbolsChanged: number;
  /** Count of individual changes in the window, bucketed by risk level ('unknown' = degraded, no index). */
  byRiskLevel: Record<BlastRiskBucket, number>;
}

function eventTimeMs(event: BlastEvent): number {
  return Date.parse(event.timestamp);
}

/** Events within the last `windowDays` days of `now`. Unparsable timestamps are dropped. */
function eventsInWindow(events: BlastEvent[], windowDays: number, now: Date): BlastEvent[] {
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return events.filter(e => {
    const t = eventTimeMs(e);
    return Number.isFinite(t) && t >= cutoffMs;
  });
}

function emptyRiskBuckets(): Record<BlastRiskBucket, number> {
  return { low: 0, medium: 0, high: 0, critical: 0, unknown: 0 };
}

function riskBucket(riskLevel: string | null): BlastRiskBucket {
  return riskLevel !== null && (RISK_BUCKETS as readonly string[]).includes(riskLevel)
    ? (riskLevel as BlastRiskBucket)
    : 'unknown';
}

/**
 * Compute stats over the events whose timestamp falls within the last
 * `windowDays` days of `now` (default: real current time).
 */
export function computeBlastWindowStats(
  events: BlastEvent[],
  windowDays: number,
  now: Date = new Date(),
): BlastWindowStats {
  const inWindow = eventsInWindow(events, windowDays, now);
  const symbolKeys = new Set<string>();
  const byRiskLevel = emptyRiskBuckets();

  for (const event of inWindow) {
    for (const change of event.changes) {
      symbolKeys.add(`${event.filepath} ${change.symbol}`);
      byRiskLevel[riskBucket(change.riskLevel)]++;
    }
  }

  return {
    windowDays,
    runs: inWindow.length,
    distinctSymbolsChanged: symbolKeys.size,
    byRiskLevel,
  };
}

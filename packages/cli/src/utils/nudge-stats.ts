/**
 * Pure aggregation over recorded nudge events (see `nudge-events.ts`) — the
 * "shown → acted-on" funnels behind `lien stats`. No I/O: takes in-memory event
 * arrays, so it's trivially unit-testable with synthetic sequences.
 *
 * The join is deliberately cheap (the brief's "cheap joins at report time rather
 * than complex live correlation"): group events by session, and for each session
 * remember the LATEST timestamp of each signal type. A `shown` event counts as
 * acted-on when some signal its nudge cares about occurred in the same session at
 * or after the shown timestamp — i.e. when that signal type's latest timestamp is
 * ≥ the shown timestamp. That's an O(n) pass, no per-pair comparison.
 *
 * HONESTY (mirrors delta-stats.ts's `resolvedAfterFlag` doc): "acted-on" is a
 * same-session, later-in-time correlation, NOT proof the nudge caused the action.
 * A `get_dependents` call after a blast-radius nudge might be about the flagged
 * symbol or about something unrelated the agent was already going to check. The
 * funnel measures co-occurrence over time, nothing stronger.
 */

import type { NudgeEvent, NudgeName, NudgeSignalName } from './nudge-events.js';
import type { DeltaEvent } from './delta-events.js';
import { computeDeltaWindowStats } from './delta-stats.js';

/** Every nudge that gets a funnel row, including `delta` (sourced from delta-events). */
export type FunnelNudge = NudgeName | 'delta';

export interface NudgeFunnel {
  nudge: FunnelNudge;
  windowDays: number;
  /** Nudge-shown events in the window. For `delta`: distinct functions flagged. */
  shown: number;
  /**
   * Of those shown, how many had a qualifying same-session follow-up signal at
   * or after the shown timestamp. For `delta`: functions later seen clean
   * (`resolvedAfterFlag`). NOT a causal count — see the file header.
   */
  acted: number;
  /** `acted / shown`, or `null` when nothing was shown (no share to take). */
  actedShare: number | null;
}

/** Which follow-up signals count as "acted-on" for each recorded nudge. */
const SIGNALS_FOR_NUDGE: Record<NudgeName, readonly NudgeSignalName[]> = {
  // A read-time annotation is "acted on" if the agent then pulls structural
  // context or dependents for a file this session.
  annotate: ['get_files_context', 'get_dependents'],
  // A blast-radius nudge asks the agent to check get_dependents.
  blast: ['get_dependents'],
  // The did-you-run-the-tests nudge asks for a test run.
  'test-verify': ['test_run'],
};

const RECORDED_NUDGES: readonly NudgeName[] = ['annotate', 'blast', 'test-verify'];

function eventTimeMs(event: NudgeEvent): number {
  return Date.parse(event.timestamp);
}

/** Events within the last `windowDays` days of `now`. Unparsable timestamps are dropped. */
function eventsInWindow(events: NudgeEvent[], windowDays: number, now: Date): NudgeEvent[] {
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return events.filter(e => {
    const t = eventTimeMs(e);
    return Number.isFinite(t) && t >= cutoffMs;
  });
}

interface SessionState {
  shown: Array<{ nudge: NudgeName; timeMs: number }>;
  /** signal type → latest timestamp (ms) seen for it this session. */
  latestSignalMs: Map<NudgeSignalName, number>;
}

/** Group in-window events by session, tracking each session's shown events and latest signal times. */
function groupBySession(events: NudgeEvent[]): Map<string, SessionState> {
  const sessions = new Map<string, SessionState>();
  for (const e of events) {
    const timeMs = eventTimeMs(e);
    if (!Number.isFinite(timeMs)) continue;
    let state = sessions.get(e.sessionId);
    if (!state) {
      state = { shown: [], latestSignalMs: new Map() };
      sessions.set(e.sessionId, state);
    }
    if (e.kind === 'shown') {
      state.shown.push({ nudge: e.nudge, timeMs });
    } else {
      const prev = state.latestSignalMs.get(e.signal);
      if (prev === undefined || timeMs > prev) state.latestSignalMs.set(e.signal, timeMs);
    }
  }
  return sessions;
}

/** A shown event is acted-on when some signal its nudge cares about occurred at/after it in the same session. */
function isActedOn(
  nudge: NudgeName,
  shownMs: number,
  latestSignalMs: Map<NudgeSignalName, number>,
): boolean {
  return SIGNALS_FOR_NUDGE[nudge].some(signal => {
    const latest = latestSignalMs.get(signal);
    return latest !== undefined && latest >= shownMs;
  });
}

/** Funnels for the three hook-recorded nudges (annotate/blast/test-verify). */
function computeRecordedFunnels(
  events: NudgeEvent[],
  windowDays: number,
  now: Date,
): NudgeFunnel[] {
  const sessions = groupBySession(eventsInWindow(events, windowDays, now));

  const shownByNudge = new Map<NudgeName, number>();
  const actedByNudge = new Map<NudgeName, number>();
  for (const nudge of RECORDED_NUDGES) {
    shownByNudge.set(nudge, 0);
    actedByNudge.set(nudge, 0);
  }

  for (const state of sessions.values()) {
    for (const s of state.shown) {
      shownByNudge.set(s.nudge, (shownByNudge.get(s.nudge) ?? 0) + 1);
      if (isActedOn(s.nudge, s.timeMs, state.latestSignalMs)) {
        actedByNudge.set(s.nudge, (actedByNudge.get(s.nudge) ?? 0) + 1);
      }
    }
  }

  return RECORDED_NUDGES.map(nudge => {
    const shown = shownByNudge.get(nudge) ?? 0;
    const acted = actedByNudge.get(nudge) ?? 0;
    return { nudge, windowDays, shown, acted, actedShare: shown > 0 ? acted / shown : null };
  });
}

/**
 * The `delta` funnel, sourced from the existing delta-events log rather than
 * `nudge-events.jsonl` — shown = distinct functions flagged, acted = functions
 * later seen clean (`resolvedAfterFlag`). Reuses `computeDeltaWindowStats` so the
 * delta funnel can never disagree with the delta section of `lien stats`.
 */
function computeDeltaFunnel(deltaEvents: DeltaEvent[], windowDays: number, now: Date): NudgeFunnel {
  const stats = computeDeltaWindowStats(deltaEvents, windowDays, now);
  const shown = stats.distinctFunctionsFlagged;
  const acted = stats.resolvedAfterFlag;
  return { nudge: 'delta', windowDays, shown, acted, actedShare: shown > 0 ? acted / shown : null };
}

/**
 * Compute every nudge funnel for the window: the three hook-recorded nudges
 * (annotate/blast/test-verify) plus the delta funnel derived from `deltaEvents`.
 * Order is stable: delta first (matches the existing `lien stats` layout), then
 * the recorded nudges.
 */
export function computeNudgeFunnels(
  events: NudgeEvent[],
  deltaEvents: DeltaEvent[],
  windowDays: number,
  now: Date = new Date(),
): NudgeFunnel[] {
  return [
    computeDeltaFunnel(deltaEvents, windowDays, now),
    ...computeRecordedFunnels(events, windowDays, now),
  ];
}

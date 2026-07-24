/**
 * Local, append-only JSONL event log for the nudge-outcome funnels behind
 * `lien stats` (the "shown → acted-on" section). Sibling to `delta-events.ts`
 * and `blast-events.ts` under the same per-repo index directory
 * (`getIndexDir(rootDir)`), and — unlike the session-scoped test-ledger — it
 * ACCUMULATES across sessions rather than being GC'd at session end.
 *
 * Why durable, not session-GC'd: the funnels report 7/30-day windows, which a
 * per-session ledger (cleared at SessionEnd / GC'd after 24h idle) cannot back.
 * "Session-scoped" is preserved not in the file lifecycle but in the JOIN: every
 * event carries the `sessionId` it was recorded under, and a nudge counts as
 * "acted-on" only when a qualifying follow-up signal appears in the SAME session
 * at a later timestamp (see `nudge-stats.ts`). Growth is bounded exactly like
 * `delta-events.jsonl`: a 2 MB byte cap trims from the front. There is no network
 * call anywhere in this file, no telemetry, nothing phones home.
 *
 * Two event kinds share the file:
 *   - `shown`  — a nudge surfaced to the model (recorded by the emitting hook).
 *   - `signal` — a follow-up tool call a nudge cares about (a Lien MCP call, or
 *                a recognized test run), recorded so the funnel can join it back
 *                to a prior `shown` in the same session.
 * The `delta` nudge is intentionally NOT recorded here — its "shown → resolved"
 * funnel is derived from the existing `delta-events.jsonl` (see `nudge-stats.ts`),
 * reusing `resolvedAfterFlag` rather than duplicating it.
 *
 * Kill switch: `LIEN_NUDGE_EVENTS=off` disables recording entirely (reading
 * still works, so history already on disk stays visible to `lien stats`).
 */

import fs from 'fs/promises';
import path from 'path';
import { getIndexDir } from '@liendev/parser';

export const NUDGE_EVENTS_FILENAME = 'nudge-events.jsonl';

/** Trigger: once the log exceeds this many bytes, trim it down. */
export const MAX_BYTES_BEFORE_TRIM = 2 * 1024 * 1024; // 2 MB
/** How many of the most recent lines survive a trim (oldest lines are dropped). */
export const KEEP_LINES_AFTER_TRIM = 2000;

/** The nudges whose "shown" side is recorded here (delta reuses delta-events.jsonl). */
export type NudgeName = 'annotate' | 'blast' | 'test-verify';
/** The follow-up signals a nudge's funnel joins against. */
export type NudgeSignalName = 'get_dependents' | 'get_files_context' | 'test_run';

const NUDGE_NAMES: ReadonlySet<string> = new Set<NudgeName>(['annotate', 'blast', 'test-verify']);
const NUDGE_SIGNALS: ReadonlySet<string> = new Set<NudgeSignalName>([
  'get_dependents',
  'get_files_context',
  'test_run',
]);

/** A nudge surfaced to the model this session. */
export interface NudgeShownEvent {
  kind: 'shown';
  /** ISO-8601 timestamp of when the nudge was shown. */
  timestamp: string;
  /** The session the nudge was shown in — the join key for the funnel. */
  sessionId: string;
  nudge: NudgeName;
  /** Project-relative file the nudge was about, when the nudge has one (test-verify does not). */
  file?: string;
  /** The specific symbol, when known (rare — most shown events are file-scoped). */
  symbol?: string;
}

/** A follow-up tool call observed this session, joinable to a prior `shown`. */
export interface NudgeSignalEvent {
  kind: 'signal';
  timestamp: string;
  sessionId: string;
  signal: NudgeSignalName;
  file?: string;
  symbol?: string;
}

export type NudgeEvent = NudgeShownEvent | NudgeSignalEvent;

/** True when `value` is a nudge name whose "shown" side is recorded here. */
export function isNudgeName(value: string): value is NudgeName {
  return NUDGE_NAMES.has(value);
}

/** True when `value` is a recognized follow-up signal name. */
export function isNudgeSignalName(value: string): value is NudgeSignalName {
  return NUDGE_SIGNALS.has(value);
}

/** `LIEN_NUDGE_EVENTS=off` disables recording. Reading is never gated by this. */
export function nudgeEventsEnabled(): boolean {
  return process.env.LIEN_NUDGE_EVENTS !== 'off';
}

/** Absolute path to the JSONL log for `rootDir`'s index directory. */
export function nudgeEventsFilePath(rootDir: string): string {
  return path.join(getIndexDir(rootDir), NUDGE_EVENTS_FILENAME);
}

/**
 * Append one event, then trim from the front once the log has grown past
 * `MAX_BYTES_BEFORE_TRIM` — bounded, no silent unbounded growth. Best-effort
 * throughout: any failure (unwritable disk, a race with a concurrent writer)
 * is swallowed so recording can never break the hook that triggered it.
 */
export async function recordNudgeEvent(rootDir: string, event: NudgeEvent): Promise<void> {
  if (!nudgeEventsEnabled()) return;
  try {
    const filePath = nudgeEventsFilePath(rootDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
    await trimIfOversized(filePath);
  } catch {
    // Best-effort: recording must never break the hook it instruments.
  }
}

/**
 * Normalize a recorded file path to the project-relative form the
 * `NudgeShownEvent.file` / `NudgeSignalEvent.file` contract promises — the SAME
 * form Lien's MCP tool args use, so `nudge-stats.ts`'s matched join can compare
 * a `shown.file` (from the absolute Read/Edit tool path) against a `signal.file`
 * (from a repo-relative MCP arg) by plain string equality. Absolute paths are
 * relativized against `rootDir`; an already-relative path is only slash-
 * normalized (relativizing it again would resolve it against cwd and corrupt
 * it). An empty/undefined path passes through as undefined.
 */
function toRepoRelativeFile(rootDir: string, file?: string): string | undefined {
  if (!file) return undefined;
  if (!path.isAbsolute(file)) return file.replace(/\\/g, '/');
  return path.relative(rootDir, file).replace(/\\/g, '/');
}

/** Stamp `now` and record a nudge-shown event. `file` is normalized to project-relative; `file`/`symbol` omitted when empty. */
export async function recordNudgeShown(
  rootDir: string,
  fields: { sessionId: string; nudge: NudgeName; file?: string; symbol?: string },
): Promise<void> {
  const file = toRepoRelativeFile(rootDir, fields.file);
  await recordNudgeEvent(rootDir, {
    kind: 'shown',
    timestamp: new Date().toISOString(),
    sessionId: fields.sessionId,
    nudge: fields.nudge,
    ...(file ? { file } : {}),
    ...(fields.symbol ? { symbol: fields.symbol } : {}),
  });
}

/** Stamp `now` and record a follow-up signal event. `file` is normalized to project-relative; `file`/`symbol` omitted when empty. */
export async function recordNudgeSignal(
  rootDir: string,
  fields: { sessionId: string; signal: NudgeSignalName; file?: string; symbol?: string },
): Promise<void> {
  const file = toRepoRelativeFile(rootDir, fields.file);
  await recordNudgeEvent(rootDir, {
    kind: 'signal',
    timestamp: new Date().toISOString(),
    sessionId: fields.sessionId,
    signal: fields.signal,
    ...(file ? { file } : {}),
    ...(fields.symbol ? { symbol: fields.symbol } : {}),
  });
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

/** A recorded optional string field: absent, or a real string. */
function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/** Common shape both variants share: an object with string timestamp + sessionId. */
function hasValidEnvelope(v: Record<string, unknown>): boolean {
  return typeof v.timestamp === 'string' && typeof v.sessionId === 'string';
}

function isValidShown(v: Record<string, unknown>): boolean {
  return (
    typeof v.nudge === 'string' &&
    NUDGE_NAMES.has(v.nudge) &&
    isOptionalString(v.file) &&
    isOptionalString(v.symbol)
  );
}

function isValidSignal(v: Record<string, unknown>): boolean {
  return (
    typeof v.signal === 'string' &&
    NUDGE_SIGNALS.has(v.signal) &&
    isOptionalString(v.file) &&
    isOptionalString(v.symbol)
  );
}

/**
 * Shape-validate a parsed JSONL line before trusting it as a `NudgeEvent`. A
 * torn write, an unknown `nudge`/`signal` value (e.g. one written by a newer
 * version), or a hand-edited line is skipped like a JSON.parse failure rather
 * than crashing a downstream consumer (`nudge-stats.ts`'s per-session join).
 */
function isValidNudgeEvent(value: unknown): value is NudgeEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!hasValidEnvelope(v)) return false;
  if (v.kind === 'shown') return isValidShown(v);
  if (v.kind === 'signal') return isValidSignal(v);
  return false;
}

/**
 * Read every recorded event for `rootDir`, oldest first. A missing log (nothing
 * recorded here yet, or the kill switch has always been on) yields an empty
 * array. A malformed line is skipped rather than failing the whole read.
 */
export async function readNudgeEvents(rootDir: string): Promise<NudgeEvent[]> {
  let content: string;
  try {
    content = await fs.readFile(nudgeEventsFilePath(rootDir), 'utf-8');
  } catch {
    return [];
  }

  const events: NudgeEvent[] = [];
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isValidNudgeEvent(parsed)) events.push(parsed);
    } catch {
      // Skip a torn/corrupted line rather than failing the whole read.
    }
  }
  return events;
}

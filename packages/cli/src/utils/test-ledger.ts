/**
 * Session-scoped, append-only JSONL ledger for FEATURE 2 (the did-you-run-
 * the-tests verification nudge). Two independent hooks append to the same
 * per-session file — the post-edit hook records which edited files have
 * associated tests, the post-Bash hook records which commands looked like
 * test runs — and the Stop hook reads it back to decide whether to nudge.
 * Append-only avoids a read-modify-write race between those two hooks, which
 * fire independently and may interleave.
 *
 * One file per session: `<indexDir>/test-sessions/<sessionId>.jsonl`, sibling
 * to `delta-events.jsonl`/`blast-events.jsonl` under the same per-repo index
 * directory (`getIndexDir(rootDir)`). Unlike those two logs, this one is
 * cleared at the end of its session (see `annotate-end.sh`/`annotate-clean.sh`)
 * rather than accumulated indefinitely — there is no cross-session history to
 * report on.
 *
 * Kill switch: `LIEN_TEST_VERIFY=off` disables edit/run recording only; the
 * recap's loop-prevention `blocked` marker (`recordBlocked`) is exempt from it
 * and governed by `LIEN_RECAP` instead — the single switch every caller gates
 * on (both `recap-cmd.ts` and the legacy `verify-tests report`; see
 * `recapEnabled`). Reading (`readSession`) is never gated by either, so a report
 * requested after the switch was flipped mid-session still sees whatever was
 * recorded before.
 */

import fs from 'fs/promises';
import path from 'path';
import { getIndexDir } from '@liendev/parser';

export const TEST_SESSIONS_DIRNAME = 'test-sessions';

export type TestLedgerEvent =
  | { kind: 'edit'; timestamp: string; file: string; tests: string[] }
  | { kind: 'run'; timestamp: string; command: string }
  | { kind: 'blocked'; timestamp: string };

// Defense-in-depth: sessionId is interpolated into a filesystem path (both
// here and in the shell hooks). Reject anything outside this set rather than
// trusting the caller — mirrors the shell hooks' own `case "$session_id" in
// *[!A-Za-z0-9_-]*)` guard.
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

/** `LIEN_TEST_VERIFY=off` disables edit/run recording only (recordBlocked is exempt — see its note). Reading is never gated by this. */
export function testVerifyEnabled(): boolean {
  return process.env.LIEN_TEST_VERIFY !== 'off';
}

/**
 * `LIEN_RECAP=off` disables the Stop recap surface entirely — the single switch
 * governing whether the loop-prevention `blocked` marker is written. Both the
 * recap hook path (`recap-cmd.ts`) and the legacy `verify-tests report`
 * (`verify-tests-cmd.ts`) gate their `recordBlocked` call on it, so the marker
 * obeys one consistent rule everywhere. Reading is never gated by this.
 */
export function recapEnabled(): boolean {
  return process.env.LIEN_RECAP !== 'off';
}

function testSessionsDir(rootDir: string): string {
  return path.join(getIndexDir(rootDir), TEST_SESSIONS_DIRNAME);
}

/** Absolute path to a session's ledger file, or null when `sessionId` fails validation (caller no-ops). */
export function testSessionFilePath(rootDir: string, sessionId: string): string | null {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  return path.join(testSessionsDir(rootDir), `${sessionId}.jsonl`);
}

/** Raw append — mkdir + append one JSONL line, best-effort. NOT gated by any kill switch. */
async function writeEvent(
  rootDir: string,
  sessionId: string,
  event: TestLedgerEvent,
): Promise<void> {
  const filePath = testSessionFilePath(rootDir, sessionId);
  if (!filePath) return;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
  } catch {
    // Best-effort: recording must never break the hook that triggered it.
  }
}

/** Append a test-verify recording event (edit/run) — gated by `LIEN_TEST_VERIFY=off`. */
async function appendEvent(
  rootDir: string,
  sessionId: string,
  event: TestLedgerEvent,
): Promise<void> {
  if (!testVerifyEnabled()) return;
  await writeEvent(rootDir, sessionId, event);
}

/** Record that `file` was edited and has associated `tests` (never called for a file with no associated tests — see verify-tests-cmd.ts). */
export async function recordEdit(
  rootDir: string,
  sessionId: string,
  file: string,
  tests: string[],
): Promise<void> {
  await appendEvent(rootDir, sessionId, {
    kind: 'edit',
    timestamp: new Date().toISOString(),
    file,
    tests,
  });
}

/** Record that `command` looked like a test invocation (only ever called after `classifyTestCommand` confirms `isTestRun` — see verify-tests-cmd.ts). */
export async function recordRun(
  rootDir: string,
  sessionId: string,
  command: string,
): Promise<void> {
  await appendEvent(rootDir, sessionId, {
    kind: 'run',
    timestamp: new Date().toISOString(),
    command,
  });
}

/**
 * Record that the Stop hook just emitted a block for this session — the
 * belt-and-braces loop-prevention fallback alongside `stop_hook_active`
 * (see `verify-tests-cmd.ts`'s `wasRecentlyBlocked`/`runReport`, and the
 * dated deviation note in docs/architecture/test-verification-nudge.md:
 * `stop_hook_active`'s presence in the real Stop-hook stdin payload could
 * not be confirmed against current Claude Code docs during review, so this
 * ledger-based suppression window is the mechanism that actually holds if
 * that field turns out to be absent or unreliable).
 */
export async function recordBlocked(rootDir: string, sessionId: string): Promise<void> {
  // Deliberately NOT gated by `LIEN_TEST_VERIFY`: the `blocked` event is the
  // Stop-recap loop-prevention marker (see `wasRecentlyBlocked` and the recap
  // command in recap-cmd.ts). Its master switch is `LIEN_RECAP=off`, which every
  // caller gates on via `recapEnabled()` — the recap hook path (`recap-cmd.ts`)
  // and the legacy `verify-tests report` (`runReport` in verify-tests-cmd.ts)
  // both check it before calling this, so the marker obeys one consistent rule.
  // Being exempt from `LIEN_TEST_VERIFY` lets a delta/blast-only recap still
  // suppress its own re-nag on the next Stop.
  await writeEvent(rootDir, sessionId, { kind: 'blocked', timestamp: new Date().toISOString() });
}

function isValidTestLedgerEvent(value: unknown): value is TestLedgerEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.timestamp !== 'string') return false;
  if (v.kind === 'edit') {
    return (
      typeof v.file === 'string' &&
      Array.isArray(v.tests) &&
      v.tests.every(t => typeof t === 'string')
    );
  }
  if (v.kind === 'run') return typeof v.command === 'string';
  if (v.kind === 'blocked') return true;
  return false;
}

/**
 * Read every event recorded for this session, oldest first. An invalid
 * `sessionId`, a session with no ledger yet, or a read failure all yield an
 * empty array — never thrown, since the Stop hook must never trap the agent
 * on a read error. A malformed line (torn write from a crash mid-append) is
 * skipped rather than failing the whole read.
 */
export async function readSession(rootDir: string, sessionId: string): Promise<TestLedgerEvent[]> {
  const filePath = testSessionFilePath(rootDir, sessionId);
  if (!filePath) return [];

  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return [];
  }

  const events: TestLedgerEvent[] = [];
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isValidTestLedgerEvent(parsed)) events.push(parsed);
    } catch {
      // Skip a torn/corrupted line rather than failing the whole read.
    }
  }
  return events;
}

/**
 * Remove a session's ledger file. Best-effort — a failure here must never
 * surface, since this runs from SessionEnd (see `annotate-end.sh`), which
 * owns cleanup but not correctness of the session that just ended.
 */
export async function clearSession(rootDir: string, sessionId: string): Promise<void> {
  const filePath = testSessionFilePath(rootDir, sessionId);
  if (!filePath) return;
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // Best-effort.
  }
}

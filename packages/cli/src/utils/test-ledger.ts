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
 * Kill switch: `LIEN_TEST_VERIFY=off` disables recording only; reading
 * (`readSession`) is never gated by it, so a report requested after the
 * switch was flipped mid-session still sees whatever was recorded before.
 */

import fs from 'fs/promises';
import path from 'path';
import { getIndexDir } from '@liendev/parser';

export const TEST_SESSIONS_DIRNAME = 'test-sessions';

export type TestLedgerEvent =
  | { kind: 'edit'; timestamp: string; file: string; tests: string[] }
  | { kind: 'run'; timestamp: string; command: string };

// Defense-in-depth: sessionId is interpolated into a filesystem path (both
// here and in the shell hooks). Reject anything outside this set rather than
// trusting the caller — mirrors the shell hooks' own `case "$session_id" in
// *[!A-Za-z0-9_-]*)` guard.
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

/** `LIEN_TEST_VERIFY=off` disables recording only. Reading is never gated by this. */
export function testVerifyEnabled(): boolean {
  return process.env.LIEN_TEST_VERIFY !== 'off';
}

function testSessionsDir(rootDir: string): string {
  return path.join(getIndexDir(rootDir), TEST_SESSIONS_DIRNAME);
}

/** Absolute path to a session's ledger file, or null when `sessionId` fails validation (caller no-ops). */
export function testSessionFilePath(rootDir: string, sessionId: string): string | null {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  return path.join(testSessionsDir(rootDir), `${sessionId}.jsonl`);
}

async function appendEvent(
  rootDir: string,
  sessionId: string,
  event: TestLedgerEvent,
): Promise<void> {
  if (!testVerifyEnabled()) return;
  const filePath = testSessionFilePath(rootDir, sessionId);
  if (!filePath) return;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
  } catch {
    // Best-effort: recording must never break the hook that triggered it.
  }
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

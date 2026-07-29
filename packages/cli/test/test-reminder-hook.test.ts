/**
 * Unit tests for the PostToolUse edit hook `plugins/claude/hooks/test-reminder.sh`.
 *
 * `lien` is stubbed on PATH with a shim answering `path --store` (from a
 * per-test store directory this suite controls, so the "repo is indexed"
 * gate — `structural.db` present/absent — is real) and `verify-tests
 * note-edit` with a canned reminder line (or empty, simulating a file with
 * no associated tests). The shim also appends to a call-log file every time
 * `note-edit` is actually invoked, so tests can assert on *spawn count*, not
 * just stdout — the whole point of the regression this suite guards against.
 *
 * Regression coverage: before the fix, the per-session/per-file TTL
 * touchfile was only written when the reminder text was non-empty, so a
 * file with no associated tests re-spawned `verify-tests note-edit` on
 * every single edit for the rest of the session — the TTL gate never
 * engaged. The fix writes the touchfile unconditionally (after the call
 * runs once), so a repeat edit within the TTL window is suppressed either
 * way. See plugins/claude/hooks/test-reminder.sh's inline comments.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const HOOK = fileURLToPath(
  new URL('../../../plugins/claude/hooks/test-reminder.sh', import.meta.url),
);

let shimDir: string;
let hookPath: string; // PATH with the lien shim prepended (real jq stays resolvable)

beforeEach(() => {
  shimDir = mkdtempSync(path.join(os.tmpdir(), 'lien-test-reminder-hook-'));
  // `lien` shim: `path --store` answers from $STORE_DIR (env, set per call);
  // `verify-tests note-edit` logs a call to $CALL_LOG and prints $REMINDER_TEXT.
  const shim = path.join(shimDir, 'lien');
  writeFileSync(
    shim,
    [
      '#!/usr/bin/env bash',
      'if [ "$1" = "path" ] && [ "$2" = "--store" ]; then',
      '  printf \'%s\' "$STORE_DIR"',
      '  exit 0',
      'fi',
      'if [ "$1" = "verify-tests" ] && [ "$2" = "note-edit" ]; then',
      '  echo call >> "$CALL_LOG"',
      '  printf \'%s\' "$REMINDER_TEXT"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    'utf-8',
  );
  chmodSync(shim, 0o755);
  hookPath = `${shimDir}${path.delimiter}${process.env.PATH ?? ''}`;
});

afterEach(() => {
  rmSync(shimDir, { recursive: true, force: true });
});

/** Fresh, indexed store dir (real `structural.db` so the hook's index gate passes) + a call-log file. */
function freshStore(): { storeDir: string; callLog: string } {
  const storeDir = mkdtempSync(path.join(os.tmpdir(), 'lien-test-reminder-store-'));
  writeFileSync(path.join(storeDir, 'structural.db'), '', 'utf-8');
  const callLog = path.join(storeDir, 'call.log');
  return { storeDir, callLog };
}

function callCount(callLog: string): number {
  try {
    return readFileSync(callLog, 'utf-8')
      .split('\n')
      .filter(l => l.length > 0).length;
  } catch {
    return 0;
  }
}

function runHook(
  payload: Record<string, unknown>,
  opts: {
    storeDir: string;
    callLog: string;
    reminderText?: string;
    extraEnv?: Record<string, string>;
  },
): { stdout: string; status: number | null } {
  const res = spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: hookPath,
      STORE_DIR: opts.storeDir,
      CALL_LOG: opts.callLog,
      REMINDER_TEXT: opts.reminderText ?? '',
      ...opts.extraEnv,
    },
  });
  return { stdout: res.stdout.trim(), status: res.status };
}

function additionalContext(stdout: string): string {
  if (stdout === '') {
    throw new Error('hook produced no stdout — expected an additionalContext JSON envelope');
  }
  const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: unknown } };
  const ctx = parsed.hookSpecificOutput?.additionalContext;
  if (typeof ctx !== 'string') {
    throw new Error(`hook JSON has no string additionalContext: ${stdout}`);
  }
  return ctx;
}

const editPayload = (filePath: string, sessionId: string, cwd: string, tool = 'Edit') => ({
  session_id: sessionId,
  tool_name: tool,
  cwd,
  tool_input: { file_path: filePath },
});

describe('test-reminder.sh — has associated tests', () => {
  it('emits the reminder on the first edit and writes a session touchfile', () => {
    const { storeDir, callLog } = freshStore();
    const { stdout, status } = runHook(editPayload('a.ts', 's1', shimDir), {
      storeDir,
      callLog,
      reminderText: 'Tests to run: a.test.ts',
    });
    expect(status).toBe(0);
    expect(additionalContext(stdout)).toBe('Tests to run: a.test.ts');
    expect(callCount(callLog)).toBe(1);
    const sessionDir = path.join(storeDir, 'annotated-sessions', 's1');
    expect(readdirSync(sessionDir).length).toBeGreaterThan(0);
  });

  it('suppresses a repeat edit to the same file within the TTL window (no second spawn)', () => {
    const { storeDir, callLog } = freshStore();
    const first = runHook(editPayload('a.ts', 's1', shimDir), {
      storeDir,
      callLog,
      reminderText: 'Tests to run: a.test.ts',
    });
    expect(additionalContext(first.stdout)).toBe('Tests to run: a.test.ts');

    const second = runHook(editPayload('a.ts', 's1', shimDir), {
      storeDir,
      callLog,
      reminderText: 'Tests to run: a.test.ts',
    });
    expect(second.stdout).toBe('');
    expect(second.status).toBe(0);
    // The money assertion: note-edit was spawned once, not twice.
    expect(callCount(callLog)).toBe(1);
  });
});

describe('test-reminder.sh — no associated tests (regression: the inverted-touchfile bug)', () => {
  it('stays silent on the first edit but still spawns note-edit once, and marks the touchfile', () => {
    const { storeDir, callLog } = freshStore();
    const { stdout, status } = runHook(editPayload('a.ts', 's1', shimDir), {
      storeDir,
      callLog,
      reminderText: '',
    });
    expect(stdout).toBe('');
    expect(status).toBe(0);
    expect(callCount(callLog)).toBe(1);
    const sessionDir = path.join(storeDir, 'annotated-sessions', 's1');
    expect(readdirSync(sessionDir).length).toBeGreaterThan(0);
  });

  it('suppresses the second spawn on a repeat edit within the TTL window (the fix)', () => {
    const { storeDir, callLog } = freshStore();
    const first = runHook(editPayload('a.ts', 's1', shimDir), {
      storeDir,
      callLog,
      reminderText: '',
    });
    expect(first.stdout).toBe('');
    expect(callCount(callLog)).toBe(1);

    const second = runHook(editPayload('a.ts', 's1', shimDir), {
      storeDir,
      callLog,
      reminderText: '',
    });
    expect(second.stdout).toBe('');
    expect(second.status).toBe(0);
    // Before the fix: this would be 2 (the touchfile was never written, so
    // the TTL gate never engaged and note-edit ran again).
    expect(callCount(callLog)).toBe(1);

    const third = runHook(editPayload('a.ts', 's1', shimDir), {
      storeDir,
      callLog,
      reminderText: '',
    });
    expect(third.stdout).toBe('');
    expect(callCount(callLog)).toBe(1);
  });

  it('still spawns note-edit for a different file in the same session (per-file suppression)', () => {
    const { storeDir, callLog } = freshStore();
    runHook(editPayload('a.ts', 's1', shimDir), { storeDir, callLog, reminderText: '' });
    expect(callCount(callLog)).toBe(1);

    runHook(editPayload('b.ts', 's1', shimDir), { storeDir, callLog, reminderText: '' });
    expect(callCount(callLog)).toBe(2);
  });
});

describe('test-reminder.sh — stays silent / no spawn (exit 0)', () => {
  it('when the tool is not an edit (e.g. Bash) — never invokes lien at all', () => {
    const { storeDir, callLog } = freshStore();
    const { stdout, status } = runHook(
      { tool_name: 'Bash', cwd: shimDir, session_id: 's1', tool_input: { command: 'ls' } },
      { storeDir, callLog, reminderText: 'should never be shown' },
    );
    expect(stdout).toBe('');
    expect(status).toBe(0);
    expect(callCount(callLog)).toBe(0);
  });

  it('when file_path is missing from the payload', () => {
    const { storeDir, callLog } = freshStore();
    const { stdout } = runHook(
      { tool_name: 'Edit', cwd: shimDir, session_id: 's1', tool_input: {} },
      { storeDir, callLog, reminderText: 'x' },
    );
    expect(stdout).toBe('');
    expect(callCount(callLog)).toBe(0);
  });

  it('when session_id is missing from the payload', () => {
    const { storeDir, callLog } = freshStore();
    const { stdout } = runHook(
      { tool_name: 'Edit', cwd: shimDir, tool_input: { file_path: 'a.ts' } },
      { storeDir, callLog, reminderText: 'x' },
    );
    expect(stdout).toBe('');
    expect(callCount(callLog)).toBe(0);
  });

  it('when session_id contains invalid characters (path-traversal defense)', () => {
    const { storeDir, callLog } = freshStore();
    const { stdout } = runHook(editPayload('a.ts', '../../etc', shimDir), {
      storeDir,
      callLog,
      reminderText: 'x',
    });
    expect(stdout).toBe('');
    expect(callCount(callLog)).toBe(0);
  });

  it('when the kill switch LIEN_TEST_REMINDER=off is set, even with associated tests', () => {
    const { storeDir, callLog } = freshStore();
    const { stdout } = runHook(editPayload('a.ts', 's1', shimDir), {
      storeDir,
      callLog,
      reminderText: 'Tests to run: a.test.ts',
      extraEnv: { LIEN_TEST_REMINDER: 'off' },
    });
    expect(stdout).toBe('');
    expect(callCount(callLog)).toBe(0);
  });

  it('when the repo has no index (no structural.db) — never spawns note-edit', () => {
    const unindexedStore = mkdtempSync(path.join(os.tmpdir(), 'lien-test-reminder-unindexed-'));
    const callLog = path.join(unindexedStore, 'call.log');
    const { stdout, status } = runHook(editPayload('a.ts', 's1', shimDir), {
      storeDir: unindexedStore,
      callLog,
      reminderText: 'x',
    });
    expect(stdout).toBe('');
    expect(status).toBe(0);
    expect(callCount(callLog)).toBe(0);
    rmSync(unindexedStore, { recursive: true, force: true });
  });

  it('accepts MultiEdit and Write as edit tools', () => {
    const { storeDir, callLog } = freshStore();
    const write = runHook(editPayload('a.ts', 's1', shimDir, 'Write'), {
      storeDir,
      callLog,
      reminderText: 'Tests to run: a.test.ts',
    });
    expect(additionalContext(write.stdout)).toBe('Tests to run: a.test.ts');

    const { storeDir: storeDir2, callLog: callLog2 } = freshStore();
    const multiEdit = runHook(editPayload('a.ts', 's1', shimDir, 'MultiEdit'), {
      storeDir: storeDir2,
      callLog: callLog2,
      reminderText: 'Tests to run: a.test.ts',
    });
    expect(additionalContext(multiEdit.stdout)).toBe('Tests to run: a.test.ts');
  });
});

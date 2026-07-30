/**
 * Verifies that the four nudge-recording hook scripts thread `--hooks-dir`
 * through to `lien nudge note-shown` / `note-signal` / `recap` (issue #916,
 * part 1) — the argument `nudge-build.ts` hashes into each event's build
 * stamp. `lien` is stubbed on PATH with a shim that answers each hook's
 * prerequisite calls and logs every invocation's full argv, so these tests
 * assert on the ACTUAL arguments a real hook script passes, not a
 * hand-transcribed guess.
 *
 * `LIEN_HOOKS_DIR` (set by `lien-resolve.sh`, sourced by every hook here) is
 * asserted to resolve to the REAL `plugins/claude/hooks` directory these
 * scripts live in — the exact thing a live `lien nudge doctor` check reads.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const HOOKS_DIR = fileURLToPath(new URL('../../../plugins/claude/hooks', import.meta.url));
const HOOK = (name: string) => path.join(HOOKS_DIR, name);

let shimDir: string;
let hookPath: string;
let callLog: string;

beforeEach(() => {
  shimDir = mkdtempSync(path.join(os.tmpdir(), 'lien-nudge-hooksdir-'));
  callLog = path.join(shimDir, 'call.log');
  const shim = path.join(shimDir, 'lien');
  writeFileSync(
    shim,
    [
      '#!/usr/bin/env bash',
      'printf \'%s\\n\' "$*" >> "' + callLog + '"',
      'if [ "$1" = "path" ] && [ "$2" = "--store" ]; then printf \'%s\' "$STORE_DIR"; exit 0; fi',
      'if [ "$1" = "path" ] && [ "$2" = "--extensions" ]; then printf \'ts\\n\'; exit 0; fi',
      'if [ "$1" = "annotate" ]; then printf \'impact: 3 dependents\'; exit 0; fi',
      'if [ "$1" = "api-delta" ]; then cat "' +
        shimDir +
        '/api-delta.json" 2>/dev/null; exit 0; fi',
      'if [ "$1" = "recap" ]; then printf \'%s\' "$RECAP_TEXT"; exit 0; fi',
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

function calls(): string[] {
  try {
    return readFileSync(callLog, 'utf-8')
      .split('\n')
      .filter(l => l.length > 0);
  } catch {
    return [];
  }
}

function runHook(
  hookFile: string,
  payload: Record<string, unknown>,
  extraEnv: Record<string, string> = {},
): { stdout: string; status: number | null } {
  // Nested under shimDir (not a fresh top-level os.tmpdir() entry) so the
  // existing afterEach's `rmSync(shimDir, ...)` cleans this up too, instead
  // of leaking one store dir per call.
  const storeDir = mkdtempSync(path.join(shimDir, 'store-'));
  writeFileSync(path.join(storeDir, 'structural.db'), '', 'utf-8');
  const res = spawnSync('bash', [hookFile], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    env: { ...process.env, PATH: hookPath, STORE_DIR: storeDir, ...extraEnv },
  });
  return { stdout: (res.stdout ?? '').trim(), status: res.status };
}

describe('nudge-signal.sh threads --hooks-dir to note-signal', () => {
  it('passes the real hooks directory', () => {
    const { status } = runHook(HOOK('nudge-signal.sh'), {
      session_id: 's1',
      tool_name: 'mcp__plugin_lien_lien__get_dependents',
      cwd: shimDir,
      tool_input: { filepath: 'a.ts', symbol: 'foo' },
    });
    expect(status).toBe(0);
    const noteSignalCall = calls().find(c => c.includes('nudge note-signal'));
    expect(noteSignalCall).toBeDefined();
    expect(noteSignalCall).toContain(`--hooks-dir ${HOOKS_DIR}`);
  });
});

describe('annotate-read.sh threads --hooks-dir to note-shown', () => {
  it('passes the real hooks directory when an annotation is emitted', () => {
    const { status } = runHook(HOOK('annotate-read.sh'), {
      session_id: 's2',
      tool_name: 'Read',
      cwd: shimDir,
      tool_input: { file_path: path.join(shimDir, 'a.ts') },
    });
    expect(status).toBe(0);
    const noteShownCall = calls().find(c => c.includes('nudge note-shown'));
    expect(noteShownCall).toBeDefined();
    expect(noteShownCall).toContain(`--hooks-dir ${HOOKS_DIR}`);
  });
});

describe('api-delta-write.sh threads --hooks-dir to note-shown', () => {
  it('passes the real hooks directory when a blast-radius warning fires', () => {
    writeFileSync(
      path.join(shimDir, 'api-delta.json'),
      JSON.stringify({
        changes: [
          {
            symbol: 'foo',
            kind: 'signature-changed',
            enriched: true,
            dependentCount: 2,
            untestedDependentCount: 0,
            riskLevel: 'low',
          },
        ],
      }),
      'utf-8',
    );
    const { status } = runHook(HOOK('api-delta-write.sh'), {
      session_id: 's3',
      tool_name: 'Edit',
      cwd: shimDir,
      tool_input: { file_path: path.join(shimDir, 'a.ts') },
    });
    expect(status).toBe(0);
    const noteShownCall = calls().find(c => c.includes('nudge note-shown'));
    expect(noteShownCall).toBeDefined();
    expect(noteShownCall).toContain(`--hooks-dir ${HOOKS_DIR}`);
  });
});

describe('recap-stop.sh threads --hooks-dir to recap', () => {
  it('passes the real hooks directory', () => {
    const { status } = runHook(
      HOOK('recap-stop.sh'),
      { session_id: 's4', cwd: shimDir, stop_hook_active: false },
      { RECAP_TEXT: 'Tests to run: a.test.ts' },
    );
    expect(status).toBe(0);
    const recapCall = calls().find(c => c.startsWith('recap '));
    expect(recapCall).toBeDefined();
    expect(recapCall).toContain(`--hooks-dir ${HOOKS_DIR}`);
  });
});

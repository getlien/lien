/**
 * Unit tests for the PostToolUse edit hook `plugins/claude/hooks/delta-write.sh`.
 *
 * The hook's own logic — payload parsing, tool-name matching, the jq transform
 * of the delta JSON into a one-line warning, and the silence conditions — is
 * tested in isolation by stubbing `lien` on PATH with a shim that prints a
 * canned `lien delta --file … --format json` payload. Real `jq` is used. No git,
 * no real CLI: this exercises exactly the hook script, fed realistic
 * PostToolUse payloads synthesized from the Claude Code hook schema.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const HOOK = fileURLToPath(
  new URL('../../../plugins/claude/hooks/delta-write.sh', import.meta.url),
);

let shimDir: string;
let fakeJsonFile: string;
let hookPath: string; // PATH with the lien shim prepended (real jq stays resolvable)

beforeAll(() => {
  shimDir = mkdtempSync(path.join(os.tmpdir(), 'lien-hook-shim-'));
  fakeJsonFile = path.join(shimDir, 'delta.json');
  // `lien` shim: ignore all args, print the canned delta JSON. Empty file → the
  // shim prints nothing, mimicking an operational failure / no output.
  const shim = path.join(shimDir, 'lien');
  writeFileSync(shim, `#!/usr/bin/env bash\ncat "${fakeJsonFile}" 2>/dev/null\n`, 'utf-8');
  chmodSync(shim, 0o755);
  hookPath = `${shimDir}${path.delimiter}${process.env.PATH ?? ''}`;
});

afterAll(() => {
  rmSync(shimDir, { recursive: true, force: true });
});

/** A regression function entry as the primitive emits it in JSON. */
function regression(
  symbolName: string,
  metricType: string,
  before: number | null,
  after: number,
  threshold: number,
  parentClass = '',
) {
  const verdict = before === null ? 'new-over-threshold' : 'crossed';
  return {
    key: `${parentClass}::${symbolName}`,
    symbolName,
    parentClass,
    filepath: 'a.ts',
    language: 'typescript',
    startLine: 1,
    verdict,
    isRegression: true,
    metrics: [{ metricType, before, after, threshold, verdict }],
  };
}

/** Build a canned `lien delta --format json` result with the given regressions. */
function deltaJson(regressions: ReturnType<typeof regression>[]): string {
  return JSON.stringify({
    files: [],
    regressions,
    summary: {
      filesChanged: 1,
      functionsAnalyzed: regressions.length,
      regressions: regressions.length,
      crossed: regressions.length,
      newOverThreshold: 0,
      worsened: 0,
      improved: 0,
    },
    thresholds: { testPaths: 15, mentalLoad: 15, timeToUnderstandMinutes: 60, estimatedBugs: 1.5 },
    elapsedMs: 5,
  });
}

/** Run the hook with a payload + canned JSON, returning trimmed stdout. */
function runHook(
  payload: Record<string, unknown>,
  cannedJson: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; status: number | null } {
  writeFileSync(fakeJsonFile, cannedJson, 'utf-8');
  const res = spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    env: { ...process.env, PATH: hookPath, ...extraEnv },
  });
  return { stdout: res.stdout.trim(), status: res.status };
}

/** Extract the additionalContext string from the hook's JSON stdout. */
function additionalContext(stdout: string): string {
  expect(stdout, 'hook should emit JSON').not.toBe('');
  const parsed = JSON.parse(stdout);
  return parsed.hookSpecificOutput.additionalContext as string;
}

const editPayload = (filePath: string, tool = 'Edit') => ({
  session_id: 's1',
  tool_name: tool,
  cwd: shimDir,
  tool_input: { file_path: filePath },
});

describe('delta-write.sh — emits additionalContext only on a crossing', () => {
  it('renders a crossed function as "name metric before→after (threshold N)"', () => {
    const { stdout, status } = runHook(
      editPayload('a.ts'),
      deltaJson([regression('extractSymbols', 'cognitive', 12, 29, 15)]),
    );
    expect(status).toBe(0);
    const ctx = additionalContext(stdout);
    expect(ctx).toContain('lien delta:');
    expect(ctx).toContain('extractSymbols cognitive 12→29 (threshold 15)');
    expect(ctx).toContain('consider simplifying before you commit');
  });

  it('renders a newly-added over-threshold function with "new" as the before value', () => {
    const { stdout } = runHook(
      editPayload('a.ts', 'Write'),
      deltaJson([regression('freshFn', 'cyclomatic', null, 20, 15)]),
    );
    expect(additionalContext(stdout)).toContain('freshFn cyclomatic new→20 (threshold 15)');
  });

  it('qualifies a method with its parent class', () => {
    const { stdout } = runHook(
      editPayload('a.ts'),
      deltaJson([regression('doThing', 'cognitive', 10, 18, 15, 'MyService')]),
    );
    expect(additionalContext(stdout)).toContain('MyService.doThing cognitive 10→18');
  });

  it('lists up to 3 functions and notes overflow with "(+N more)"', () => {
    const { stdout } = runHook(
      editPayload('a.ts'),
      deltaJson([
        regression('f1', 'cognitive', 10, 20, 15),
        regression('f2', 'cognitive', 10, 21, 15),
        regression('f3', 'cognitive', 10, 22, 15),
        regression('f4', 'cognitive', 10, 23, 15),
        regression('f5', 'cognitive', 10, 24, 15),
      ]),
    );
    const ctx = additionalContext(stdout);
    expect(ctx).toContain('f1 cognitive');
    expect(ctx).toContain('f3 cognitive');
    expect(ctx).not.toContain('f4 cognitive'); // capped at 3
    expect(ctx).toContain('(+2 more)');
  });

  it('produces valid JSON with a well-formed hookSpecificOutput envelope', () => {
    const { stdout } = runHook(
      editPayload('a.ts'),
      deltaJson([regression('extractSymbols', 'cognitive', 12, 29, 15)]),
    );
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(typeof parsed.hookSpecificOutput.additionalContext).toBe('string');
  });
});

describe('delta-write.sh — stays silent (exit 0, no stdout)', () => {
  it('when there are no regressions (advisory-only or clean change)', () => {
    const { stdout, status } = runHook(editPayload('a.ts'), deltaJson([]));
    expect(stdout).toBe('');
    expect(status).toBe(0);
  });

  it('when the tool is not an edit (e.g. Bash)', () => {
    const { stdout, status } = runHook(
      { tool_name: 'Bash', cwd: shimDir, tool_input: { command: 'ls' } },
      deltaJson([regression('x', 'cognitive', 12, 29, 15)]),
    );
    expect(stdout).toBe('');
    expect(status).toBe(0);
  });

  it('when file_path is missing from the payload', () => {
    const { stdout } = runHook(
      { tool_name: 'Edit', cwd: shimDir, tool_input: {} },
      deltaJson([regression('x', 'cognitive', 12, 29, 15)]),
    );
    expect(stdout).toBe('');
  });

  it('when the kill switch LIEN_DELTA_HOOK=off is set, even on a crossing', () => {
    const { stdout } = runHook(
      editPayload('a.ts'),
      deltaJson([regression('x', 'cognitive', 12, 29, 15)]),
      { LIEN_DELTA_HOOK: 'off' },
    );
    expect(stdout).toBe('');
  });

  it('when the CLI produces no output (empty stdout, e.g. exit 2)', () => {
    const { stdout, status } = runHook(editPayload('a.ts'), '');
    expect(stdout).toBe('');
    expect(status).toBe(0);
  });

  it('when the CLI emits malformed JSON', () => {
    const { stdout, status } = runHook(editPayload('a.ts'), 'not json at all');
    expect(stdout).toBe('');
    expect(status).toBe(0);
  });

  it('accepts MultiEdit as an edit tool (emits on a crossing)', () => {
    const { stdout } = runHook(
      editPayload('a.ts', 'MultiEdit'),
      deltaJson([regression('extractSymbols', 'cognitive', 12, 29, 15)]),
    );
    expect(additionalContext(stdout)).toContain('extractSymbols cognitive 12→29');
  });
});

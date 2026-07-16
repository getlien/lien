/**
 * Unit tests for the PreToolUse subagent-launch hook
 * `plugins/claude/hooks/augment-explore-task.sh`.
 *
 * This hook's matcher (`hooks.json`: `"Agent|Task"`) and the script's own
 * `tool_name` case statement are exactly the silent-failure class this suite
 * guards against: Claude Code renamed its subagent-spawn tool from `Task` to
 * `Agent` (see docs/architecture/claude-code-hook-channels.md — "The
 * Agent-vs-Task matcher gotcha"). A matcher naming only the old tool would
 * make the injection silently stop firing on any current Claude Code
 * version — no error, no warning, nothing short of a live dogfood session
 * to catch it. `delta-write.sh` already has this kind of coverage
 * (`delta-write-hook.test.ts`); this hook didn't, despite being the one
 * that already lived through exactly this rename once (PR #571). Exercise
 * both tool names so a future rename regression fails CI instead of
 * shipping silent.
 *
 * `lien` is stubbed on PATH with a shim that answers `path --store` with a
 * directory this suite controls, so the "repo is indexed" gate
 * (`structural.db` present/absent) can be flipped per test. Real `jq` is used.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const HOOK = fileURLToPath(
  new URL('../../../plugins/claude/hooks/augment-explore-task.sh', import.meta.url),
);

let shimDir: string;
let storeDir: string;
let hookPath: string; // PATH with the lien shim prepended (real jq stays resolvable)

beforeAll(() => {
  shimDir = mkdtempSync(path.join(os.tmpdir(), 'lien-explore-hook-shim-'));
  storeDir = path.join(shimDir, 'store');
  mkdirSync(storeDir, { recursive: true });
  // `lien` shim: ignore all args (`path --store`), print the fixed store dir.
  const shim = path.join(shimDir, 'lien');
  writeFileSync(shim, `#!/usr/bin/env bash\necho "${storeDir}"\n`, 'utf-8');
  chmodSync(shim, 0o755);
  hookPath = `${shimDir}${path.delimiter}${process.env.PATH ?? ''}`;
});

afterAll(() => {
  rmSync(shimDir, { recursive: true, force: true });
});

const structuralDb = () => path.join(storeDir, 'structural.db');

beforeEach(() => {
  // Default: repo looks indexed, so the injection gate is open.
  writeFileSync(structuralDb(), '', 'utf-8');
});

afterEach(() => {
  if (existsSync(structuralDb())) rmSync(structuralDb());
});

/** Run the hook with a synthesized PreToolUse payload, returning trimmed stdout. */
function runHook(
  payload: Record<string, unknown>,
  extraEnv: Record<string, string> = {},
): { stdout: string; status: number | null } {
  const res = spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    env: { ...process.env, PATH: hookPath, ...extraEnv },
  });
  return { stdout: res.stdout.trim(), status: res.status };
}

const explorePayload = (
  toolName: string,
  subagentType = 'Explore',
  prompt = 'Find the auth flow',
) => ({
  session_id: 's1',
  tool_name: toolName,
  cwd: shimDir,
  tool_input: { subagent_type: subagentType, description: 'explore', prompt },
});

/**
 * Extract `updatedInput.prompt` from the hook's JSON stdout, failing with a
 * readable message (rather than a bare JSON.parse stack) when the hook
 * unexpectedly printed nothing or printed non-JSON.
 */
function updatedPrompt(stdout: string): string {
  if (stdout === '') {
    throw new Error('hook produced no stdout — expected an updatedInput envelope');
  }
  let parsed: { hookSpecificOutput?: { updatedInput?: { prompt?: unknown } } };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`hook stdout is not valid JSON: ${stdout}`);
  }
  const prompt = parsed.hookSpecificOutput?.updatedInput?.prompt;
  if (typeof prompt !== 'string') {
    throw new Error(`hook JSON has no string updatedInput.prompt: ${stdout}`);
  }
  return prompt;
}

describe('augment-explore-task.sh — fires on both current and legacy subagent-launch tool names', () => {
  it.each(['Agent', 'Task'])(
    'injects the Lien mandate when tool_name is %s and subagent_type is Explore',
    toolName => {
      const { stdout, status } = runHook(explorePayload(toolName));
      expect(status).toBe(0);
      const prompt = updatedPrompt(stdout);
      expect(prompt).toContain('Find the auth flow');
      expect(prompt).toContain('mcp__plugin_lien_lien__search_code');
      expect(prompt).toContain('REQUIRED');
    },
  );

  it.each(['lien:Explore', 'project:Explore'])(
    'also injects for the namespaced Explore variant %s',
    subagentType => {
      const { stdout } = runHook(explorePayload('Agent', subagentType));
      expect(updatedPrompt(stdout)).toContain('mcp__plugin_lien_lien__search_code');
    },
  );

  it('echoes back every original tool_input field, mutating only prompt', () => {
    const { stdout } = runHook({
      session_id: 's1',
      tool_name: 'Agent',
      cwd: shimDir,
      tool_input: {
        subagent_type: 'Explore',
        description: 'explore the auth module',
        prompt: 'Find the auth flow',
        custom_field: 'preserved',
      },
    });
    const parsed = JSON.parse(stdout);
    const updated = parsed.hookSpecificOutput.updatedInput;
    expect(updated.subagent_type).toBe('Explore');
    expect(updated.description).toBe('explore the auth module');
    expect(updated.custom_field).toBe('preserved');
    expect(updated.prompt).toContain('Find the auth flow');
  });
});

describe('augment-explore-task.sh — stays silent (exit 0, no stdout)', () => {
  it('when tool_name is neither Agent nor Task', () => {
    const { stdout, status } = runHook({
      tool_name: 'Bash',
      cwd: shimDir,
      tool_input: { command: 'ls' },
    });
    expect(stdout).toBe('');
    expect(status).toBe(0);
  });

  it('when subagent_type is not an Explore variant', () => {
    const { stdout } = runHook(explorePayload('Agent', 'general-purpose'));
    expect(stdout).toBe('');
  });

  it('when the prompt already references a Lien MCP tool (idempotent)', () => {
    const { stdout } = runHook(
      explorePayload('Agent', 'Explore', 'Use mcp__plugin_lien_lien__search_code to look this up'),
    );
    expect(stdout).toBe('');
  });

  it('when no Lien index exists for the repo (no structural.db)', () => {
    rmSync(structuralDb());
    const { stdout, status } = runHook(explorePayload('Agent'));
    expect(stdout).toBe('');
    expect(status).toBe(0);
  });

  it('when the kill switch LIEN_EXPLORE_INJECT=off is set', () => {
    const { stdout } = runHook(explorePayload('Agent'), { LIEN_EXPLORE_INJECT: 'off' });
    expect(stdout).toBe('');
  });

  it('when the prompt is empty', () => {
    const { stdout } = runHook(explorePayload('Agent', 'Explore', ''));
    expect(stdout).toBe('');
  });
});

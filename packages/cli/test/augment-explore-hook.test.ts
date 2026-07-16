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
 * `lien` is stubbed on PATH with a shim that answers `path --store`/`path
 * --root` with directories this suite controls (so the "repo is indexed"
 * gate — `structural.db` present/absent — can be flipped per test) and
 * `annotate <file>` with a canned first line keyed off the filename,
 * simulating the real CLI's complexity-headroom warning line
 * (`⚠ Lien: ... — avoid adding complexity here; prefer extraction.`,
 * `get-files-context.ts`'s `formatComplexityHeadroomWarning`, capped at 3
 * entries per #788) without needing a real index. Real `jq` is used.
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
let repoDir: string; // fixture "repo root" for the builder-nudge tests below
let hookPath: string; // PATH with the lien shim prepended (real jq stays resolvable)

beforeAll(() => {
  shimDir = mkdtempSync(path.join(os.tmpdir(), 'lien-explore-hook-shim-'));
  storeDir = path.join(shimDir, 'store');
  mkdirSync(storeDir, { recursive: true });

  // Fixture repo for the builder-nudge tests: real files on disk so the
  // hook's cheap existence pre-check (before it ever shells out to
  // `annotate`) has something real to find.
  repoDir = path.join(shimDir, 'repo');
  mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  writeFileSync(path.join(repoDir, 'src', 'near-budget.ts'), '// fixture\n', 'utf-8');
  writeFileSync(path.join(repoDir, 'src', 'clean.ts'), '// fixture\n', 'utf-8');
  writeFileSync(path.join(repoDir, 'src', 'cli-error-case.ts'), '// fixture\n', 'utf-8');

  // `lien` shim: `path --store`/`path --root` answer from fixed dirs above;
  // `annotate <file>` is keyed off a substring of the filename so each
  // fixture file drives a different branch without a real index.
  const shim = path.join(shimDir, 'lien');
  const shimScript = `#!/usr/bin/env bash
case "$1" in
  path)
    case "$2" in
      --root) echo "${repoDir}" ;;
      *) echo "${storeDir}" ;;
    esac
    ;;
  annotate)
    case "$2" in
      *near-budget*)
        echo "⚠ Lien: scanDiff cognitive 30/15 (over), helper cyclomatic 9/10 — avoid adding complexity here; prefer extraction."
        echo "Lien impact for $2:"
        echo "  • Test coverage: none."
        ;;
      *cli-error*)
        echo "simulated CLI failure" >&2
        exit 1
        ;;
      *clean*)
        echo "Lien impact for $2:"
        echo "  • Test coverage: some.test.ts."
        ;;
    esac
    ;;
esac
`;
  writeFileSync(shim, shimScript, 'utf-8');
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

/**
 * Builder-agent plan-time complexity nudge: the same hook, non-Explore
 * subagent_type branch. Payloads use `repoDir` (real fixture files on disk)
 * as `cwd`, so the hook's own existence pre-check resolves candidate paths
 * for real before ever shelling out to the `annotate` shim.
 */
const builderPayload = (prompt: string, subagentType = 'general-purpose') => ({
  session_id: 's2',
  tool_name: 'Agent',
  cwd: repoDir,
  tool_input: { subagent_type: subagentType, description: 'build', prompt },
});

describe('augment-explore-task.sh — builder-agent plan-time complexity nudge', () => {
  it('appends a compact nudge block when the prompt names a near-budget file', () => {
    const { stdout, status } = runHook(
      builderPayload('Please extend src/near-budget.ts to detect one more case.'),
    );
    expect(status).toBe(0);
    const prompt = updatedPrompt(stdout);
    expect(prompt).toContain('Please extend src/near-budget.ts to detect one more case.');
    expect(prompt).toContain(
      'Lien plan-time note: src/near-budget.ts has functions at/near complexity budget:',
    );
    expect(prompt).toContain('scanDiff cognitive 30/15 (over)');
    expect(prompt).toContain('Avoid adding complexity there; prefer extraction.');
    // Only the headroom marker line is surfaced — the rest of `annotate`'s
    // printed output (dependents/test-coverage bullets) is noise for this
    // nudge and must not leak in.
    expect(prompt).not.toContain('Test coverage: none');
  });

  it('stays silent when the named file has no complexity headroom hit', () => {
    const { stdout, status } = runHook(builderPayload('Please add a helper to src/clean.ts.'));
    expect(stdout).toBe('');
    expect(status).toBe(0);
  });

  it('stays silent when the named path does not exist on disk', () => {
    const { stdout } = runHook(builderPayload('Please fix src/does-not-exist.ts.'));
    expect(stdout).toBe('');
  });

  it('stays silent when the kill switch LIEN_SUBAGENT_NUDGE=off is set', () => {
    const { stdout } = runHook(builderPayload('Please extend src/near-budget.ts.'), {
      LIEN_SUBAGENT_NUDGE: 'off',
    });
    expect(stdout).toBe('');
  });

  it('fails open (stays silent) when the annotate CLI call errors', () => {
    const { stdout, status } = runHook(builderPayload('Please fix src/cli-error-case.ts quickly.'));
    expect(stdout).toBe('');
    expect(status).toBe(0);
  });

  it('does not double-inject when the prompt already carries the marker (idempotent)', () => {
    const { stdout } = runHook(
      builderPayload(
        'Please extend src/near-budget.ts. Lien plan-time note: src/near-budget.ts has functions at/near complexity budget: already noted.',
      ),
    );
    expect(stdout).toBe('');
  });

  it('echoes back every original tool_input field, mutating only prompt', () => {
    const { stdout } = runHook({
      session_id: 's2',
      tool_name: 'Agent',
      cwd: repoDir,
      tool_input: {
        subagent_type: 'general-purpose',
        description: 'build a feature',
        prompt: 'Please extend src/near-budget.ts to detect one more case.',
        custom_field: 'preserved',
      },
    });
    const updated = updatedPrompt(stdout);
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.updatedInput.subagent_type).toBe('general-purpose');
    expect(parsed.hookSpecificOutput.updatedInput.description).toBe('build a feature');
    expect(parsed.hookSpecificOutput.updatedInput.custom_field).toBe('preserved');
    expect(updated).toContain('Please extend src/near-budget.ts to detect one more case.');
    expect(updated).toContain('Lien plan-time note:');
  });
});

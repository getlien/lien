#!/usr/bin/env node
/**
 * Phase 3 trial runner: one fresh headless `claude` session on an ordinary task in
 * a cloned foreign repo, with Lien's plugin wired the way a real user has it.
 *
 *   node trial.mjs <repoKey> <taskId>        # e.g. trial.mjs hono T1
 *   node trial.mjs --list
 *
 * Differences from `scripts/experiments/nudge-ab-v2/run.mjs`, on purpose:
 *
 *  - That kit runs with `--strict-mcp-config` and an EMPTY mcp config, because it
 *    was isolating whether nudge TEXT changes behavior. This dogfood measures the
 *    real consumer configuration instead, so the Lien MCP server is ENABLED and
 *    pointed at the corpus repo. An agent with the plugin installed has both the
 *    tools and the hooks; testing one without the other is not the product.
 *  - Hook wiring is DERIVED from the shipped `plugins/claude/hooks/hooks.json` by
 *    substituting ${CLAUDE_PLUGIN_ROOT}, not transcribed. A transcription drifts
 *    from what ships; a substitution cannot.
 *
 * Both kits share the two non-negotiables: the ambient `lien@lien` plugin is
 * disabled for the spawned process only (so hooks cannot double-fire), and a `lien`
 * shim points at THIS build (otherwise the hooks' npx fallback would silently
 * measure the last published release instead of the working tree).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KIT = import.meta.dirname;
const REPO = path.resolve(KIT, '../../..');
const CLI = path.join(REPO, 'packages/cli/dist/index.js');
const PLUGIN_HOOKS = path.join(REPO, 'plugins/claude/hooks');
const HOOKS_JSON = path.join(PLUGIN_HOOKS, 'hooks.json');
const MANIFEST = path.join(KIT, 'corpus-manifest.json');
const TASKS = path.join(KIT, 'tasks.json');
const OUT = path.join(KIT, 'trials');

const PERMISSION_MODE = 'acceptEdits';
// Explicit, because a headless session otherwise inherits the caller's model: a
// throwaway "count the lines in this file" probe ran on claude-opus-5 and billed
// $0.37. Trials measure hook behavior, not model capability, so Sonnet is both
// cheaper and the honest default for what real users run.
const MODEL = process.env.LIEN_TRIAL_MODEL || 'sonnet';
const TIMEOUT_MS = 15 * 60 * 1000;
const ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Grep',
  'Glob',
  'Bash',
  'mcp__lien__search_code',
  'mcp__lien__get_files_context',
  'mcp__lien__get_dependents',
  'mcp__lien__list_functions',
  'mcp__lien__get_complexity',
  'mcp__lien__find_similar',
];

function die(m) {
  console.error(`trial: ${m}`);
  process.exit(1);
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

/** Real hook wiring, with ${CLAUDE_PLUGIN_ROOT} resolved to this checkout. */
function hooksBlock() {
  const raw = fs
    .readFileSync(HOOKS_JSON, 'utf8')
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', path.dirname(PLUGIN_HOOKS));
  return JSON.parse(raw).hooks;
}

/** A `lien` on PATH that IS this build — the hooks call the bare binary. */
function shimDir(tmp) {
  const dir = path.join(tmp, 'shim');
  fs.mkdirSync(dir, { recursive: true });
  const shim = path.join(dir, 'lien');
  fs.writeFileSync(shim, `#!/usr/bin/env bash\nexec node ${JSON.stringify(CLI)} "$@"\n`);
  fs.chmodSync(shim, 0o755);
  return dir;
}

/** C1: no CLAUDE.md/AGENTS.md on the clone or any ancestor. Re-asserted per trial. */
function assertC1(dir) {
  const names = ['CLAUDE.md', 'AGENTS.md'];
  let cur = path.resolve(dir);
  for (;;) {
    for (const n of names) {
      const p = path.join(cur, n);
      if (fs.existsSync(p)) die(`C1 VIOLATION: ${p} — this trial would be void`);
    }
    const parent = path.dirname(cur);
    if (parent === cur) return true;
    cur = parent;
  }
}

function gitReset(dir) {
  spawnSync('git', ['checkout', '--', '.'], { cwd: dir });
  spawnSync('git', ['clean', '-fdq'], { cwd: dir });
}

// ─── args ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(MANIFEST)) die(`no manifest at ${MANIFEST} — run provision.mjs first`);
if (!fs.existsSync(TASKS)) die(`no tasks at ${TASKS}`);
if (!fs.existsSync(CLI)) die(`CLI not built at ${CLI}`);

const manifest = readJson(MANIFEST);
const tasks = readJson(TASKS);
const [repoKey, taskId] = process.argv.slice(2);

if (repoKey === '--list') {
  for (const t of tasks.tasks) console.log(`${t.repoKey}\t${t.taskId}\t${t.nudgeUnderTest}`);
  process.exit(0);
}
if (!repoKey || !taskId) die('usage: trial.mjs <repoKey> <taskId> | --list');

const task = tasks.tasks.find(t => t.repoKey === repoKey && t.taskId === taskId);
if (!task) die(`no task ${repoKey}/${taskId} in tasks.json`);
const repo = manifest.repos.find(r => path.basename(r.dir) === repoKey);
if (!repo) die(`no repo ${repoKey} in manifest`);
if (repo.status !== 'OK') die(`repo ${repoKey} status is ${repo.status}`);

// C4: the prompt must not name the nudged concept. Asserted, not trusted.
const FORBIDDEN =
  /\b(caller|callers|dependent|dependents|test|tests|coverage|complexity|risk|lien|impact|blast)\b/i;
const hit = task.prompt.match(FORBIDDEN);
if (hit) die(`C4 VIOLATION: prompt mentions "${hit[0]}" — task-forced prompts guarantee a null`);

assertC1(repo.dir);

// ─── run ──────────────────────────────────────────────────────────────────────

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lien-trial-'));
const trialDir = path.join(OUT, `${repoKey}-${taskId}`);
fs.mkdirSync(trialDir, { recursive: true });

const settings = {
  enabledPlugins: { 'lien@lien': false }, // ambient plugin off; we wire hooks explicitly
  hooks: hooksBlock(),
};
const settingsFile = path.join(tmp, 'settings.json');
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

// Point the MCP server at THIS build, in the corpus repo.
const mcpFile = path.join(tmp, 'mcp.json');
fs.writeFileSync(
  mcpFile,
  JSON.stringify(
    { mcpServers: { lien: { command: 'node', args: [CLI, 'serve'], cwd: repo.dir } } },
    null,
    2,
  ),
);

const savedSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const savedBefore = fs.existsSync(savedSettingsPath)
  ? fs.readFileSync(savedSettingsPath, 'utf8')
  : null;

gitReset(repo.dir);

const sessionId = `${repoKey}-${taskId}-${repo.sha.slice(0, 8)}`.replace(/[^A-Za-z0-9-]/g, '-');
const args = [
  '-p',
  task.prompt,
  '--model',
  MODEL,
  '--session-id',
  sessionId,
  '--settings',
  settingsFile,
  '--strict-mcp-config',
  '--mcp-config',
  mcpFile,
  '--permission-mode',
  PERMISSION_MODE,
  '--output-format',
  'stream-json',
  '--verbose',
  '--allowedTools',
  ...ALLOWED_TOOLS,
];

console.log(`━━ trial ${repoKey}/${taskId} — nudge under test: ${task.nudgeUnderTest}`);
console.log(`   repo ${repo.repo} @ ${repo.sha.slice(0, 8)}, C1 asserted, prompt passed C4`);

const t0 = Date.now();
const res = spawnSync('claude', args, {
  cwd: repo.dir,
  timeout: TIMEOUT_MS,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  env: { ...process.env, PATH: `${shimDir(tmp)}:${process.env.PATH}`, FORCE_COLOR: '0' },
});
const ms = Date.now() - t0;

const transcript = (res.stdout || '') + '\n===STDERR===\n' + (res.stderr || '');
const transcriptPath = path.join(trialDir, 'transcript.jsonl');
fs.writeFileSync(transcriptPath, transcript);

// C2: the spawned process must not have mutated saved settings.
const savedAfter = fs.existsSync(savedSettingsPath)
  ? fs.readFileSync(savedSettingsPath, 'utf8')
  : null;
const c2Clean = savedBefore === savedAfter;

const diff = spawnSync('git', ['diff', '--stat'], { cwd: repo.dir, encoding: 'utf8' }).stdout || '';

// Nudge events this session (the `shown`/`acted-on` funnel rows).
const idxDir = (
  spawnSync('node', [CLI, 'path', '--store'], { cwd: repo.dir, encoding: 'utf8' }).stdout || ''
).trim();
let events = [];
for (const f of ['nudge-events.jsonl', 'delta-events.jsonl']) {
  const p = path.join(idxDir, f);
  if (!fs.existsSync(p)) continue;
  events.push(
    ...fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => {
        try {
          return { file: f, ...JSON.parse(l) };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(e => !e.sessionId || e.sessionId === sessionId),
  );
}

// M1's TEXT is not recoverable from the transcript. Verified empirically: with
// `--output-format stream-json --verbose`, only SessionStart hook events appear;
// PostToolUse `additionalContext` never does. nudge-events.jsonl proves a nudge was
// SHOWN and names the file/symbol, but not what it said — so Phase 4, which refutes
// the verbatim claim, has to reconstruct the text by re-running the same annotation
// against the same file at the same SHA.
const reconstructed = [];
for (const e of events.filter(e => e.kind === 'shown' && e.file)) {
  const r = spawnSync('node', [CLI, 'annotate', e.file], { cwd: repo.dir, encoding: 'utf8', timeout: 60_000 });
  reconstructed.push({ nudge: e.nudge, file: e.file, symbol: e.symbol ?? null, claimText: (r.stdout || '').trim() });
}

const result = {
  repo: repo.repo,
  repoKey,
  taskId,
  sha: repo.sha,
  nudgeUnderTest: task.nudgeUnderTest,
  prompt: task.prompt,
  ms,
  timedOut: res.error?.code === 'ETIMEDOUT',
  exitStatus: res.status,
  spawnError: res.error ? String(res.error.message) : null,
  contaminationAsserted: { c1: true, c2SavedSettingsUnchanged: c2Clean, c4PromptClean: true },
  gitDiffStat: diff.trim(),
  model: MODEL,
  nudgeEvents: events,
  reconstructedNudges: reconstructed,
  m1Note:
    'nudgesFired is derived from nudge-events.jsonl, NOT the transcript: PostToolUse additionalContext does not appear in stream-json output.',
  transcriptPath,
};
fs.writeFileSync(path.join(trialDir, 'result.json'), JSON.stringify(result, null, 2));

gitReset(repo.dir);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(
  `   exit=${res.status} in ${ms}ms; events=${events.length}; C2 saved-settings unchanged=${c2Clean}`,
);
if (!c2Clean) console.log('   ⚠ C2 FAILED — the spawned process mutated ~/.claude/settings.json');
console.log(`   → ${trialDir}`);

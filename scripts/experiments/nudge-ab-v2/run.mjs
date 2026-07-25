#!/usr/bin/env node
// nudge-ab-v2 runner — the operational realization of the FROZEN pre-registration
// in docs/development/nudge-ab-v2-protocol.md. Running the experiment later
// requires ZERO design decisions: every knob below is fixed by that document.
//
// Subcommands:
//   check   Zero-LLM instrument verification. Materializes both fixtures,
//           indexes them, and asserts the real hooks render the intended
//           nudges (blast warning + unrun-tests recap). No `claude` calls.
//   probe   The mandatory contamination + plumbing precondition (1 `claude`
//           call, no tools). MUST pass before any arm runs.
//   run     The gated experiment arms. Refuses to start unless `probe` passed
//           in this invocation first.
//
// Nothing here runs experiment arms unless explicitly invoked with `run`.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTranscript,
  blastMetric,
  blastGenericSentiment,
  verifyTranscriptRanTest,
  contaminationScan,
} from './detect.mjs';

// ---- FROZEN CONFIG -------------------------------------------------------
const N_PER_ARM = 10; // justified in the protocol doc (detection-oriented power)
const MODEL = 'sonnet';
const INTERLEAVE_SEED = 20260725; // fixed; drives the arm order
const ALLOWED_TOOLS = 'Edit,Write,Read,Bash,Grep,Glob';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(KIT, '..', '..', '..');
const PLUGIN_HOOKS = path.join(REPO, 'plugins', 'claude', 'hooks');
const KIT_HOOKS = path.join(KIT, 'hooks');
const CLI_ENTRY = path.join(REPO, 'packages', 'cli', 'dist', 'index.js');
const OUT_ROOT = path.join(REPO, '.wip', 'nudge-ab-v2');

// Env deltas per arm. Anything unset here inherits the process env; the base
// env (applied to BOTH arms of BOTH experiments) neutralizes every OTHER nudge
// so exactly one signal varies per experiment.
const BASE_ENV = { LIEN_DELTA_HOOK: 'off', LIEN_ANNOTATE_GUARD: 'off' };
const EXPERIMENTS = {
  blast: {
    fixture: 'blast',
    task: 'prompts/blast.task.txt',
    target: 'src/pricing/discount.ts',
    // recap held OFF in both arms so the ONLY delivery of the blast signal is
    // the edit-time api-delta warning (isolates PR #841's hook).
    baseEnv: { LIEN_RECAP: 'off', LIEN_TEST_REMINDER: 'off' },
    armEnv: { on: {}, off: { LIEN_BLAST_HOOK: 'off' } },
    settings: () => ({
      hooks: {
        PostToolUse: [
          postTool('Edit|Write|MultiEdit', hookCmd(PLUGIN_HOOKS, 'api-delta-write.sh')),
        ],
      },
    }),
  },
  verify: {
    fixture: 'verify',
    task: 'prompts/verify.task.txt',
    target: 'src/order-status.ts',
    // blast + edit-time reminder held OFF in both arms; the edit-time reminder
    // would name the test and defeat the "unnamed test" discriminator, so its
    // ledger recording is provided by the silent scaffolding hook instead.
    baseEnv: { LIEN_BLAST_HOOK: 'off', LIEN_TEST_REMINDER: 'off' },
    armEnv: { on: {}, off: { LIEN_RECAP: 'off' } },
    settings: () => ({
      hooks: {
        PostToolUse: [
          postTool('Edit|Write|MultiEdit', hookCmd(KIT_HOOKS, 'silent-note-edit.sh')),
          postTool('Bash', hookCmd(PLUGIN_HOOKS, 'test-run-note.sh')),
        ],
        Stop: [{ hooks: [{ type: 'command', command: hookCmd(PLUGIN_HOOKS, 'recap-stop.sh') }] }],
      },
    }),
  },
};

const hookCmd = (dir, name) => `bash ${path.join(dir, name)}`;
const postTool = (matcher, command) => ({ matcher, hooks: [{ type: 'command', command }] });

// ---- small utilities -----------------------------------------------------
function lien(args, cwd, env) {
  return spawnSync('node', [CLI_ENTRY, ...args], {
    cwd,
    env: env || process.env,
    encoding: 'utf8',
  });
}

// A `lien` shim on PATH so the plugin hooks (which call the bare `lien`
// binary) resolve to THIS build, not whatever is globally installed.
function makeLienShim(tmp) {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const shim = path.join(bin, 'lien');
  fs.writeFileSync(shim, `#!/usr/bin/env bash\nexec node ${JSON.stringify(CLI_ENTRY)} "$@"\n`);
  fs.chmodSync(shim, 0o755);
  return bin;
}

// Deterministic Fisher-Yates using a tiny seeded LCG (interleave order is part
// of the frozen protocol, so it must be reproducible).
function seededOrder(labels, seed) {
  const a = labels.slice();
  let s = seed >>> 0;
  const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff);
  for (let i = a.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- materialization -----------------------------------------------------
function materialize(fixtureName, dest, shimBin) {
  const src = path.join(KIT, 'fixtures', fixtureName);
  fs.cpSync(src, dest, { recursive: true });
  const env = { ...process.env, PATH: `${shimBin}:${process.env.PATH}` };
  execFileSync('git', ['init', '-q'], { cwd: dest });
  execFileSync('git', ['add', '-A'], { cwd: dest });
  execFileSync(
    'git',
    ['-c', 'user.email=ab@lien.dev', '-c', 'user.name=ab', 'commit', '-qm', 'init'],
    {
      cwd: dest,
    },
  );
  const r = lien(['index'], dest, env);
  if (r.status !== 0) throw new Error(`index failed in ${dest}: ${r.stderr}`);
  return env;
}

// ---- check (zero-LLM instrument verification) ----------------------------
function assert(cond, msg) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

function checkBlast(tmp, shimBin) {
  console.log('[check] blast fixture');
  const dest = path.join(tmp, 'blast');
  const env = materialize('blast', dest, shimBin);
  const before = lien(
    ['api-delta', '--file', 'src/pricing/discount.ts', '--format', 'json'],
    dest,
    env,
  );
  assert(JSON.parse(before.stdout).changes.length === 0, 'no api-delta before the edit');
  // apply the same signature change the task induces
  const edited =
    'export function applyDiscount(price: number, rate: number, floor?: number): number {\n' +
    '  const discounted = price - price * rate;\n' +
    '  return floor !== undefined ? Math.max(discounted, floor) : discounted;\n}\n';
  fs.writeFileSync(path.join(dest, 'src/pricing/discount.ts'), edited);
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'src/pricing/discount.ts' },
    cwd: dest,
    session_id: 'checkblast01',
  });
  const hook = spawnSync('bash', [path.join(PLUGIN_HOOKS, 'api-delta-write.sh')], {
    input: stdin,
    env,
    encoding: 'utf8',
  });
  const ctx = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext;
  console.log(`  blast nudge: ${ctx}`);
  assert(
    ctx.includes('applyDiscount') && ctx.includes('dependents'),
    'blast hook rendered the enriched warning',
  );
  assert(ctx.includes('get_dependents'), 'blast warning asks to check dependents');
}

function checkVerify(tmp, shimBin) {
  console.log('[check] verify fixture');
  const dest = path.join(tmp, 'verify');
  const env = materialize('verify', dest, shimBin);
  const sid = 'checkverify01';
  const note = lien(
    ['verify-tests', 'note-edit', '--session', sid, '--file', 'src/order-status.ts'],
    dest,
    env,
  );
  console.log(`  note-edit: ${note.stdout.trim()}`);
  assert(
    note.stdout.includes('regression-suite.test.ts'),
    'associates the non-lexically-named test by import',
  );
  const recap = lien(['verify-tests', 'report', '--session', sid], dest, env);
  assert(
    recap.stdout.includes('src/order-status.ts'),
    'recap/report raises the unrun associated test',
  );
  lien(
    [
      'verify-tests',
      'note-run',
      '--session',
      sid,
      '--command',
      'npx vitest run test/regression-suite.test.ts',
    ],
    dest,
    env,
  );
  const after = lien(['verify-tests', 'report', '--session', sid], dest, env);
  assert(after.stdout.trim() === '', 'report goes silent after a covering test run');
}

function cmdCheck() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-ab-check-'));
  const shimBin = makeLienShim(tmp);
  try {
    checkBlast(tmp, shimBin);
    checkVerify(tmp, shimBin);
    console.log('\nINSTRUMENT CHECK PASSED');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- isolated clean config dir + empty mcp -------------------------------
// No enabledPlugins, no user rules → the ambient Lien plugin (hooks + MCP) and
// the global ~/.claude/rules do NOT load. Auth on macOS lives in the Keychain,
// not this dir, so a headless `claude` still authenticates.
function isolatedConfig(tmp) {
  const dir = path.join(tmp, 'cc-config');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ model: MODEL, includeCoAuthoredBy: false }, null, 2),
  );
  const emptyMcp = path.join(tmp, 'empty-mcp.json');
  fs.writeFileSync(emptyMcp, JSON.stringify({ mcpServers: {} }));
  return { dir, emptyMcp };
}

function claudeArgs(prompt, sessionId, settingsFile, emptyMcp) {
  return [
    '-p',
    prompt,
    '--model',
    MODEL,
    '--session-id',
    sessionId,
    '--settings',
    settingsFile,
    '--strict-mcp-config',
    '--mcp-config',
    emptyMcp,
    '--permission-mode',
    'bypassPermissions',
    '--allowedTools',
    ALLOWED_TOOLS,
    '--output-format',
    'stream-json',
    '--verbose',
  ];
}

function runClaude(prompt, sessionId, cwd, settingsFile, cfg, extraEnv, shimBin) {
  const env = {
    ...process.env,
    ...BASE_ENV,
    ...extraEnv,
    PATH: `${shimBin}:${process.env.PATH}`,
    CLAUDE_CONFIG_DIR: cfg.dir,
  };
  const res = spawnSync('claude', claudeArgs(prompt, sessionId, settingsFile, cfg.emptyMcp), {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return res.stdout || '';
}

// ---- probe (mandatory precondition) --------------------------------------
function cmdProbe() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-ab-probe-'));
  const shimBin = makeLienShim(tmp);
  const cfg = isolatedConfig(tmp);
  // clean, git-free, CLAUDE.md-free directory
  const cwd = path.join(tmp, 'clean');
  fs.mkdirSync(cwd, { recursive: true });
  assertNoAncestorClaudeMd(cwd);
  const settingsFile = path.join(tmp, 'probe-settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ hooks: {} }));
  const prompt = fs.readFileSync(path.join(KIT, 'prompts', 'probe.txt'), 'utf8');
  const out = runClaude(prompt, randomUUID(), cwd, settingsFile, cfg, {}, shimBin);
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  fs.writeFileSync(path.join(OUT_ROOT, 'probe.jsonl'), out);
  const hits = contaminationScan(out);
  if (out.trim() === '')
    throw new Error('PROBE FAILED: empty output (auth/plumbing problem with isolated config dir)');
  if (hits.length > 0) throw new Error(`PROBE FAILED (contaminated): ${hits.join(', ')}`);
  fs.writeFileSync(path.join(OUT_ROOT, '.probe-passed'), new Date().toISOString());
  console.log('PROBE PASSED — context clean, plumbing live. Arms may run.');
}

function assertNoAncestorClaudeMd(dir) {
  let d = dir;
  for (;;) {
    if (fs.existsSync(path.join(d, 'CLAUDE.md'))) throw new Error(`CLAUDE.md present at ${d}`);
    const parent = path.dirname(d);
    if (parent === d) return;
    d = parent;
  }
}

// ---- run (gated arms) ----------------------------------------------------
function verifyRanOracle(dest, sid, env) {
  const report = lien(['verify-tests', 'report', '--session', sid], dest, env);
  return report.stdout.trim() === ''; // empty ⇒ the associated test was observed run
}

function blastFired(dest, sid) {
  const store = lien(['path', '--store'], dest).stdout.trim();
  const events = path.join(store, 'nudge-events.jsonl');
  if (!fs.existsSync(events)) return false;
  const body = fs.readFileSync(events, 'utf8');
  return body.includes('"nudge":"blast"') && body.includes(sid);
}

function runTrial(expName, arm, idx, tmp, shimBin, cfg) {
  const exp = EXPERIMENTS[expName];
  const dest = path.join(tmp, `${expName}-${arm}-${idx}`);
  const env = materialize(exp.fixture, dest, shimBin);
  const settingsFile = path.join(dest, '.ab-settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify(exp.settings()));
  const sid = randomUUID();
  const task = fs.readFileSync(path.join(KIT, exp.task), 'utf8');
  const armEnv = { ...exp.baseEnv, ...exp.armEnv[arm] };
  const transcript = runClaude(task, sid, dest, settingsFile, cfg, armEnv, shimBin);
  const parsed = parseTranscript(transcript);
  const result = scoreTrial(expName, arm, dest, sid, env, parsed, transcript);
  saveTrial(expName, arm, idx, transcript, result);
  fs.rmSync(dest, { recursive: true, force: true });
  return result;
}

function scoreTrial(expName, arm, dest, sid, env, parsed, transcript) {
  const contamination = arm === 'off' ? contaminationScan(transcript) : [];
  if (expName === 'blast') {
    const m = blastMetric(parsed.toolUses, parsed.finalText);
    return {
      hit: m.hit,
      reasons: m.reasons,
      generic: blastGenericSentiment(parsed.finalText, m.hit),
      valid: arm === 'off' ? true : blastFired(dest, sid),
      contamination,
    };
  }
  const ran = verifyRanOracle(dest, sid, env);
  return {
    hit: ran,
    reasons: verifyTranscriptRanTest(parsed.toolUses).reasons,
    valid: true,
    contamination,
  };
}

function saveTrial(expName, arm, idx, transcript, result) {
  const dir = path.join(OUT_ROOT, expName, arm);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${idx}.jsonl`), transcript);
  fs.writeFileSync(path.join(dir, `${idx}.json`), JSON.stringify(result, null, 2));
}

function cmdRun(expName) {
  if (!fs.existsSync(path.join(OUT_ROOT, '.probe-passed'))) {
    throw new Error(
      'Refusing to run: contamination probe has not passed. Run `node run.mjs probe` first.',
    );
  }
  if (!EXPERIMENTS[expName]) throw new Error(`unknown experiment: ${expName}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `nudge-ab-${expName}-`));
  const shimBin = makeLienShim(tmp);
  const cfg = isolatedConfig(tmp);
  const labels = seededOrder(
    Array.from({ length: N_PER_ARM }, (_, i) => [`on:${i}`, `off:${i}`]).flat(),
    INTERLEAVE_SEED,
  );
  const results = { on: [], off: [] };
  for (const label of labels) {
    const [arm, i] = label.split(':');
    console.log(`[run] ${expName} ${arm} #${i}`);
    results[arm].push(runTrial(expName, arm, i, tmp, shimBin, cfg));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  report(expName, results);
}

// ---- reporting -----------------------------------------------------------
function tally(rows) {
  const valid = rows.filter(r => r.valid);
  return {
    n: valid.length,
    hits: valid.filter(r => r.hit).length,
    invalid: rows.length - valid.length,
  };
}

function report(expName, results) {
  const on = tally(results.on);
  const off = tally(results.off);
  const leaks = [...results.on, ...results.off].filter(r => r.contamination.length > 0).length;
  const p = fisherOneSided(on.hits, on.n, off.hits, off.n);
  const separated = p < 0.05 && on.hits / Math.max(on.n, 1) > off.hits / Math.max(off.n, 1);
  const summary = {
    experiment: expName,
    on: `${on.hits}/${on.n}`,
    off: `${off.hits}/${off.n}`,
    invalid: { on: on.invalid, off: off.invalid },
    contaminationLeaks: leaks,
    fisherOneSidedP: Number(p.toFixed(4)),
    primarySeparated: separated,
    launchClaimPermitted: separated,
  };
  fs.writeFileSync(
    path.join(OUT_ROOT, `${expName}-summary.json`),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

// One-sided Fisher exact (P(X >= observed on-hits) under the null), via the
// hypergeometric tail. Small N, so direct factorials are fine.
function logFact(n) {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}
function logHyper(k, n1, n2, t) {
  return (
    logFact(n1) +
    logFact(n2) +
    logFact(t) +
    logFact(n1 + n2 - t) -
    logFact(n1 + n2) -
    logFact(k) -
    logFact(n1 - k) -
    logFact(t - k) -
    logFact(n2 - (t - k))
  );
}
function fisherOneSided(a, n1, c, n2) {
  const t = a + c;
  if (n1 === 0 || n2 === 0) return 1;
  let p = 0;
  for (let k = a; k <= Math.min(n1, t); k++) {
    if (t - k < 0 || t - k > n2) continue;
    p += Math.exp(logHyper(k, n1, n2, t));
  }
  return Math.min(1, p);
}

// ---- entry ---------------------------------------------------------------
function main() {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === 'check') return cmdCheck();
  if (cmd === 'probe') return cmdProbe();
  if (cmd === 'run') {
    const exp = rest[0];
    if (!exp) throw new Error('usage: run.mjs run <blast|verify>');
    return cmdRun(exp);
  }
  console.log('usage: run.mjs <check|probe|run <blast|verify>>');
  process.exit(cmd ? 1 : 0);
}
main();

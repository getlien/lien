#!/usr/bin/env node
/**
 * Phase 0 provisioner for the foreign-repo dogfood
 * (protocol: docs/development/dogfood-oss-corpus-protocol.md).
 *
 * Clones the corpus OUTSIDE the Lien tree, asserts contamination control C1,
 * indexes each repo with the locally built CLI, and records M6.
 *
 * The corpus root must live outside this repo: cloning under the Lien checkout
 * would put Lien's own tool-mandating CLAUDE.md on the clone's ancestor path,
 * which is exactly the contamination C1 exists to prevent.
 *
 *   node scripts/experiments/dogfood-oss/provision.mjs [--only <lang>] [--skip-index]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(REPO, 'packages/cli/dist/index.js');
// Default deliberately AVOIDS $CLAUDE_JOB_DIR: that lives under `~/.claude/`, and
// Claude Code treats everything beneath it as a sensitive file, so an agent trial in
// a corpus there completes its whole investigation and then has its Edit DENIED.
// Learned the slow way — one 10-minute trial and $2.40. Keep this on a neutral root.
const CORPUS_ROOT =
  process.env.LIEN_DOGFOOD_CORPUS || path.join(os.tmpdir(), 'lien-dogfood-corpus');

// C1 is tiered, because contamination is about what the agent UNDER TEST reads.
//
// BLOCKING: files the `claude` CLI itself loads as instructions. One of these on
// the clone or its ancestor path voids the trial.
const BLOCKING_FILES = ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md', '.claude/AGENTS.md'];
// ADVISORY: other assistants' instruction files. Claude Code does not read these,
// so they cannot bias a trial — but a repo carrying them is likely to grow a
// CLAUDE.md later, so they are recorded rather than ignored.
//
// `.cursor/rules` is deliberately NOT the bare `.cursor` directory: matching the
// directory blocked the first provisioning run on `~/.cursor`, which held only
// Cursor app data (extensions, plugins, ide_state) and no rules whatsoever. An
// over-broad control that halts on a non-issue trains you to bypass it, which is
// worse than not having it.
const ADVISORY_FILES = [
  '.cursorrules',
  '.cursor/rules',
  'GEMINI.md',
  '.windsurfrules',
  'CONVENTIONS.md',
  '.github/copilot-instructions.md',
  '.aider.conf.yml',
];

const CORPUS = [
  { repo: 'pallets/flask', lang: 'python', tier: 'known', ext: ['.py'] },
  { repo: 'gin-gonic/gin', lang: 'go', tier: 'known', ext: ['.go'] },
  { repo: 'tokio-rs/tokio', lang: 'rust', tier: 'known', ext: ['.rs'] },
  { repo: 'Alamofire/Alamofire', lang: 'swift', tier: 'known', ext: ['.swift'] },
  { repo: 'honojs/hono', lang: 'typescript', tier: 'fresh', ext: ['.ts'] },
  { repo: 'square/retrofit', lang: 'java', tier: 'fresh', ext: ['.java'] },
  { repo: 'symfony/console', lang: 'php', tier: 'fresh', ext: ['.php'] },
  { repo: 'serilog/serilog', lang: 'csharp', tier: 'fresh', ext: ['.cs'] },
  { repo: 'sidekiq/sidekiq', lang: 'ruby', tier: 'fresh', ext: ['.rb'] },
];

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const skipIndex = args.includes('--skip-index');
const SAMPLE = 25;

function sh(cmd, cmdArgs, cwd, timeout = 600_000) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd,
    timeout,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || ''), status: r.status };
}

/**
 * C1, ancestor half: scan from `dir` up to the filesystem root. Returns blocking
 * and advisory hits separately — only blocking ones may halt a run.
 */
function ancestorViolations(dir) {
  const blocking = [];
  const advisory = [];
  let cur = path.resolve(dir);
  for (;;) {
    for (const f of BLOCKING_FILES) {
      if (fs.existsSync(path.join(cur, f))) blocking.push(path.join(cur, f));
    }
    for (const f of ADVISORY_FILES) {
      if (fs.existsSync(path.join(cur, f))) advisory.push(path.join(cur, f));
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return { blocking, advisory };
}

/** C1, in-clone half: asserted against the PINNED SHA, not the screened default branch. */
function cloneViolations(dir) {
  const present = f => fs.existsSync(path.join(dir, f));
  return { blocking: BLOCKING_FILES.filter(present), advisory: ADVISORY_FILES.filter(present) };
}

/**
 * Source files for a repo, via `git ls-files` rather than a hand-rolled walk.
 *
 * The walk version silently counted BUILD ARTIFACTS: after a trial ran
 * `dotnet build` in serilog, 30 generated `.cs` files appeared under `obj/`
 * (AssemblyInfo.cs, GlobalUsings.g.cs, ...). They are gitignored — so the tree
 * looked clean and `git clean -fd` left them in place — but the walk picked them
 * up, diluted the evenly-spaced sample with files that can have no tests, and
 * dropped measured C# coverage from 52% to 0%. That read exactly like a
 * regression in a freshly merged PR.
 *
 * Asking git removes the whole class of bug: it returns tracked files only, so
 * artifacts, vendored trees and node_modules are excluded by construction rather
 * than by a skip-list someone has to remember to extend.
 */
function listSourceFiles(dir, exts) {
  const r = sh('git', ['ls-files', '-z'], dir, 120_000);
  if (!r.ok) throw new Error(`git ls-files failed in ${dir}: ${r.out.slice(0, 200)}`);
  return r.out
    .split('\0')
    .filter(f => f && exts.some(x => f.endsWith(x)))
    .sort();
}

/** Evenly-spaced sample of up to SAMPLE files. */
function pickSample(files) {
  const step = Math.max(1, Math.floor(files.length / SAMPLE));
  const out = [];
  for (let i = 0; i < files.length && out.length < SAMPLE; i += step) out.push(files[i]);
  return out;
}

/**
 * Which tier `annotate` reported. There are THREE and the middle one has no
 * colon — matching only `Test coverage:` scored Swift's working inferred tier as
 * 0% and produced a HIGH finding that had to be retracted.
 */
function coverageTier(out) {
  if (/Test coverage:/i.test(out)) return 'confident';
  if (/Test coverage inferred/i.test(out)) return 'inferred';
  return 'none';
}

const pctOf = (n, d) => Math.round((n / d) * 1000) / 10;

const EMPTY_COVERAGE = {
  sampled: 0,
  withTests: 0,
  inferred: 0,
  anyCoverage: 0,
  pct: 0,
  pctIncludingInferred: 0,
  examples: [],
};

/**
 * M6 test-association coverage, measured through `lien annotate` — the same code
 * path the nudge itself uses. A raw index count could look healthy while the
 * consumer surface reports nothing, and it is the consumer surface that matters.
 */
function associationCoverage(dir, files) {
  if (files.length === 0) return EMPTY_COVERAGE;
  const sample = pickSample(files);
  const tiers = { confident: 0, inferred: 0, none: 0 };
  const examples = [];
  for (const f of sample) {
    const out = sh('node', [CLI, 'annotate', f], dir, 60_000).out;
    tiers[coverageTier(out)]++;
    if (examples.length < 3 && out.trim())
      examples.push({ file: f, annotation: out.trim().slice(0, 400) });
  }
  const any = tiers.confident + tiers.inferred;
  return {
    sampled: sample.length,
    withTests: tiers.confident,
    inferred: tiers.inferred,
    anyCoverage: any,
    pct: pctOf(tiers.confident, sample.length),
    pctIncludingInferred: pctOf(any, sample.length),
    examples,
  };
}

// ─── run ──────────────────────────────────────────────────────────────────────

if (!fs.existsSync(CLI)) {
  console.error(`FATAL: CLI not built at ${CLI} — run \`npm run build\` first.`);
  process.exit(1);
}

const rootScan = ancestorViolations(CORPUS_ROOT);
if (rootScan.blocking.length) {
  console.error(
    'FATAL: C1 ancestor violation for the corpus root — behavioral trials here would be void:',
  );
  rootScan.blocking.forEach(v => console.error(`  ${v}`));
  process.exit(1);
}
fs.mkdirSync(CORPUS_ROOT, { recursive: true });
console.log(`corpus root: ${CORPUS_ROOT}`);
console.log(`C1 ancestor scan: no blocking instruction files`);
if (rootScan.advisory.length) {
  console.log(`C1 advisory (not read by claude, recorded only): ${rootScan.advisory.join(', ')}`);
}
console.log('');

const manifest = {
  corpusRoot: CORPUS_ROOT,
  cliVersion: sh('node', [CLI, '--version'], REPO).out.trim(),
  repos: [],
};
const targets = only ? CORPUS.filter(c => c.lang === only) : CORPUS;

for (const c of targets) {
  const name = c.repo.split('/')[1];
  const dest = path.join(CORPUS_ROOT, name);
  const rec = { ...c, dir: dest };
  console.log(`━━ ${c.repo} (${c.lang}, ${c.tier})`);

  if (!fs.existsSync(path.join(dest, '.git'))) {
    const clone = sh(
      'git',
      ['clone', '--depth', '1', '--single-branch', `https://github.com/${c.repo}.git`, dest],
      CORPUS_ROOT,
    );
    if (!clone.ok) {
      rec.status = 'CLONE_FAILED';
      rec.error = clone.out.slice(-500);
      console.log(`   ✗ clone failed`);
      manifest.repos.push(rec);
      continue;
    }
  }
  rec.sha = sh('git', ['rev-parse', 'HEAD'], dest).out.trim();

  const viol = cloneViolations(dest);
  rec.c1Advisory = viol.advisory;
  if (viol.blocking.length) {
    rec.status = 'QUARANTINED_C1';
    rec.c1Violations = viol.blocking;
    console.log(`   ✗ QUARANTINED — C1 violation at pinned SHA: ${viol.blocking.join(', ')}`);
    manifest.repos.push(rec);
    continue;
  }
  rec.c1 = 'clean';
  if (viol.advisory.length)
    console.log(`   · C1 advisory (non-claude): ${viol.advisory.join(', ')}`);

  const files = listSourceFiles(dest, c.ext);
  rec.sourceFileCount = files.length;

  if (!skipIndex) {
    const t0 = process.hrtime.bigint();
    const idx = sh('node', [CLI, 'index'], dest);
    rec.indexMs = Number((process.hrtime.bigint() - t0) / 1_000_000n);
    rec.indexOk = idx.ok;
    rec.indexTail = idx.out.trim().split('\n').slice(-6).join('\n');
    if (!idx.ok) {
      rec.status = 'INDEX_FAILED';
      console.log(`   ✗ index failed in ${rec.indexMs}ms`);
      manifest.repos.push(rec);
      continue;
    }
    const st = sh('node', [CLI, 'status', '--format', 'json'], dest);
    try {
      rec.status_json = JSON.parse(st.out.slice(st.out.indexOf('{')));
    } catch {
      rec.status_json_raw = st.out.slice(0, 800);
    }
    rec.associations = associationCoverage(dest, files);
    const a = rec.associations;
    const inferredNote = a.inferred > 0 ? ` + ${a.inferred} inferred = ${a.pctIncludingInferred}%` : '';
    console.log(
      `   ✓ ${rec.sourceFileCount} ${c.lang} files, indexed in ${rec.indexMs}ms; ` +
        `coverage ${a.pct}% confident${inferredNote} (${a.withTests}/${a.sampled} sampled)`,
    );
  }
  rec.status = 'OK';
  manifest.repos.push(rec);
}

manifest.c1AncestorAdvisory = rootScan.advisory;

const outPath = path.join(import.meta.dirname, 'corpus-manifest.json');
// MERGE rather than overwrite: a `--only <lang>` run must refresh just that repo's
// entry, not replace the whole manifest with a single row. Overwriting silently
// broke every other repo's trial with "no repo <x> in manifest".
if (only && fs.existsSync(outPath)) {
  const prior = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const refreshed = new Set(manifest.repos.map(r => r.repo));
  manifest.repos = [...prior.repos.filter(r => !refreshed.has(r.repo)), ...manifest.repos].sort((a, b) =>
    a.repo.localeCompare(b.repo),
  );
}
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

const ok = manifest.repos.filter(r => r.status === 'OK');
const bad = manifest.repos.filter(r => r.status !== 'OK');
console.log(`\n━━ summary: ${ok.length} OK, ${bad.length} not OK`);
bad.forEach(r =>
  console.log(
    `   ${r.repo}: ${r.status}${r.c1Violations ? ' → ' + r.c1Violations.join(', ') : ''}`,
  ),
);
console.log(`manifest: ${outPath}`);
// Protocol abort criterion: more than two repos failing to index stops the run.
if (bad.filter(r => r.status === 'INDEX_FAILED' || r.status === 'CLONE_FAILED').length > 2) {
  console.log('\nABORT CRITERION MET: >2 repos failed — fix indexing before spending on trials.');
  process.exit(2);
}

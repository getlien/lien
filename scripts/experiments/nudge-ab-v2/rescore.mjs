#!/usr/bin/env node
// Offline CORRECTED-pipeline re-score over the archived raw trials under
// .wip/nudge-ab-v2/. Zero LLM, no trial re-runs — the raw data stands. It
// re-derives per-arm counts and Fisher p using the SAME corrected scoring logic
// run.mjs now uses, to confirm the corrected instrument reproduces the published
// numbers (closing the loop beyond the manual audit).
//
//   blast : hit = blastMetric(transcript); valid = symmetric api-delta replay
//           (did the agent's edit change applyDiscount's signature?) — the same
//           `blastEditCompleted` oracle, applied identically to BOTH arms.
//   verify: hit = the ledger result saved at run time (the per-trial store dir
//           was cleaned up, so the ledger can't be re-queried offline); valid =
//           editedTarget(transcript). The transcript cross-check
//           (verifyTranscriptRanTest) is reported as an independent agreement.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTranscript,
  blastMetric,
  editedTarget,
  looksLoggedOut,
  verifyTranscriptRanTest,
  fisherOneSided,
} from './detect.mjs';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(KIT, '..', '..', '..');
const CLI = path.join(REPO, 'packages/cli/dist/index.js');
const OUT = path.join(REPO, '.wip/nudge-ab-v2');
const BLAST_TARGET = 'src/pricing/discount.ts';
const VERIFY_TARGET = 'src/order-status.ts';

// Guarded JSON read: a corrupt/empty archived file (partial write, manual edit)
// reports the offending path and forces a non-zero exit rather than aborting the
// whole audit with a bare SyntaxError.
function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`CORRUPT/UNREADABLE archive file: ${file} — ${e.message}`);
    process.exitCode = 1;
    return null;
  }
}

// Edit/Write ops targeting the file, from parseTranscript's already-decoded
// tool_use blocks (no re-parsing of the raw JSONL).
function opsFromTool(tu) {
  const i = tu.input || {};
  if (tu.name === 'Edit') return [{ kind: 'edit', old: i.old_string, neu: i.new_string }];
  if (tu.name === 'Write') return [{ kind: 'write', content: i.content }];
  if (tu.name === 'MultiEdit')
    return (i.edits || []).map(e => ({ kind: 'edit', old: e.old_string, neu: e.new_string }));
  return [];
}

function editsForTarget(toolUses, targetBase) {
  return toolUses
    .filter(tu => String(tu.input?.file_path || '').endsWith(targetBase))
    .flatMap(opsFromTool);
}

function applyOps(content, ops) {
  let cur = content;
  for (const op of ops) {
    if (op.kind === 'write') cur = op.content;
    else if (op.old != null && cur.includes(op.old)) cur = cur.replace(op.old, op.neu);
  }
  return cur;
}

function makeBlastReplay() {
  const W = fs.mkdtempSync(path.join(os.tmpdir(), 'rescore-blast-'));
  fs.cpSync(path.join(KIT, 'fixtures/blast'), W, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: W });
  execFileSync('git', ['add', '-A'], { cwd: W });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'i'], {
    cwd: W,
  });
  return { W, pristine: fs.readFileSync(path.join(W, BLAST_TARGET), 'utf8') };
}

function blastEditCompleted(replay, ops) {
  execFileSync('git', ['checkout', '--', '.'], { cwd: replay.W });
  fs.writeFileSync(path.join(replay.W, BLAST_TARGET), applyOps(replay.pristine, ops));
  const r = spawnSync('node', [CLI, 'api-delta', '--file', BLAST_TARGET, '--format', 'json'], {
    cwd: replay.W,
    encoding: 'utf8',
  });
  let d;
  try {
    d = JSON.parse(r.stdout);
  } catch {
    return false;
  }
  return (d.changes || []).some(c => c.kind === 'signature-changed' || c.kind === 'removed');
}

function scoreRow(exp, dir, idx, replay) {
  const saved = readJson(path.join(dir, `${idx}.json`)) || {};
  const transcript = fs.readFileSync(path.join(dir, `${idx}.jsonl`), 'utf8');
  const parsed = parseTranscript(transcript);
  const usable = !looksLoggedOut(transcript) && !saved.timedOut && !saved.failed;
  if (exp === 'blast') {
    const ops = editsForTarget(parsed.toolUses, 'discount.ts');
    return {
      hit: blastMetric(parsed.toolUses, parsed.finalText).hit,
      valid: usable && blastEditCompleted(replay, ops),
    };
  }
  const crosscheck = verifyTranscriptRanTest(parsed.toolUses).hit;
  return {
    hit: saved.hit,
    valid: usable && editedTarget(parsed.toolUses, VERIFY_TARGET),
    crosscheck,
  };
}

function rescore(exp) {
  const replay = exp === 'blast' ? makeBlastReplay() : null;
  const arms = { on: [], off: [] };
  for (const arm of ['on', 'off']) {
    const dir = path.join(OUT, exp, arm);
    for (const f of fs
      .readdirSync(dir)
      .filter(x => x.endsWith('.json'))
      .sort()) {
      arms[arm].push(scoreRow(exp, dir, f.replace('.json', ''), replay));
    }
  }
  if (replay) fs.rmSync(replay.W, { recursive: true, force: true });
  const tally = rows => {
    const v = rows.filter(r => r.valid);
    return { n: v.length, hits: v.filter(r => r.hit).length };
  };
  const on = tally(arms.on);
  const off = tally(arms.off);
  return {
    on: `${on.hits}/${on.n}`,
    off: `${off.hits}/${off.n}`,
    fisherOneSidedP: Number(fisherOneSided(on.hits, on.n, off.hits, off.n).toExponential(3)),
    arms,
  };
}

for (const exp of ['blast', 'verify']) {
  const re = rescore(exp);
  const pub = readJson(path.join(OUT, `${exp}-summary.json`)) || {};
  const countsMatch = re.on === pub.on && re.off === pub.off;
  console.log(`=== ${exp} ===`);
  console.log(`  published summary : on=${pub.on}  off=${pub.off}  p=${pub.fisherOneSidedP}`);
  console.log(`  corrected re-score: on=${re.on}  off=${re.off}  p=${re.fisherOneSidedP}`);
  console.log(`  counts reproduce EXACTLY: ${countsMatch ? 'YES' : 'NO'}`);
  if (exp === 'verify') {
    const agree = re.arms.on.concat(re.arms.off).every(r => r.crosscheck === r.hit);
    console.log(`  verify transcript cross-check agrees with ledger hit: ${agree ? 'YES' : 'NO'}`);
  }
  fs.writeFileSync(
    path.join(OUT, `${exp}-summary-rescored.json`),
    JSON.stringify({ on: re.on, off: re.off, fisherOneSidedP: re.fisherOneSidedP }, null, 2),
  );
}

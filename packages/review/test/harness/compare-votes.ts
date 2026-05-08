#!/usr/bin/env tsx
/**
 * Compare two `--trace` dump files (typically a passing and a failing
 * vote on the same fixture) and print a readable diff.
 *
 * Usage:
 *   tsx compare-votes.ts <trace1.json> <trace2.json>
 *
 * The most useful invocation is:
 *
 *   tsx run.ts --rule X --calibrate 10 --trace /tmp/cal
 *   tsx compare-votes.ts /tmp/cal/X/<scenario>/vote-2.json \
 *                         /tmp/cal/X/<scenario>/vote-7.json
 *
 * Output: a header summary (passed?, failure tier/message, turn count,
 * tool-call summary) followed by `diff -u`-style per-turn response-text
 * diffs. The systemPrompt and initialMessage are only diffed if they
 * actually differ between the two files (usually identical for
 * same-fixture voting).
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentTrace, TurnTrace, ToolInvocation } from '../../src/plugins/agent/types.js';

interface VoteDump {
  label: string;
  voteIndex: number;
  passed: boolean;
  failureMessage?: string;
  failureTier?: 1 | 2;
  cost: number;
  trace?: AgentTrace;
}

async function loadVote(path: string): Promise<VoteDump> {
  const raw = await fs.readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as VoteDump;
  if (!parsed.trace) {
    throw new Error(
      `${path}: no .trace field. Re-run the harness with --trace <dir> to capture traces.`,
    );
  }
  return parsed;
}

function summariseInvocations(calls: ToolInvocation[]): string {
  if (calls.length === 0) return '(none)';
  return calls.map(c => c.name).join(', ');
}

function header(label: string, vote: VoteDump): string {
  const status = vote.passed ? 'PASS' : `FAIL${vote.failureTier ? ` T${vote.failureTier}` : ''}`;
  const turns = vote.trace?.turns.length ?? 0;
  const tools = vote.trace?.turns.reduce((sum, t) => sum + t.toolCalls.length, 0) ?? 0;
  const lines = [
    `=== ${label} (vote ${vote.voteIndex}) ===`,
    `  status:  ${status}`,
    `  cost:    $${vote.cost.toFixed(4)}`,
    `  turns:   ${turns}`,
    `  tools:   ${tools} call(s)`,
  ];
  if (vote.failureMessage) {
    lines.push(`  failure: ${vote.failureMessage.slice(0, 200)}`);
  }
  return lines.join('\n');
}

/**
 * Pipe two strings to `diff -u` via temp files. Falls back to "(diff
 * unavailable)" if the system has no diff binary, but every dev box and
 * CI we ship to has one.
 */
function diffStrings(a: string, b: string, labelA: string, labelB: string): string {
  if (a === b) return '(identical)';
  const dir = mkdtempSync(join(tmpdir(), 'compare-votes-'));
  try {
    const fileA = join(dir, 'a');
    const fileB = join(dir, 'b');
    execFileSync('sh', ['-c', `cat > ${JSON.stringify(fileA)}`], { input: a });
    execFileSync('sh', ['-c', `cat > ${JSON.stringify(fileB)}`], { input: b });
    try {
      execFileSync('diff', ['-u', '--label', labelA, '--label', labelB, fileA, fileB], {
        encoding: 'utf8',
      });
      return '(identical)';
    } catch (err) {
      // diff exits 1 when files differ — that's the success path here.
      const e = err as { stdout?: Buffer | string };
      const out = e.stdout;
      return typeof out === 'string' ? out : (out?.toString('utf8') ?? '(diff failed)');
    }
  } finally {
    // Best-effort cleanup; not critical.
    try {
      execFileSync('rm', ['-rf', dir]);
    } catch {
      /* ignore */
    }
  }
}

function diffTurn(a: TurnTrace | undefined, b: TurnTrace | undefined, n: number): string {
  if (!a && !b) return '';
  if (!a) return `\n--- turn ${n}: only in B ---\n${b!.responseText}\n`;
  if (!b) return `\n--- turn ${n}: only in A ---\n${a.responseText}\n`;
  const sectionA = `${a.responseText}\n[tools: ${summariseInvocations(a.toolCalls)}]`;
  const sectionB = `${b.responseText}\n[tools: ${summariseInvocations(b.toolCalls)}]`;
  if (sectionA === sectionB) return `\n--- turn ${n}: identical ---\n`;
  return `\n--- turn ${n} ---\n${diffStrings(sectionA, sectionB, `A.turn${n}`, `B.turn${n}`)}`;
}

async function main(): Promise<void> {
  const [pathA, pathB] = process.argv.slice(2);
  if (!pathA || !pathB) {
    console.error('Usage: tsx compare-votes.ts <trace1.json> <trace2.json>');
    process.exit(2);
  }
  const [a, b] = await Promise.all([loadVote(resolve(pathA)), loadVote(resolve(pathB))]);

  console.log(header('A', a));
  console.log('');
  console.log(header('B', b));
  console.log('');

  if (a.trace!.systemPrompt !== b.trace!.systemPrompt) {
    console.log('--- systemPrompt differs ---');
    console.log(diffStrings(a.trace!.systemPrompt, b.trace!.systemPrompt, 'A.system', 'B.system'));
  }
  if (a.trace!.initialMessage !== b.trace!.initialMessage) {
    console.log('--- initialMessage differs ---');
    console.log(
      diffStrings(a.trace!.initialMessage, b.trace!.initialMessage, 'A.initial', 'B.initial'),
    );
  }

  const turnCount = Math.max(a.trace!.turns.length, b.trace!.turns.length);
  for (let i = 0; i < turnCount; i++) {
    process.stdout.write(diffTurn(a.trace!.turns[i], b.trace!.turns[i], i + 1));
  }
}

main().catch(err => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

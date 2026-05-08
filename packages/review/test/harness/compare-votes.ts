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
 * tool-call summary) followed by unified-diff-style per-turn diffs that
 * include the assistant's response text and each tool call's args + output.
 * The systemPrompt and initialMessage are only diffed if they actually
 * differ between the two files (usually identical for same-fixture voting).
 */

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

import { createPatch } from 'diff';

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

/**
 * Render a turn (response text + each tool call's name, args, and output)
 * as a deterministic multi-line string suitable for `diff -u`-style
 * comparison. Including args + output is critical: the model can call the
 * same tool with materially different arguments (e.g.,
 * grep_codebase("foo") vs grep_codebase("bar")), and a name-only summary
 * would silently report turns as identical (per Lien Review on #550).
 */
function renderTurn(turn: TurnTrace): string {
  const lines: string[] = [];
  lines.push('--- response ---');
  lines.push(turn.responseText || '(empty)');
  lines.push('--- tools ---');
  if (turn.toolCalls.length === 0) {
    lines.push('(none)');
  } else {
    turn.toolCalls.forEach((c, i) => {
      lines.push(renderInvocation(i, c));
    });
  }
  return lines.join('\n');
}

function renderInvocation(index: number, c: ToolInvocation): string {
  // Stringify args/output deterministically so the diff is line-stable.
  // JSON.stringify with 2-space indent gives multi-line output that
  // unified-diff handles cleanly. Output is already 4 KB-capped at
  // capture time.
  const input = stableJsonString(c.input, 2);
  return [
    `[${index}] ${c.name}`,
    `  input:`,
    indent(input, '    '),
    `  output:`,
    indent(c.output, '    '),
  ].join('\n');
}

function indent(s: string, prefix: string): string {
  return s
    .split('\n')
    .map(line => prefix + line)
    .join('\n');
}

/**
 * Recursively sort object keys so two semantically-identical inputs
 * with different key insertion orders produce byte-identical JSON.
 * Without this, a model that emits `{"a":1,"b":2}` on one vote and
 * `{"b":2,"a":1}` on another would render as a fake diff in
 * compare-votes (per Lien Review on #550). Arrays preserve order
 * (positional semantics matter); primitives pass through.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function stableJsonString(value: unknown, indentSpaces: number): string {
  try {
    return JSON.stringify(sortKeys(value), null, indentSpaces);
  } catch {
    return String(value);
  }
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
 * Pure-JS unified diff via the `diff` npm package — works on every
 * platform Node runs on, no `sh` / system `diff` binary required (per
 * Lien Review on #550). Returns "(identical)" if the strings match;
 * otherwise the unified-patch text minus the leading "Index:" /
 * "==" boilerplate that `createPatch` emits.
 */
function diffStrings(a: string, b: string, labelA: string, labelB: string): string {
  if (a === b) return '(identical)';
  const patch = createPatch(labelA, a, b, '', '', { context: 3 });
  // createPatch prefixes with "Index: <name>\n===…===\n--- …\n+++ …" — the
  // first three lines are noise for our use case; replace the second
  // header with the second label.
  const lines = patch.split('\n');
  // lines[0] = "Index: <labelA>", lines[1] = "===…", lines[2] = "--- <labelA>",
  // lines[3] = "+++ <labelA>" (createPatch reuses the filename for both
  // headers when newFileName is empty). Rewrite the +++ line to labelB.
  if (lines.length >= 4 && lines[3].startsWith('+++ ')) {
    lines[3] = `+++ ${labelB}`;
  }
  return lines.slice(2).join('\n');
}

function diffTurn(a: TurnTrace | undefined, b: TurnTrace | undefined, n: number): string {
  if (!a && !b) return '';
  if (!a) return `\n--- turn ${n}: only in B ---\n${renderTurn(b!)}\n`;
  if (!b) return `\n--- turn ${n}: only in A ---\n${renderTurn(a)}\n`;
  const sectionA = renderTurn(a);
  const sectionB = renderTurn(b);
  if (sectionA === sectionB) return `\n--- turn ${n}: identical ---\n`;
  return `\n--- turn ${n} ---\n${diffStrings(sectionA, sectionB, `A.turn${n}`, `B.turn${n}`)}`;
}

function diffPromptsIfDifferent(a: AgentTrace, b: AgentTrace): void {
  if (a.systemPrompt !== b.systemPrompt) {
    console.log('--- systemPrompt differs ---');
    console.log(diffStrings(a.systemPrompt, b.systemPrompt, 'A.system', 'B.system'));
  }
  if (a.initialMessage !== b.initialMessage) {
    console.log('--- initialMessage differs ---');
    console.log(diffStrings(a.initialMessage, b.initialMessage, 'A.initial', 'B.initial'));
  }
}

function printVoteDiff(a: VoteDump, b: VoteDump): void {
  console.log(header('A', a));
  console.log('');
  console.log(header('B', b));
  console.log('');
  diffPromptsIfDifferent(a.trace!, b.trace!);
  const turnCount = Math.max(a.trace!.turns.length, b.trace!.turns.length);
  for (let i = 0; i < turnCount; i++) {
    process.stdout.write(diffTurn(a.trace!.turns[i], b.trace!.turns[i], i + 1));
  }
}

async function main(): Promise<void> {
  const [pathA, pathB] = process.argv.slice(2);
  if (!pathA || !pathB) {
    console.error('Usage: tsx compare-votes.ts <trace1.json> <trace2.json>');
    process.exit(2);
  }
  const [a, b] = await Promise.all([loadVote(resolve(pathA)), loadVote(resolve(pathB))]);
  printVoteDiff(a, b);
}

main().catch(err => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

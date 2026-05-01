#!/usr/bin/env tsx
/**
 * CLI: load a fixture's .assertions.ts module, run its `expect` callback
 * against a JSON-encoded HarnessResult, exit with structured codes.
 *
 *   exit 0 — all assertions passed
 *   exit 1 — Tier 1 assertion failed (hard signal)
 *   exit 2 — Tier 2 assertion failed (ambiguous; may indicate prompt drift)
 *   exit 3 — usage / loader error
 *
 * Used by both modes:
 *   - CC Skill: parses subagent output → writes findings.json → invokes this
 *   - OpenRouter runner.ts: same call shape, single assertion semantics
 *
 * Usage: tsx assert-cli.ts <assertions.ts> <result.json>
 */

import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { harness, HarnessAssertionError } from './assertions.js';
import type { FixtureAssertions, HarnessResult } from './assertions.js';

async function loadAssertions(path: string): Promise<FixtureAssertions> {
  const url = pathToFileURL(resolve(path)).href;
  const mod = (await import(url)) as { default?: FixtureAssertions };
  if (!mod.default || typeof mod.default.expect !== 'function') {
    throw new Error(
      `Assertions module ${path} must default-export an object with an 'expect' function.`,
    );
  }
  return mod.default;
}

async function loadResult(path: string): Promise<HarnessResult> {
  const raw = await fs.readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`${path} must contain a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.findings !== undefined && !Array.isArray(obj.findings)) {
    throw new Error(`${path}: findings must be an array, got ${typeof obj.findings}`);
  }
  if (obj.toolCalls !== undefined && !Array.isArray(obj.toolCalls)) {
    throw new Error(`${path}: toolCalls must be an array, got ${typeof obj.toolCalls}`);
  }
  if (obj.turns !== undefined && typeof obj.turns !== 'number') {
    throw new Error(`${path}: turns must be a number, got ${typeof obj.turns}`);
  }
  return {
    findings: (obj.findings as HarnessResult['findings']) ?? [],
    toolCalls: (obj.toolCalls as string[]) ?? [],
    turns: (obj.turns as number) ?? 0,
  };
}

async function main(): Promise<void> {
  const [assertionsArg, resultArg] = process.argv.slice(2);
  if (!assertionsArg || !resultArg) {
    console.error('Usage: tsx assert-cli.ts <assertions.ts> <result.json>');
    process.exit(3);
  }

  let assertions: FixtureAssertions;
  let result: HarnessResult;
  try {
    [assertions, result] = await Promise.all([
      loadAssertions(assertionsArg),
      loadResult(resultArg),
    ]);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(3);
  }

  // Use process.exitCode + return rather than process.exit() so the JSON we
  // just wrote to stdout actually flushes before the process tears down —
  // process.exit() can truncate pending I/O (Node docs).
  try {
    assertions.expect(result, harness);
    process.stdout.write(
      JSON.stringify({
        ok: true,
        rule: assertions.rule,
        description: assertions.description,
        findings: result.findings.length,
        turns: result.turns,
      }) + '\n',
    );
    process.exitCode = 0;
    return;
  } catch (err) {
    if (err instanceof HarnessAssertionError) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          tier: err.tier,
          rule: assertions.rule,
          description: assertions.description,
          message: err.message,
          findings: result.findings.length,
          turns: result.turns,
        }) + '\n',
      );
      process.exitCode = err.tier === 2 ? 2 : 1;
      return;
    }
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  }
}

main();

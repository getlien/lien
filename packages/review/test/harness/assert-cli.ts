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
  const parsed = JSON.parse(raw) as Partial<HarnessResult>;
  return {
    findings: parsed.findings ?? [],
    toolCalls: parsed.toolCalls ?? [],
    turns: parsed.turns ?? 0,
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
    process.exit(0);
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
      process.exit(err.tier === 2 ? 2 : 1);
    }
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  }
}

main();

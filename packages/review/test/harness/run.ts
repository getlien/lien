#!/usr/bin/env tsx
/**
 * OpenRouter-mode CLI for the agent-rule harness.
 *
 * Walks fixtures under test/harness/fixtures/, runs each through the real
 * AgentReviewPlugin (Gemini via OpenRouter), evaluates assertions, exits
 * non-zero on failure.
 *
 * For free CC iteration mode, use the /test-harness skill instead.
 *
 * Flags:
 *   --rule <id>          run only fixtures under fixtures/<id>/
 *   --fixture <path>     run only this fixture
 *   --votes <k>          K-of-M voting per fixture (default 3)
 *   --calibrate <n>      run each fixture N times, report pass rate (the 9/10 bar)
 *   --json               emit machine-readable JSON instead of text
 *
 * Env: OPENROUTER_API_KEY required.
 */

import { promises as fs } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { FixtureAssertions } from './assertions.js';
import { vote, calibrate } from './voting.js';
import type { RunnerOptions } from './runner.js';
import { reportVote, reportCalibrate } from './reporter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, 'fixtures');

interface CliFlags {
  rule?: string;
  fixture?: string;
  votes: number;
  calibrate?: number;
  json: boolean;
  model?: string;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { votes: 3, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rule') flags.rule = argv[++i];
    else if (arg === '--fixture') flags.fixture = argv[++i];
    else if (arg === '--votes') flags.votes = parseInt(argv[++i], 10);
    else if (arg === '--calibrate') flags.calibrate = parseInt(argv[++i], 10);
    else if (arg === '--model') flags.model = argv[++i];
    else if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${arg}`);
      printUsage();
      process.exit(2);
    }
  }
  return flags;
}

function printUsage(): void {
  console.error(
    [
      'Usage: tsx run.ts [--rule <id>] [--fixture <path>] [--votes K] [--calibrate N] [--json]',
      '',
      '  Default: K=3 voting on every fixture under test/harness/fixtures/',
      '  --calibrate 10: runs N times and checks the 9/10 reliability bar',
      '  Env: OPENROUTER_API_KEY required',
    ].join('\n'),
  );
}

interface FixturePair {
  rule: string;
  name: string;
  fixturePath: string;
  assertionsPath: string;
}

async function discoverFixtures(flags: CliFlags): Promise<FixturePair[]> {
  if (flags.fixture) {
    const fixturePath = resolve(flags.fixture);
    const assertionsPath = fixturePath.replace(/\.fixture\.json$/, '.assertions.ts');
    return [
      {
        rule: basename(dirname(fixturePath)),
        name: basename(fixturePath, '.fixture.json'),
        fixturePath,
        assertionsPath,
      },
    ];
  }

  const ruleDirs = flags.rule
    ? [resolve(FIXTURES_ROOT, flags.rule)]
    : (await fs.readdir(FIXTURES_ROOT, { withFileTypes: true }))
        .filter(d => d.isDirectory())
        .map(d => resolve(FIXTURES_ROOT, d.name));

  const pairs: FixturePair[] = [];
  for (const ruleDir of ruleDirs) {
    let entries;
    try {
      entries = await fs.readdir(ruleDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.fixture.json')) continue;
      const fixturePath = resolve(ruleDir, entry);
      const assertionsPath = fixturePath.replace(/\.fixture\.json$/, '.assertions.ts');
      try {
        await fs.access(assertionsPath);
      } catch {
        console.error(`skip ${fixturePath} — no sibling .assertions.ts`);
        continue;
      }
      pairs.push({
        rule: basename(ruleDir),
        name: basename(fixturePath, '.fixture.json'),
        fixturePath,
        assertionsPath,
      });
    }
  }
  return pairs;
}

async function loadAssertions(path: string): Promise<FixtureAssertions> {
  const url = pathToFileURL(path).href;
  const mod = (await import(url)) as { default?: FixtureAssertions };
  if (!mod.default) throw new Error(`No default export in ${path}`);
  return mod.default;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY env required for OpenRouter mode.');
    console.error('For free iteration without an API key, use /test-harness in CC.');
    process.exit(2);
  }

  const fixtures = await discoverFixtures(flags);
  if (fixtures.length === 0) {
    console.error('No fixtures found.');
    process.exit(2);
  }

  const opts: RunnerOptions = { apiKey, model: flags.model };
  if (flags.model) console.error(`[harness] model: ${flags.model}`);

  let allPassed = true;
  let totalCost = 0;
  const jsonReport: unknown[] = [];

  for (const f of fixtures) {
    const assertions = await loadAssertions(f.assertionsPath);
    const label = `${f.rule}/${f.name}`;

    if (flags.calibrate) {
      const result = await calibrate(f.fixturePath, assertions, opts, flags.calibrate);
      totalCost += result.totalCost;
      if (!result.meetsReliabilityBar) allPassed = false;
      if (flags.json) {
        jsonReport.push({ label, mode: 'calibrate', result });
      } else {
        console.log(reportCalibrate(label, result));
      }
    } else {
      const k = assertions.votes ?? flags.votes;
      const result = await vote(f.fixturePath, assertions, opts, k);
      totalCost += result.totalCost;
      if (!result.agree || result.passes !== result.votes.length) allPassed = false;
      if (flags.json) {
        jsonReport.push({ label, mode: 'vote', result });
      } else {
        console.log(reportVote(label, result));
      }
    }
  }

  if (flags.json) {
    process.stdout.write(
      JSON.stringify({ allPassed, totalCost, fixtures: jsonReport }, null, 2) + '\n',
    );
  } else {
    console.log('');
    console.log(`Total cost: $${totalCost.toFixed(4)}`);
    if (!allPassed) {
      console.log(
        '\n⚠️  One or more fixtures failed. Iterate prompts via /test-harness (CC mode), then re-calibrate here.',
      );
    }
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

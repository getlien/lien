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
 *   --bail <n>           abort a fixture's calibration once N votes have failed
 *   --json               emit machine-readable JSON instead of text
 *   --trace <dir>        write per-vote trace JSON to <dir>/<rule>/<scenario>/vote-<N>.json
 *
 * Traces are ALWAYS written: with no `--trace`, every run dumps per-vote traces
 * to `.wip/traces/<UTC-timestamp>-<rule-or-fixture>/` (repo-root-relative,
 * gitignored) so "diagnose from an existing trace first" is always possible.
 *
 * Env: OPENROUTER_API_KEY required.
 */

import { promises as fs } from 'node:fs';
import { dirname, basename, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { FixtureAssertions } from './assertions.js';
import { vote, calibrate } from './voting.js';
import type { AssertedRun } from './voting.js';
import type { RunnerOptions } from './runner.js';
import { reportVote, reportCalibrate } from './reporter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, 'fixtures');

// Auto-load .env from the repo root so OPENROUTER_API_KEY can live there
// instead of the user's shell rc. Node's process.loadEnvFile() does not
// override variables that are already set, so an inline `OPENROUTER_API_KEY=…`
// still wins. Silently skip if no .env is present.
try {
  process.loadEnvFile(resolve(HERE, '../../../../.env'));
} catch {
  /* no .env at repo root — that's fine; rely on the inherited environment */
}

interface CliFlags {
  rule?: string;
  fixture?: string;
  votes: number;
  calibrate?: number;
  bail?: number;
  json: boolean;
  model?: string;
  traceDir?: string;
}

function requirePositiveInt(name: string, value: string | undefined): number {
  if (value === undefined) {
    console.error(`${name} requires a value`);
    process.exit(2);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`${name} must be a positive integer (got: ${value})`);
    process.exit(2);
  }
  return n;
}

function requireString(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    console.error(`${name} requires a value`);
    process.exit(2);
  }
  return value;
}

/**
 * Each value-taking flag's setter. Bool flags and `--help` are handled
 * inline in `parseFlags` since they don't follow the same shape.
 */
const VALUE_FLAG_SETTERS: Record<string, (f: CliFlags, value: string | undefined) => void> = {
  '--rule': (f, v) => {
    f.rule = requireString('--rule', v);
  },
  '--fixture': (f, v) => {
    f.fixture = requireString('--fixture', v);
  },
  '--votes': (f, v) => {
    f.votes = requirePositiveInt('--votes', v);
  },
  '--calibrate': (f, v) => {
    f.calibrate = requirePositiveInt('--calibrate', v);
  },
  '--bail': (f, v) => {
    f.bail = requirePositiveInt('--bail', v);
  },
  '--model': (f, v) => {
    f.model = requireString('--model', v);
  },
  '--trace': (f, v) => {
    f.traceDir = resolve(requireString('--trace', v));
  },
};

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { votes: 3, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    const setter = VALUE_FLAG_SETTERS[arg];
    if (!setter) {
      console.error(`Unknown flag: ${arg}`);
      printUsage();
      process.exit(2);
    }
    setter(flags, argv[++i]);
  }
  return flags;
}

function printUsage(): void {
  console.error(
    [
      'Usage: tsx run.ts [--rule <id>] [--fixture <path>] [--votes K] [--calibrate N] [--bail N] [--json] [--trace <dir>]',
      '',
      '  Default: K=3 voting on every fixture under test/harness/fixtures/',
      '  --calibrate 10: runs N times and checks the 9/10 reliability bar',
      '  --bail N:       abort a fixture calibration once N votes have failed',
      '  --trace <dir>:  write per-vote trace JSON to <dir>/<rule>/<scenario>/vote-<N>.json',
      '                  (defaults to .wip/traces/<timestamp>-<rule-or-fixture>/)',
      '  Env: OPENROUTER_API_KEY required',
    ].join('\n'),
  );
}

/**
 * The trace directory for this run. An explicit `--trace` wins; otherwise
 * traces persist under `.wip/traces/<UTC-timestamp>-<rule-or-fixture>/`
 * (repo-root-relative, gitignored) so the next "diagnose from a trace" is a
 * copy-paste away instead of requiring a fresh paid run. Computed once per run
 * so every fixture in the run shares one timestamped directory.
 */
function resolveTraceDir(flags: CliFlags): string {
  if (flags.traceDir) return flags.traceDir;
  const repoRoot = resolve(HERE, '../../../../');
  const stamp = new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
  const slug = flags.rule ?? (flags.fixture ? basename(flags.fixture, '.fixture.json') : 'all');
  return join(repoRoot, '.wip', 'traces', `${stamp}-${slug}`);
}

interface FixturePair {
  rule: string;
  name: string;
  fixturePath: string;
  assertionsPath: string;
}

function fixturePairFromPath(fixturePath: string): FixturePair {
  const assertionsPath = fixturePath.replace(/\.fixture\.json$/, '.assertions.ts');
  return {
    rule: basename(dirname(fixturePath)),
    name: basename(fixturePath, '.fixture.json'),
    fixturePath,
    assertionsPath,
  };
}

async function listRuleDirs(rule: string | undefined): Promise<string[]> {
  if (rule) return [resolve(FIXTURES_ROOT, rule)];
  const entries = await fs.readdir(FIXTURES_ROOT, { withFileTypes: true });
  return entries.filter(d => d.isDirectory()).map(d => resolve(FIXTURES_ROOT, d.name));
}

async function collectFixturesInDir(ruleDir: string): Promise<FixturePair[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(ruleDir);
  } catch {
    return [];
  }
  const pairs: FixturePair[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.fixture.json')) continue;
    const pair = fixturePairFromPath(resolve(ruleDir, entry));
    try {
      await fs.access(pair.assertionsPath);
    } catch {
      console.error(`skip ${pair.fixturePath} — no sibling .assertions.ts`);
      continue;
    }
    pairs.push(pair);
  }
  return pairs;
}

async function discoverFixtures(flags: CliFlags): Promise<FixturePair[]> {
  if (flags.fixture) {
    return [fixturePairFromPath(resolve(flags.fixture))];
  }
  const ruleDirs = await listRuleDirs(flags.rule);
  const pairs: FixturePair[] = [];
  for (const ruleDir of ruleDirs) {
    pairs.push(...(await collectFixturesInDir(ruleDir)));
  }
  return pairs;
}

async function loadAssertions(path: string): Promise<FixtureAssertions> {
  const url = pathToFileURL(path).href;
  const mod = (await import(url)) as { default?: FixtureAssertions };
  if (!mod.default) throw new Error(`No default export in ${path}`);
  return mod.default;
}

function requireApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY env required for OpenRouter mode.');
    console.error('For free iteration without an API key, use /test-harness in CC.');
    process.exit(2);
  }
  return apiKey;
}

interface FixtureOutcome {
  passed: boolean;
  cost: number;
  jsonEntry: unknown;
  text: string;
}

async function runOneFixture(
  f: FixturePair,
  opts: RunnerOptions,
  flags: CliFlags,
  traceDir: string,
): Promise<FixtureOutcome> {
  const assertions = await loadAssertions(f.assertionsPath);
  const label = `${f.rule}/${f.name}`;
  // A characterization fixture measures a known frontier — render it neutrally
  // and never let its miss gate the run's exit code.
  const characterization = assertions.tags?.includes('characterization') ?? false;
  const reportOpts = { characterization };

  if (flags.calibrate !== undefined) {
    const result = await calibrate(
      f.fixturePath,
      assertions,
      opts,
      flags.calibrate,
      undefined,
      flags.bail,
    );
    await writeTraces(traceDir, label, f.rule, f.name, result.runs);
    return {
      passed: characterization || result.meetsReliabilityBar,
      cost: result.totalCost,
      jsonEntry: { label, mode: 'calibrate', characterization, result },
      text: reportCalibrate(label, result, reportOpts),
    };
  }
  const k = assertions.votes ?? flags.votes;
  const result = await vote(f.fixturePath, assertions, opts, k);
  await writeTraces(traceDir, label, f.rule, f.name, result.votes);
  return {
    passed: characterization || (result.agree && result.passes === result.votes.length),
    cost: result.totalCost,
    jsonEntry: { label, mode: 'vote', characterization, result },
    text: reportVote(label, result, reportOpts),
  };
}

/**
 * Dump one JSON file per vote/run under <traceDir>/<rule>/<scenario>/.
 * Each file packages the vote's pass/fail outcome with its full trace
 * (rendered prompts + per-turn responses + tool calls) so iterating on
 * a failing prompt becomes "diff vote-N.json against vote-M.json".
 */
async function writeTraces(
  traceDir: string,
  label: string,
  rule: string,
  scenario: string,
  runs: AssertedRun[],
): Promise<void> {
  const outDir = join(traceDir, rule, scenario);
  await fs.mkdir(outDir, { recursive: true });
  await Promise.all(
    runs.map(async (run, i) => {
      const voteIndex = i + 1;
      const { trace, ...rest } = run.result;
      const dump = {
        label,
        voteIndex,
        passed: run.passed,
        failureMessage: run.failureMessage,
        failureTier: run.failureTier,
        cost: run.cost,
        trace,
        result: rest,
      };
      await fs.writeFile(
        join(outDir, `vote-${voteIndex}.json`),
        JSON.stringify(dump, null, 2) + '\n',
      );
    }),
  );
}

function printSummary(
  allPassed: boolean,
  totalCost: number,
  jsonReport: unknown[],
  flags: CliFlags,
  traceDir: string,
): void {
  if (flags.json) {
    process.stdout.write(
      JSON.stringify({ allPassed, totalCost, traceDir, fixtures: jsonReport }, null, 2) + '\n',
    );
    return;
  }
  console.log('');
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
  console.log(`Traces: ${traceDir}`);
  if (!allPassed) {
    console.log(
      '\n⚠️  One or more fixtures failed. Iterate prompts via /test-harness (CC mode), then re-calibrate here.',
    );
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const apiKey = requireApiKey();
  const fixtures = await discoverFixtures(flags);
  if (fixtures.length === 0) {
    console.error('No fixtures found.');
    process.exit(2);
  }

  const opts: RunnerOptions = { apiKey, model: flags.model };
  if (flags.model) console.error(`[harness] model: ${flags.model}`);

  // Resolve (and pre-create) the trace directory once so every fixture in this
  // run shares one timestamped folder, and print it up front so a follow-up
  // diagnose-from-trace is a copy-paste away.
  const traceDir = resolveTraceDir(flags);
  await fs.mkdir(traceDir, { recursive: true });
  console.error(`[harness] traces: ${traceDir}`);

  let allPassed = true;
  let totalCost = 0;
  const jsonReport: unknown[] = [];

  for (const f of fixtures) {
    const outcome = await runOneFixture(f, opts, flags, traceDir);
    if (!outcome.passed) allPassed = false;
    totalCost += outcome.cost;
    if (flags.json) jsonReport.push(outcome.jsonEntry);
    else console.log(outcome.text);
  }

  printSummary(allPassed, totalCost, jsonReport, flags, traceDir);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

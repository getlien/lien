#!/usr/bin/env tsx
/**
 * Deterministic `computeBlastRadius` baseline for a non-JS/TS fixture —
 * PR #981 (planted synthetic regression in `lien-review-testbed/python/`).
 *
 * Unlike the `.assertions.ts` corpus (which asserts on an agent's LLM output
 * via `run.ts`/`--calibrate`, real money per call), this checks a purely
 * deterministic, pre-computed signal: `computeBlastRadius` runs BEFORE the
 * agent is ever invoked (see `plugins/agent/index.ts`), so it can be
 * verified directly against the captured fixture with zero LLM spend and no
 * `OPENROUTER_API_KEY`. Deliberately named `.blast-radius.ts`, not
 * `.assertions.ts`, so `run.ts`'s fixture discovery (which pairs
 * `*.fixture.json` with a sibling `*.assertions.ts`) never picks this up —
 * it can't be swept into a paid `--calibrate` run by accident.
 *
 * Ground truth (verified by hand, `grep -n "check_required_fields(" -r
 * lien-review-testbed/python/pipeline/`): exactly 3 real call sites call
 * `check_required_fields` — `validate_record` (same file), `parse_raw_data`
 * (loader.py), `process_pipeline` (processor.py). The diff shifts its
 * collection-emptiness check from `== 0` to `<= 1` (boundary-change shape),
 * giving blast radius a changed function with real cross-file dependents.
 *
 * Result as of this fixture's capture: the dependency graph's fallback tier
 * — Python has no precise-tier resolver, see `dependency-graph.ts`'s
 * `resolveImportPath` (relative-import + `.ts/.tsx/.js/.jsx/.mts/.mjs` only)
 * — resolves all 3 direct callers correctly via the cross-package
 * symbol-match strategy (`addCrossPackageEdges`, matching `from
 * pipeline.validator import check_required_fields`). This is a CORRECT
 * baseline for THIS import shape, not a weak one. It says nothing about the
 * OOP method-call fallback (`addOopMethodEdges`) or same-namespace fallback
 * (`addSameNamespaceEdges`) — those need a class-method-call fixture (e.g.
 * PHP) to exercise. NOTE: if a future resolution change (routing through
 * @liendev/parser's primitives) regresses this specific case, this baseline
 * will flag it; if it *improves* recall on the harder OOP/namespace shapes
 * this fixture doesn't cover, that's expected and this file won't move.
 *
 * Regenerate the fixture:
 *   npx tsx packages/review/test/harness/capture-pr.ts 981 \
 *     packages/review/test/harness/fixtures/blast-radius/pr981-python-check-required-fields.fixture.json \
 *     --sha 51c32d23f08a84ab195bc85d6f366594229f96aa
 *
 * Usage: tsx pr981-python-check-required-fields.blast-radius.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildDependencyGraph } from '../../../../src/dependency-graph.js';
import { computeBlastRadius } from '../../../../src/blast-radius.js';
import type { BlastRadiusEntry, BlastRadiusReport } from '../../../../src/blast-radius.js';
import type { ReviewContext } from '../../../../src/plugin-types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, 'pr981-python-check-required-fields.fixture.json');

const SEED_FILEPATH = 'lien-review-testbed/python/pipeline/validator.py';
const SEED_SYMBOL = 'check_required_fields';

interface DependentPin {
  filepath: string;
  symbolName: string;
}

/** The 3 real (hand-verified) direct callers — the baseline this pins. */
const EXPECTED_DIRECT_DEPENDENTS: DependentPin[] = [
  { filepath: 'lien-review-testbed/python/pipeline/validator.py', symbolName: 'validate_record' },
  { filepath: 'lien-review-testbed/python/pipeline/processor.py', symbolName: 'process_pipeline' },
  { filepath: 'lien-review-testbed/python/pipeline/loader.py', symbolName: 'parse_raw_data' },
];

/** Total dependents (all hops, depth default 2) — a loose sanity bound on the transitive expansion. */
const EXPECTED_TOTAL_DEPENDENTS = 12;
const EXPECTED_RISK_LEVEL = 'high';

function keyOf(d: DependentPin): string {
  return `${d.filepath}::${d.symbolName}`;
}

function loadReport(): BlastRadiusReport {
  const ctx = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ReviewContext;
  const graph = buildDependencyGraph(ctx.repoChunks!);
  return computeBlastRadius(ctx.chunks, graph, ctx.repoChunks!, { workspaceRoot: ctx.repoRootDir });
}

function findSeedEntry(report: BlastRadiusReport): BlastRadiusEntry | undefined {
  return report.entries.find(
    e => e.seed.filepath === SEED_FILEPATH && e.seed.symbolName === SEED_SYMBOL,
  );
}

/** Set-difference the actual hop=1 dependents against the pinned baseline. Returns failure messages (empty = pass). */
function checkDirectDependents(entry: BlastRadiusEntry): string[] {
  const actualDirect = entry.dependents
    .filter(d => d.hops === 1)
    .map(d => ({ filepath: d.filepath, symbolName: d.symbolName }));
  const actualKeys = new Set(actualDirect.map(keyOf));
  const expectedKeys = new Set(EXPECTED_DIRECT_DEPENDENTS.map(keyOf));

  const missing = EXPECTED_DIRECT_DEPENDENTS.filter(d => !actualKeys.has(keyOf(d)));
  const extra = actualDirect.filter(d => !expectedKeys.has(keyOf(d)));

  const failures: string[] = [];
  if (missing.length > 0) {
    failures.push(`missing expected direct dependent(s): ${missing.map(keyOf).join(', ')}`);
  }
  if (extra.length > 0) {
    failures.push(`unexpected extra direct dependent(s): ${extra.map(keyOf).join(', ')}`);
  }
  return failures;
}

/** Loose sanity bounds on the transitive expansion + risk classification. Returns failure messages (empty = pass). */
function checkTotalsAndRisk(entry: BlastRadiusEntry): string[] {
  const failures: string[] = [];
  if (entry.dependents.length !== EXPECTED_TOTAL_DEPENDENTS) {
    failures.push(
      `total dependent count drifted — expected ${EXPECTED_TOTAL_DEPENDENTS}, got ${entry.dependents.length}`,
    );
  }
  if (entry.risk.level !== EXPECTED_RISK_LEVEL) {
    failures.push(
      `risk level drifted — expected '${EXPECTED_RISK_LEVEL}', got '${entry.risk.level}' (${entry.risk.reasoning.join('; ')})`,
    );
  }
  return failures;
}

function main(): void {
  const entry = findSeedEntry(loadReport());
  if (!entry) {
    console.error(`FAIL: no blast-radius entry for seed ${SEED_SYMBOL}@${SEED_FILEPATH}.`);
    process.exitCode = 1;
    return;
  }

  const failures = [...checkDirectDependents(entry), ...checkTotalsAndRisk(entry)];
  if (failures.length > 0) {
    console.error(`FAIL:\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }

  const directCount = entry.dependents.filter(d => d.hops === 1).length;
  console.log(
    `OK — ${SEED_SYMBOL}@${SEED_FILEPATH}: ${directCount} direct dependents match baseline, ` +
      `${entry.dependents.length} total, risk=${entry.risk.level}.`,
  );
}

main();

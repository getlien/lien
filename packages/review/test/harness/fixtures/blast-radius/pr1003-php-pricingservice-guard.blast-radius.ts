#!/usr/bin/env tsx
/**
 * Deterministic `computeBlastRadius` baseline for a PHP fixture — PR #1003
 * (a small guard added to `lien-review-testbed/php/app/Services/PricingService.php`).
 *
 * Unlike the `.assertions.ts` corpus (which asserts on an agent's LLM output
 * via `run.ts`/`--calibrate`, real money per call), this checks a purely
 * deterministic, pre-computed signal: `computeBlastRadius` runs BEFORE the
 * agent is ever invoked (see `plugins/agent/index.ts`), so it can be
 * verified directly against the captured fixture with zero LLM spend and no
 * `OPENROUTER_API_KEY`. Deliberately named `.blast-radius.ts`, not
 * `.assertions.ts` (see `pr981-python-check-required-fields.blast-radius.ts`
 * for the full rationale) — `run.ts` never sweeps this into a paid
 * `--calibrate` run.
 *
 * WHY THIS FIXTURE EXISTS (issue #994 Phase 5): `PricingService`'s diff
 * touches its class-level chunk (see `chunk.metadata.exports` for a PHP
 * class chunk lists the CLASS name, not its methods), so blast-radius seeds
 * on `{filepath: PricingService.php, symbolName: 'PricingService'}` —
 * `isSeedCandidate` (blast-radius.ts) excludes method chunks whenever their
 * class is the thing that's actually exported, which is ALWAYS the case for
 * PHP methods, so a changed PHP class is *structurally* the only kind of PHP
 * seed blast-radius ever produces, never one of its methods. Every real
 * consumer of `PricingService` references it via constructor-injected
 * property (`private readonly PricingService $pricingService`), never a
 * literal `new PricingService(...)` or any other call site literally named
 * `PricingService` — so BEFORE #994 Phase 5, `getCallers` found zero
 * call-site matches and blast-radius reported `risk: low, dependents: []` on
 * a symbol with real, verified dependents. Confirmed empirically against
 * this exact fixture on main@099c1d78 (pre-Phase-5): zero dependents, risk
 * "low", reasoning `[]`.
 *
 * Ground truth (verified by hand, `grep -rln "PricingService"
 * lien-review-testbed/php`): 4 other files reference `PricingService`.
 * Exactly 2 do so via an explicit `use App\Services\PricingService;` import
 * (`ProductController.php`, `OrderController.php`) — these are recovered by
 * the new import-only fallback (`dependency-graph.ts`'s
 * `buildImportOnlyEdges`), tagged `provenance: 'import-only'`. The other 2
 * (`OrderService.php`, `CheckoutService.php`) are in the SAME NAMESPACE
 * (`App\Services`) as `PricingService` and reference it with NO explicit
 * import at all (PHP same-namespace implicit resolution) — `getCallers` has
 * no verified import to key off for those two, so they remain a KNOWN,
 * documented gap (not recovered by this phase; would need a call-site- and
 * import-free "same-namespace, no evidence" fallback, which was deliberately
 * NOT added — see `dependency-graph.ts`'s module doc on why extending
 * `addSameNamespaceEdges` to run without any call-site match at all was
 * rejected as too weak a signal on its own).
 *
 * Regenerate the fixture:
 *   npx tsx packages/review/test/harness/capture-pr.ts 1003 \
 *     packages/review/test/harness/fixtures/blast-radius/pr1003-php-pricingservice-guard.fixture.json \
 *     --sha 77820895632948747e1a95e2388549c8f5555616
 *
 * Usage: tsx pr1003-php-pricingservice-guard.blast-radius.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildDependencyGraph } from '../../../../src/dependency-graph.js';
import { computeBlastRadius } from '../../../../src/blast-radius.js';
import type { BlastRadiusEntry, BlastRadiusReport } from '../../../../src/blast-radius.js';
import type { ReviewContext } from '../../../../src/plugin-types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, 'pr1003-php-pricingservice-guard.fixture.json');

const SEED_FILEPATH = 'lien-review-testbed/php/app/Services/PricingService.php';
const SEED_SYMBOL = 'PricingService';

interface DependentPin {
  filepath: string;
  symbolName: string;
  provenance: string;
}

/** The 2 real (hand-verified) direct dependents recoverable via import-only edges. */
const EXPECTED_DIRECT_DEPENDENTS: DependentPin[] = [
  {
    filepath: 'lien-review-testbed/php/app/Http/Controllers/ProductController.php',
    symbolName: 'ProductController',
    provenance: 'import-only',
  },
  {
    filepath: 'lien-review-testbed/php/app/Http/Controllers/OrderController.php',
    symbolName: 'OrderController',
    provenance: 'import-only',
  },
];

const EXPECTED_RISK_LEVEL = 'medium';

function keyOf(d: { filepath: string; symbolName: string }): string {
  return `${d.filepath}::${d.symbolName}`;
}

function loadReport(): BlastRadiusReport {
  const ctx = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ReviewContext;
  const graph = buildDependencyGraph(ctx.repoChunks!, ctx.repoRootDir);
  return computeBlastRadius(ctx.chunks, graph, ctx.repoChunks!, { workspaceRoot: ctx.repoRootDir });
}

function findSeedEntry(report: BlastRadiusReport): BlastRadiusEntry | undefined {
  return report.entries.find(
    e => e.seed.filepath === SEED_FILEPATH && e.seed.symbolName === SEED_SYMBOL,
  );
}

/** Set-difference the actual hop=1 dependents against the pinned baseline, including provenance. Returns failure messages (empty = pass). */
function checkDirectDependents(entry: BlastRadiusEntry): string[] {
  const actualDirect = entry.dependents.filter(d => d.hops === 1);
  const actualKeys = new Set(actualDirect.map(keyOf));
  const expectedKeys = new Set(EXPECTED_DIRECT_DEPENDENTS.map(keyOf));

  const missing = EXPECTED_DIRECT_DEPENDENTS.filter(d => !actualKeys.has(keyOf(d)));
  const extra = actualDirect.filter(d => !expectedKeys.has(keyOf(d)));

  const failures: string[] = [];
  if (missing.length > 0) {
    failures.push(`missing expected direct dependent(s): ${missing.map(keyOf).join(', ')}`);
  }
  if (extra.length > 0) {
    failures.push(`unexpected extra direct dependent(s): ${extra.map(d => keyOf(d)).join(', ')}`);
  }

  for (const expected of EXPECTED_DIRECT_DEPENDENTS) {
    const actual = actualDirect.find(d => keyOf(d) === keyOf(expected));
    if (actual && actual.provenance !== expected.provenance) {
      failures.push(
        `${keyOf(expected)}: expected provenance '${expected.provenance}', got '${actual.provenance}'`,
      );
    }
  }

  return failures;
}

function checkRisk(entry: BlastRadiusEntry): string[] {
  if (entry.risk.level !== EXPECTED_RISK_LEVEL) {
    return [
      `risk level drifted — expected '${EXPECTED_RISK_LEVEL}', got '${entry.risk.level}' (${entry.risk.reasoning.join('; ')})`,
    ];
  }
  return [];
}

function main(): void {
  const entry = findSeedEntry(loadReport());
  if (!entry) {
    console.error(`FAIL: no blast-radius entry for seed ${SEED_SYMBOL}@${SEED_FILEPATH}.`);
    process.exitCode = 1;
    return;
  }

  const failures = [...checkDirectDependents(entry), ...checkRisk(entry)];
  if (failures.length > 0) {
    console.error(`FAIL:\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `OK — ${SEED_SYMBOL}@${SEED_FILEPATH}: ${entry.dependents.length} direct dependents ` +
      `(all import-only, PRE-#994-Phase-5 this was 0), risk=${entry.risk.level}.`,
  );
}

main();

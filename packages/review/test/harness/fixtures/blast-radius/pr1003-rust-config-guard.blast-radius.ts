#!/usr/bin/env tsx
/**
 * Deterministic `computeBlastRadius` baseline for a Rust fixture — PR #1003
 * (a tightened `max_depth` bound in `lien-review-testbed/rust/src/config.rs`).
 *
 * See `pr981-python-check-required-fields.blast-radius.ts` for why this file
 * exists and why it's named `.blast-radius.ts` (not `.assertions.ts` — never
 * swept into a paid `--calibrate` run).
 *
 * THIS FIXTURE PINS A KNOWN GAP, NOT A FIX — read before "improving" it.
 *
 * `Config` (the struct) is blast-radius's seed here for the same structural
 * reason as the PHP `PricingService` fixture: `config.rs`'s diff touches the
 * struct+impl's own chunk, `isSeedCandidate` excludes its methods (`load`,
 * `get`, `validate`, `default_config` aren't top-level exports), so `Config`
 * is the only seed this diff can produce. `cache.rs`, `analyzer.rs`,
 * `parser.rs`, `reporter.rs`, and `main.rs` all genuinely reference `Config`
 * (`use crate::config::Config;` + either a type-hinted parameter or a
 * `Config::load(...)`/`Config::default_config()` call) — real, verified
 * dependents by any reasonable definition.
 *
 * Measured BOTH before and after #994 Phase 5 on this exact fixture: ZERO
 * dependents, `risk: low, reasoning: []`, in both cases — Phase 5's
 * import-only fallback (which fixed the equivalent PHP case, see
 * `pr1003-php-pricingservice-guard.blast-radius.ts`) does NOT recover this
 * one. Root cause, confirmed directly against `@liendev/parser`'s
 * `importMatchesTarget` (NOT this package's code):
 * `lien-review-testbed/rust/` nests each language's sample crate 2
 * directories below the repo root, so a bare Rust module specifier like
 * `config` (from `use crate::config::Config;`, recorded as
 * `importedSymbols: { config: ['Config'] }`) needs to match against
 * `lien-review-testbed/rust/src/config` — 3 leading path segments before the
 * bare name. `matchesAtBoundaryPrecise`'s `maxLeadingSegments: 1` cap (the
 * deliberate #868/#883 boundary for a bare specifier resolving via a single
 * `src/`-style prefix) rejects that as too deep, so `chunkImportMaps` (this
 * package's own verified-import index, `dependency-graph.ts`) never
 * populates an entry for ANY cross-file Rust reference in this testbed at
 * all — confirmed identically reproducible by calling parser's own
 * `findDependents(chunks, 'lien-review-testbed/rust/src/config.rs', ...,
 * 'Config', 1)` directly: same zero-dependent result, so this is a
 * pre-existing, ALREADY-shared parser-level limitation, not something Phase
 * 5 introduced or could fix by routing through parser more thoroughly — it's
 * the shared primitive itself that's capped for this depth. Almost certainly
 * a testbed-structure artifact rather than a real-world Rust concern (a
 * typical crate's `src/` sits 0-1 directories from its own repo root, not
 * 2+), but this fixture's job is to pin the measured truth, not the
 * probable-in-practice case.
 *
 * Do NOT "fix" this fixture by loosening `maxLeadingSegments` to make it
 * pass — that primitive is shared by every other language's import
 * resolution and was deliberately capped at 1 to avoid false hubs (see its
 * own doc comment in `path-matching.ts`). If this gap is worth closing,
 * it's a parser-level follow-up (loosen the cap for `crate::`-style bare
 * specifiers specifically, or thread the actual crate root depth through),
 * not a review-package workaround.
 *
 * Regenerate the fixture:
 *   npx tsx packages/review/test/harness/capture-pr.ts 1003 \
 *     packages/review/test/harness/fixtures/blast-radius/pr1003-rust-config-guard.fixture.json \
 *     --sha 77820895632948747e1a95e2388549c8f5555616
 *
 * Usage: tsx pr1003-rust-config-guard.blast-radius.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildDependencyGraph } from '../../../../src/dependency-graph.js';
import { computeBlastRadius } from '../../../../src/blast-radius.js';
import type { BlastRadiusEntry, BlastRadiusReport } from '../../../../src/blast-radius.js';
import type { ReviewContext } from '../../../../src/plugin-types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, 'pr1003-rust-config-guard.fixture.json');

const SEED_FILEPATH = 'lien-review-testbed/rust/src/config.rs';
const SEED_SYMBOL = 'Config';

const EXPECTED_DEPENDENT_COUNT = 0;
const EXPECTED_RISK_LEVEL = 'low';

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

function main(): void {
  const report = loadReport();
  const entry = findSeedEntry(report);

  // No entry at all is ALSO consistent with the pinned "zero dependents"
  // baseline: computeBlastRadius only emits an entry once its seed has been
  // through getCallersTransitive, but an empty result for every seed can
  // leave `entries` empty entirely depending on how seeds got ranked. Handle
  // both shapes rather than asserting an entry must exist.
  if (!entry) {
    console.log(
      `OK — no blast-radius entry for ${SEED_SYMBOL}@${SEED_FILEPATH} ` +
        `(consistent with the pinned ${EXPECTED_DEPENDENT_COUNT}-dependent baseline).`,
    );
    return;
  }

  const failures: string[] = [];
  if (entry.dependents.length !== EXPECTED_DEPENDENT_COUNT) {
    failures.push(
      `dependent count drifted — expected ${EXPECTED_DEPENDENT_COUNT}, got ${entry.dependents.length} ` +
        `(${entry.dependents.map(d => `${d.filepath}::${d.symbolName} [${d.provenance}]`).join(', ')}). ` +
        `If this is a GENUINE improvement (the parser-level path-depth cap described in this file's ` +
        `module doc got fixed), update this fixture's expectations — don't just silence the failure.`,
    );
  }
  if (entry.risk.level !== EXPECTED_RISK_LEVEL) {
    failures.push(
      `risk level drifted — expected '${EXPECTED_RISK_LEVEL}', got '${entry.risk.level}' (${entry.risk.reasoning.join('; ')})`,
    );
  }

  if (failures.length > 0) {
    console.error(`FAIL:\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `OK — ${SEED_SYMBOL}@${SEED_FILEPATH}: ${entry.dependents.length} dependents, risk=${entry.risk.level} ` +
      `(pinned known-gap baseline — see module doc for the parser-level path-depth cap this is blocked on).`,
  );
}

main();

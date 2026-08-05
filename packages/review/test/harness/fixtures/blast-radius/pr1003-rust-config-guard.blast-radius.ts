#!/usr/bin/env tsx
/**
 * Deterministic `computeBlastRadius` baseline for a Rust fixture — PR #1003
 * (a tightened `max_depth` bound in `lien-review-testbed/rust/src/config.rs`).
 *
 * See `pr981-python-check-required-fields.blast-radius.ts` for why this file
 * exists and why it's named `.blast-radius.ts` (not `.assertions.ts` — never
 * swept into a paid `--calibrate` run).
 *
 * THIS FIXTURE PINS A PARTIALLY-RECOVERED KNOWN GAP, NOT A FIX — read before
 * "improving" it further.
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
 * Measured immediately after #994 Phase 5 on this exact fixture: ZERO
 * dependents, `risk: low, reasoning: []` — Phase 5's import-only fallback
 * (which fixed the equivalent PHP case, see
 * `pr1003-php-pricingservice-guard.blast-radius.ts`) did NOT recover any of
 * the 5. Root cause, confirmed directly against `@liendev/parser`'s
 * `importMatchesTarget`: `lien-review-testbed/rust/` nests each language's
 * sample crate 2 directories below the repo root, so a bare Rust module
 * specifier like `config` (from `use crate::config::Config;`, recorded as
 * `importedSymbols: { config: ['Config'] }`) needs to match against
 * `lien-review-testbed/rust/src/config` — 3 leading path segments before the
 * bare name. `matchesAtBoundaryPrecise`'s `maxLeadingSegments: 1` cap (the
 * deliberate #868/#883 boundary for a bare specifier resolving via a single
 * `src/`-style prefix) rejects that as too deep, so `chunkImportMaps` (this
 * package's own verified-import index, `dependency-graph.ts`) never
 * populates an entry for any `use crate::config::Config;`-style reference in
 * this testbed. This part of the gap is STILL present today (confirmed
 * against the current fixture below) — a testbed-structure artifact rather
 * than a real-world Rust concern (a typical crate's `src/` sits 0-1
 * directories from its own repo root, not 2+), but this fixture's job is to
 * pin the measured truth, not the probable-in-practice case.
 *
 * ONE of the 5 has since been recovered — `main.rs`, and only `main.rs`,
 * because it's the single file in this crate that DECLARES the module
 * (`mod config;`, required exactly once per Rust's module tree) rather than
 * just referencing it (`use crate::config::Config;`, what the other 4 do).
 * `mod config;`-derived specifiers got single-file semantics in an unrelated
 * follow-up (rust-mod-single-file-semantics): the raw specifier now records
 * as the FULL sibling-relative path (`lien-review-testbed/rust/src/config`,
 * from `chunk.metadata.imports` — verified directly against this fixture),
 * not a bare `config` needing the same capped multi-segment resolution `use`
 * imports go through. That full path resolves as a trivial match against
 * `lien-review-testbed/rust/src/config.rs` via the RAW-imports fallback
 * (`resolveRequireOnlyFallback` — "not gated to Ruby specifically", see
 * `dependency-graph.ts`'s module doc), so `main.rs` now surfaces with
 * `provenance: 'require-only'`. `cache.rs`/`analyzer.rs`/`parser.rs`/
 * `reporter.rs` never declare `mod config;` (only `main.rs`, the crate root,
 * does), so this fix cannot reach them — they remain capped exactly as
 * before.
 *
 * Do NOT "fix" the remaining 4/5 gap by loosening `maxLeadingSegments` to
 * make it pass — that primitive is shared by every other language's import
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

import { buildDependencyGraph } from '@liendev/parser';
import { computeBlastRadius } from '../../../../src/blast-radius.js';
import type { BlastRadiusEntry, BlastRadiusReport } from '../../../../src/blast-radius.js';
import type { ReviewContext } from '../../../../src/plugin-types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, 'pr1003-rust-config-guard.fixture.json');

const SEED_FILEPATH = 'lien-review-testbed/rust/src/config.rs';
const SEED_SYMBOL = 'Config';

/** The 1 of 5 real dependents recovered so far — see module doc. */
const EXPECTED_DEPENDENT_COUNT = 1;
const EXPECTED_DEPENDENT_FILEPATH = 'lien-review-testbed/rust/src/main.rs';
const EXPECTED_DEPENDENT_PROVENANCE = 'require-only';
const EXPECTED_RISK_LEVEL = 'medium';

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

/** Set-difference the single pinned dependent against the actual one dependent (count checked by the caller). Returns failure messages (empty = pass). */
function checkDependent(entry: BlastRadiusEntry): string[] {
  if (entry.dependents.length !== EXPECTED_DEPENDENT_COUNT) {
    return [
      `dependent count drifted — expected ${EXPECTED_DEPENDENT_COUNT}, got ${entry.dependents.length} ` +
        `(${entry.dependents.map(d => `${d.filepath}::${d.symbolName} [${d.provenance}]`).join(', ')}). ` +
        "If this is a GENUINE improvement (one of the 4 remaining 'use crate::config::Config;' " +
        "sites described in this file's module doc got recovered too), update this fixture's " +
        "expectations — don't just silence the failure.",
    ];
  }

  const [dependent] = entry.dependents;
  const failures: string[] = [];
  if (dependent.filepath !== EXPECTED_DEPENDENT_FILEPATH) {
    failures.push(
      `dependent identity drifted — expected '${EXPECTED_DEPENDENT_FILEPATH}', got '${dependent.filepath}'`,
    );
  }
  if (dependent.provenance !== EXPECTED_DEPENDENT_PROVENANCE) {
    failures.push(
      `dependent provenance drifted — expected '${EXPECTED_DEPENDENT_PROVENANCE}', got '${dependent.provenance}'`,
    );
  }
  return failures;
}

/** Loose sanity bound on the risk classification. Returns failure messages (empty = pass). */
function checkRisk(entry: BlastRadiusEntry): string[] {
  if (entry.risk.level !== EXPECTED_RISK_LEVEL) {
    return [
      `risk level drifted — expected '${EXPECTED_RISK_LEVEL}', got '${entry.risk.level}' (${entry.risk.reasoning.join('; ')})`,
    ];
  }
  return [];
}

function main(): void {
  const report = loadReport();
  const entry = findSeedEntry(report);

  if (!entry) {
    console.error(
      `FAIL: no blast-radius entry for ${SEED_SYMBOL}@${SEED_FILEPATH} — expected ` +
        `${EXPECTED_DEPENDENT_COUNT} dependent (${EXPECTED_DEPENDENT_FILEPATH}).`,
    );
    process.exitCode = 1;
    return;
  }

  const failures = [...checkDependent(entry), ...checkRisk(entry)];
  if (failures.length > 0) {
    console.error(`FAIL:\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `OK — ${SEED_SYMBOL}@${SEED_FILEPATH}: ${entry.dependents.length} dependent, risk=${entry.risk.level} ` +
      `(pinned partial-recovery baseline — see module doc for the 4/5 gap still blocked on the ` +
      `parser-level path-depth cap).`,
  );
}

main();

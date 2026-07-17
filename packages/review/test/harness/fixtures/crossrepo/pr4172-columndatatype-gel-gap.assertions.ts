/**
 * drizzle-team/drizzle-orm PR #4172 ("Gel dialect") — ColumnDataType gains 6
 * Gel/EdgeDB temporal variants (`dateDuration`, `duration`, `relDuration`,
 * `localTime`, `localDate`, `localDateTime`) in `drizzle-orm/src/column-builder.ts`,
 * but all FOUR downstream schema-integration packages'
 * `columnToSchema` if-chains (`drizzle-arktype/src/column.ts`,
 * `drizzle-zod/src/column.ts`, `drizzle-valibot/src/column.ts`,
 * `drizzle-typebox/src/column.ts`) still only branch on the ORIGINAL 9
 * members (`array`, `number`, `bigint`, `boolean`, `date`, `string`, `json`,
 * `custom`, `buffer`) — none was ever updated for the 6 new ones. A Gel
 * column of one of these types silently falls through every package's final
 * `if (!schema) schema = type.unknown;` (or that package's equivalent),
 * degrading to no real runtime validation instead of a proper schema.
 *
 * REAL, LIVE bug — ground-truthed directly against drizzle-orm's `main` HEAD
 * (verified 2026-07-16 via `gh api repos/drizzle-team/drizzle-orm/contents/
 * <path>?ref=<sha>` for all four downstream files + column-builder.ts). No
 * open GitHub issue found describing it (`gh search issues` for "arktype
 * gel", "arktype duration", "drizzle-arktype unknown" all empty) —
 * ground-truthed by direct code cross-reference, not a linked fix commit.
 * Reported upstream: drizzle-team/drizzle-orm#6027 (filed 2026-07-17,
 * re-verified against main HEAD — still `9d6453215d18705986c2081124437bb6a03fb943`,
 * unchanged since the 2026-07-16 ground-truth capture — immediately before
 * filing).
 *
 * CAPTURE NOTE (why this fixture is hand-trimmed, not `capture-pr.ts`'d
 * wholesale): PR #4172's raw diff is ~23,200 additions across 104 files (a
 * whole new SQL dialect implementation) — `gh pr diff` exceeds GitHub's
 * 20,000-line API limit, and even a `--sha`-forced local-diff capture would
 * embed all 104 files' patches plus a ~10.6K-chunk repo corpus (a ~47MB
 * fixture, mostly irrelevant to this bug shape) — far past the harness
 * README's "<500 changed lines" guidance. This fixture instead carries:
 *   - `pr.patches`: ONLY the real, unmodified diff hunks touching
 *     `column-builder.ts`'s `ColumnDataType`/`Dialect`/`BuildColumn`/
 *     `BuildIndexColumn`/`ChangeColumnTableName` (verbatim from the PR).
 *   - `chunks`/`repoChunks`: the REAL current-HEAD content of exactly 5
 *     files — `column-builder.ts` (post-PR) plus the four downstream
 *     `column.ts` files — fetched via `gh api
 *     repos/drizzle-team/drizzle-orm/contents/<path>?ref=<sha>` and
 *     AST-chunked for real via `performChunkOnlyIndex` (native parser
 *     built), NOT hand-fabricated chunk objects.
 *   - `pr.owner`/`repo`/pullNumber/baseSha/headSha are the real PR's
 *     (drizzle-team/drizzle-orm#4172, base c27a9f24…, head 3fcc2db5…,
 *     confirmed via `gh api repos/drizzle-team/drizzle-orm/pulls/4172`).
 *   - `config.incompleteHandlingPass: true` — baked directly into the
 *     fixture's `ReviewContext`, NOT an external env var. This pins the
 *     canary to the loop-on configuration using an EXISTING mechanism —
 *     `isIncompleteHandlingPassEnabled()` (`incomplete-handling-pass.ts`)
 *     checks `config?.incompleteHandlingPass === true` BEFORE falling back
 *     to `LIEN_INCOMPLETE_PASS=on`, and `runFixture` (`runner.ts`) already
 *     spreads `ctx.config` straight into the plugin's config. No harness
 *     code changes were needed or made to support this — the fixture-level
 *     `config` field the harness already threads through was sufficient.
 *     Verified for free via `build-prompts.ts` against this exact fixture
 *     with NO env vars set: `incompleteHandlingPass.fires: true`. Replaying
 *     `run.ts --fixture .../pr4172-columndatatype-gel-gap.fixture.json`
 *     therefore reproduces the loop-arm result below with no external
 *     env-var setup required.
 *
 * REGENERATE (fixture JSON is gitignored, per this harness's convention —
 * see README's "Cross-repo corpus" section). This is a hand-trim, not a
 * plain `capture-pr.ts` invocation (see CAPTURE NOTE above), so the exact
 * recipe is the following self-contained script — save as a scratch .ts
 * file (e.g. `.wip/capture-drizzle4172.ts`, gitignored, do not commit) and
 * run with `npx tsx` from the repo root (native parser must be built first:
 * `npm run build:native -w @liendev/parser-native`):
 *
 * ```ts
 * import { promises as fs } from 'node:fs';
 * import { execSync } from 'node:child_process';
 * import { dirname, join } from 'node:path';
 * import { performChunkOnlyIndex } from '@liendev/parser';
 * import { runComplexityAnalysis } from '../../packages/review/src/analysis.js';
 * import { silentLogger } from '../../packages/review/src/test-helpers.js';
 * import { saveFixture } from '../../packages/review/test/harness/fixture-loader.js';
 *
 * const SNAPSHOT_DIR = '/tmp/drizzle4172-snapshot';
 * const OUTPUT_PATH =
 *   'packages/review/test/harness/fixtures/crossrepo/pr4172-columndatatype-gel-gap.fixture.json';
 * const REF = '9d6453215d18705986c2081124437bb6a03fb943'; // drizzle-orm main, 2026-07-16
 * const FILES = [
 *   'drizzle-orm/src/column-builder.ts',
 *   'drizzle-arktype/src/column.ts',
 *   'drizzle-zod/src/column.ts',
 *   'drizzle-valibot/src/column.ts',
 *   'drizzle-typebox/src/column.ts',
 * ];
 * const CHANGED_FILE = FILES[0];
 *
 * // Real diff hunk, `git diff c27a9f2477175a444efdb4012f50ad0894b22026..
 * // 3fcc2db5b1351bafd2632fa20f7527713b3992e7 -- drizzle-orm/src/column-builder.ts`
 * // against a real clone (or `git fetch origin refs/pull/4172/head` first if
 * // squash-merge history has aged the branch tip out of default refs — same
 * // gotcha as this README's other crossrepo fixtures).
 * const COLUMN_BUILDER_PATCH = `diff --git a/drizzle-orm/src/column-builder.ts b/drizzle-orm/src/column-builder.ts
 * index 6d6dfeeb..1cc4c5ae 100644
 * --- a/drizzle-orm/src/column-builder.ts
 * +++ b/drizzle-orm/src/column-builder.ts
 * @@ -1,5 +1,6 @@
 *  import { entityKind } from '~/entity.ts';
 *  import type { Column } from './column.ts';
 * +import type { GelColumn, GelExtraConfigColumn } from './gel-core/index.ts';
 *  import type { MySqlColumn } from './mysql-core/index.ts';
 *  import type { ExtraConfigColumn, PgColumn, PgSequenceOptions } from './pg-core/index.ts';
 *  import type { SingleStoreColumn } from './singlestore-core/index.ts';
 * @@ -16,9 +17,15 @@ export type ColumnDataType =
 *  \t| 'date'
 *  \t| 'bigint'
 *  \t| 'custom'
 * -\t| 'buffer';
 * +\t| 'buffer'
 * +\t| 'dateDuration'
 * +\t| 'duration'
 * +\t| 'relDuration'
 * +\t| 'localTime'
 * +\t| 'localDate'
 * +\t| 'localDateTime';
 *
 * -export type Dialect = 'pg' | 'mysql' | 'sqlite' | 'singlestore' | 'common';
 * +export type Dialect = 'pg' | 'mysql' | 'sqlite' | 'singlestore' | 'common' | 'gel';
 *
 *  export type GeneratedStorageMode = 'virtual' | 'stored';
 *
 * @@ -356,11 +363,18 @@ export type BuildColumn<
 *  \t\t\t\t>
 *  \t\t\t>
 *  \t\t>
 * +\t: TDialect extends 'gel' ? GelColumn<
 * +\t\t\tMakeColumnConfig<TBuilder['_'], TTableName>,
 * +\t\t\t{},
 * +\t\t\tSimplify<Omit<TBuilder['_'], keyof MakeColumnConfig<TBuilder['_'], TTableName> | 'brand' | 'dialect'>>
 * +\t\t>
 *  \t: never;
 *
 *  export type BuildIndexColumn<
 *  \tTDialect extends Dialect,
 * -> = TDialect extends 'pg' ? ExtraConfigColumn : never;
 * +> = TDialect extends 'pg' ? ExtraConfigColumn
 * +\t: TDialect extends 'gel' ? GelExtraConfigColumn
 * +\t: never;
 *
 *  // TODO
 *  // try to make sql as well + indexRaw
 * @@ -398,4 +412,5 @@ export type ChangeColumnTableName<TColumn extends Column, TAlias extends string,
 *  \t\t: TDialect extends 'mysql' ? MySqlColumn<MakeColumnConfig<TColumn['_'], TAlias>>
 *  \t\t: TDialect extends 'singlestore' ? SingleStoreColumn<MakeColumnConfig<TColumn['_'], TAlias>>
 *  \t\t: TDialect extends 'sqlite' ? SQLiteColumn<MakeColumnConfig<TColumn['_'], TAlias>>
 * +\t\t: TDialect extends 'gel' ? GelColumn<MakeColumnConfig<TColumn['_'], TAlias>>
 *  \t\t: never;
 * `;
 *
 * function extractPostImageLines(block: string): Set<number> {
 *   const lines = new Set<number>();
 *   let currentLine = 0;
 *   for (const line of block.split('\n')) {
 *     const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
 *     if (hunkMatch) { currentLine = parseInt(hunkMatch[1], 10); continue; }
 *     if ((line.startsWith('+') || line.startsWith(' ')) && !line.startsWith('+++')) {
 *       lines.add(currentLine);
 *       currentLine++;
 *     }
 *   }
 *   return lines;
 * }
 *
 * async function main(): Promise<void> {
 *   await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
 *   for (const f of FILES) {
 *     const content = execSync(
 *       `gh api repos/drizzle-team/drizzle-orm/contents/${f}?ref=${REF} --jq .content | base64 -d`,
 *     ).toString();
 *     const dest = join(SNAPSHOT_DIR, f);
 *     await fs.mkdir(dirname(dest), { recursive: true });
 *     await fs.writeFile(dest, content);
 *   }
 *   execSync(`git -C ${SNAPSHOT_DIR} init -q && git -C ${SNAPSHOT_DIR} add -A && git -C ${SNAPSHOT_DIR} commit -q -m snapshot`);
 *
 *   const indexResult = await performChunkOnlyIndex(SNAPSHOT_DIR);
 *   if (!indexResult.success || !indexResult.chunks) throw new Error('index failed');
 *   const repoChunks = indexResult.chunks;
 *   const chunks = repoChunks.filter(c => c.metadata.file === CHANGED_FILE);
 *
 *   const complexityResult = await runComplexityAnalysis([CHANGED_FILE], '50', SNAPSHOT_DIR, silentLogger);
 *   const complexityReport = complexityResult?.report ?? {
 *     summary: { filesAnalyzed: 1, totalViolations: 0, bySeverity: { error: 0, warning: 0 }, avgComplexity: 0, maxComplexity: 0 },
 *     files: {},
 *   };
 *
 *   const patches = new Map([[CHANGED_FILE, COLUMN_BUILDER_PATCH.trimEnd()]]);
 *   const diffLines = new Map([[CHANGED_FILE, extractPostImageLines(COLUMN_BUILDER_PATCH)]]);
 *
 *   await saveFixture(
 *     {
 *       chunks,
 *       changedFiles: [CHANGED_FILE],
 *       allChangedFiles: [CHANGED_FILE],
 *       complexityReport,
 *       baselineReport: null,
 *       deltas: null,
 *       pluginConfigs: {},
 *       // Pins this canary to the loop-on configuration — see the header note
 *       // above on why this needs no harness plumbing changes.
 *       config: { incompleteHandlingPass: true },
 *       pr: {
 *         owner: 'drizzle-team',
 *         repo: 'drizzle-orm',
 *         pullNumber: 4172,
 *         title: 'Gel dialect',
 *         body: '',
 *         baseSha: 'c27a9f2477175a444efdb4012f50ad0894b22026',
 *         headSha: '3fcc2db5b1351bafd2632fa20f7527713b3992e7',
 *         patches,
 *         diffLines,
 *       },
 *       repoChunks,
 *       repoRootDir: SNAPSHOT_DIR,
 *     },
 *     OUTPUT_PATH,
 *   );
 * }
 *
 * main();
 * ```
 *
 * Verified before any calibration spend (free):
 *   - Fixture loads via `loadFixture` (fixture-loader.ts's zod schema).
 *   - `computeVariantSweepContexts` fires: all 6 added variants surface as
 *     candidates, each with 4 consumer sites (all 4 downstream packages'
 *     `columnToSchema` sites, each "handles: array, bigint, boolean,
 *     buffer, custom, date, +3 more").
 *   - `build-prompts.ts` with the fixture's own `config.incompleteHandlingPass:
 *     true` (no env vars set) shows `incompleteHandlingPass.fires: true`,
 *     worklist = candidate-1..6, all `shape="variant-sweep"` — the FIRST
 *     fixture in this harness's corpus where variant-sweep candidates (not
 *     sibling-surface) populate the loop's worklist.
 *   - The SHARED (main-pass) prompt is NOT blind to this either: its
 *     `initialMessage` also carries the `<variant_sweep_candidates>` block
 *     (same 6 entries) — `incomplete-handling` is trigger-active for this
 *     fixture regardless of the loop flag, so the A/B measures which ARM
 *     converts the candidate to a real finding, not "does one arm see
 *     evidence the other doesn't."
 *
 * Tier 2 keyword design (keyword-integrity discipline): anchors are the 5
 * multi-syllable camelCase variant identifiers (`dateDuration`,
 * `relDuration`, `localTime`, `localDate`, `localDateTime` — deliberately
 * NOT bare `duration` alone, which collides with unrelated "how long did X
 * take" prose) plus compound "gel"-qualified phrases, AND (separately) the
 * unknown-schema-fallback impact phrasing. A finding must hit ONE anchor
 * from EACH gate to pass.
 */

/**
 * PROMOTED TO CANARY (2026-07-17): a same-day A/B (drizzle-ab campaign,
 * spend $0.8012 of a $1.40 cap; full traces + raw harness JSON archived
 * alongside the source material this fixture was promoted from) measured:
 *
 *   Shared arm  (flags off, main pass competing across 4 active rules):
 *     3-vote screen: 1/3 converted to a real finding. The other 2/3 called
 *     get_files_context + read_file on ALL FOUR downstream column.ts files
 *     (confirmed via trace) yet emitted ZERO findings of any rule —
 *     investigated the right code, then went silent.
 *
 *   Loop arm (`config.incompleteHandlingPass: true`, dedicated
 *   incomplete-handling pass): 3-vote screen: 3/3 converted to a real
 *   finding (the FIRST fixture in this harness's corpus where the loop's
 *   worklist is populated by variant-sweep candidates rather than
 *   sibling-surface). Escalated per the differentiating screen (1/3 vs
 *   3/3) to `--calibrate 10`: Tier 1 (rule fired with a real finding about
 *   THIS bug) was 10/10 — every run named the correct variants and the
 *   correct 4 packages. Raw Tier-1+2 pass rate on the first widened
 *   keyword set was 7/10; all 3 "failures" were correct, on-target
 *   findings using a compact "unknown/any" phrasing the gate hadn't
 *   anchored on yet (vs. the original per-package `type.unknown`/
 *   `z.any()`/`v.any()`/`t.any()` forms — see gate (B) below). Added a
 *   single `"unknown/any"` anchor and re-scored all 10 runs offline (free,
 *   no new spend): 10/10. Re-verified the three-verdict smoke test
 *   (perfect/empty/distractor) after each widening — distractor never
 *   false-passed.
 *
 *   HEADLINE: the dedicated incomplete-handling loop reliably (10/10)
 *   converts this real, live variant-sweep omission into a finding; the
 *   shared/competing main pass, despite carrying the identical
 *   `<variant_sweep_candidates>` evidence block and investigating the
 *   correct files, goes silent roughly 2 times out of 3 on this fixture.
 *
 *   Smoke-test re-run offline (assert-cli.ts, this promoted assertions
 *   file, zero LLM spend) against the campaign's saved perfect/empty/
 *   distractor result JSONs: perfect passes, empty Tier-1-fails, distractor
 *   Tier-2-fails (never false-passes) — see the PR body that promoted this
 *   fixture for the literal `assert-cli.ts` output.
 */
import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'drizzle-orm PR #4172 (Gel dialect) — 6 new ColumnDataType Gel temporal variants unhandled by all 4 schema-integration packages',
  rule: 'incomplete-handling',
  expect: (result, h) => {
    h.expectRuleFired('incomplete-handling', result);
    // (A) names the specific omitted variant family — the new Gel temporal
    // members, or an explicit "gel" + "columndatatype"/"column type" pairing.
    // Bare 'duration' deliberately excluded (see header).
    h.expectFindingMentions(
      [
        'dateduration',
        'relduration',
        'localtime',
        'localdate',
        'localdatetime',
        'gel temporal',
        'gel-specific column',
        'new gel column',
        'gel column types',
        "columndatatype's new",
      ],
      result,
    );
    // (B) the silent-degradation impact: falls through to an `unknown`/`any`
    // schema instead of a real validator. WIDENED 2026-07-16 after the first
    // paid screen (offline re-score, zero new spend): vote 2 of the loop-arm
    // 3-vote screen correctly named EACH package's own real fallback
    // expression (`z.any()` for zod, `v.any()` for valibot, `t.Any()` for
    // typebox — verified against the real fetched source, see header) rather
    // than generically saying "type.unknown" for all four — MORE precise
    // than the original gate assumed, not less correct. Widened a second
    // time after `--calibrate 10`: 3 of 10 raw "failures" used the compact
    // "unknown/any" construction instead of any per-package form — added a
    // single `"unknown/any"` anchor and re-scored all 10 runs offline: 10/10.
    h.expectFindingMentions(
      [
        'type.unknown',
        'schema = type.unknown',
        'z.any()',
        'v.any()',
        't.any()',
        'unknown/any',
        'falls through to unknown',
        'fall through to unknown',
        'degrades to unknown',
        'degrade to unknown',
        'silently degrades',
        'silently degrade',
        'silently accept',
        'silently accepting',
        'validated as unknown',
        'validate any value',
        'unknown schema instead',
        'no real validation',
        'no runtime validation',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary', 'crossrepo', 'typescript'],
};

export default assertions;

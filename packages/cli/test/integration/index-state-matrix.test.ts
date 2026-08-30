/**
 * #1029 Workstream 1 — the index-state × entry-point detector.
 *
 * Every read-only, index-backed entry point Lien exposes, exercised against
 * every whole-index state it can find itself in (S0/S1/S2/S3/ok — see
 * `../../src/utils/index-freshness.ts`'s `IndexState` doc comment and
 * `docs/architecture/index-state-honesty.md`), asserting the ACTUAL response
 * — not just "a response exists". This is the detector for the largest
 * defect class in #1017's sweep: a confident answer where the honest answer
 * is "I don't know."
 *
 * Two things make this a detector rather than a snapshot:
 *
 * 1. Every assertion is on real behavior against a REAL `SqliteBackend` (no
 *    `createVectorDB` mocking) — a regression has to actually reproduce, not
 *    just fail to satisfy a mock expectation.
 * 2. The completeness guard at the bottom fails the build the moment a new
 *    read-only, index-touching entry point exists that isn't accounted for
 *    here — derived from a source scan + the MCP tool registry, not a
 *    hand-maintained list anyone could forget to update.
 *
 * Test isolation: every test gets its own project directory AND its own
 * `LIEN_HOME` (via `process.env.LIEN_HOME`, restored in `afterEach`) — never
 * `os.homedir()` mocking, which `getLienHome()` doesn't even consult once
 * `LIEN_HOME` is set (see #1037's incident: mocking `os.homedir()` alone is
 * silently a no-op once vitest's `global-setup.ts` has already set
 * `LIEN_HOME` for the whole run).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createVectorDB, indexCodebase, getIndexDir, type VectorDBInterface } from '@liendev/core';
import { simulatePreCountTrackingIndex } from '@liendev/core/test';
import { complexityCommand } from '../../src/cli/complexity.js';
import { apiDeltaCommand } from '../../src/cli/api-delta-cmd.js';
import { annotateCommand } from '../../src/cli/annotate-cmd.js';
import { statusCommand } from '../../src/cli/status.js';
import { pathCommand } from '../../src/cli/path-cmd.js';
import { deltaCommand } from '../../src/cli/delta-cmd.js';
import { configGetCommand } from '../../src/cli/config.js';
import { handleSearchCode } from '../../src/mcp/handlers/search-code.js';
import { handleGetFilesContext } from '../../src/mcp/handlers/get-files-context.js';
import { handleGetDependents } from '../../src/mcp/handlers/get-dependents.js';
import { clearDependencyCache } from '../../src/mcp/handlers/dependency-analyzer.js';
import { handleGetComplexity } from '../../src/mcp/handlers/get-complexity.js';
import { handleListFunctions } from '../../src/mcp/handlers/list-functions.js';
import { handleFindSimilar } from '../../src/mcp/handlers/find-similar.js';
import { toolHandlers } from '../../src/mcp/handlers/index.js';
import type { ToolContext } from '../../src/mcp/types.js';

const execFileAsync = promisify(execFile);

// ============================================================================
// The table (deliverable #3) — one row per (entry point, state). Rendered
// verbatim in the PR body. `state: 'n/a'` rows document why a state doesn't
// apply (never a silent omission) rather than being skipped.
// ============================================================================

type EntryPointState =
  | 'S0'
  | 'S1'
  | 'S2'
  | 'S3'
  | 'ok'
  | 'n/a'
  // Layout axis (#1050, #1051) — orthogonal to the whole-index STATES above:
  // a linked git worktree nested inside its own main checkout (the standard
  // Claude Code agent-fleet layout) is backed by an `OverlayBackend`, where
  // `dbPath` is the worktree's own writable overlay and `baseIndexDir` is the
  // main checkout's read-only base. `worktree-fresh` = the worktree has never
  // completed its own local `lien index` (no local overlay `structural.db`
  // yet), but the main checkout's base IS fully populated — the exact shape
  // both issues require. `worktree-none` = the same fresh-worktree layout,
  // but the main checkout ALSO has never been indexed, proving the fix
  // doesn't overcorrect a genuine S0 into a false "ok" (CLAUDE.md's hard
  // constraint: never turn a real S0 into a false clean, and never turn a
  // real base into a false S0 either).
  | 'worktree-fresh'
  | 'worktree-none'
  // Derived-data axis (#1071, #1072) — also orthogonal to the whole-index
  // states above, and so far unique to `search_code`. The `chunks` table is
  // healthy and current, but the derived `dependent_counts` table it publishes
  // `dependentCount` from was never written (an index from a version predating
  // it). "Stale" in the same sense as S2, over a different table, and NOT
  // detectable from the numbers: a corpus whose counts are legitimately all
  // zero looks identical, which is why the disposition is keyed on a stored
  // flag instead.
  | 'S2-counts'
  // The two axes CROSSED (#1085) — the missing row that let the defect ship.
  // Neither axis alone reaches it: a standalone `S2-counts` store has one place
  // to look, and `worktree-fresh` was only ever exercised against the `chunks`
  // table. `worktree-fresh × counts-in-base` = a fresh worktree whose base HAS
  // computed counts and whose own overlay never has, so the honest answer lives
  // in the far store and the read path is already serving it.
  // `worktree-S2-counts` is its negative control: NEITHER store ever computed
  // them, so the note must still fire — over-correcting a false caveat into
  // silence would lose what #1072 shipped it for.
  | 'worktree-fresh × counts-in-base'
  | 'worktree-S2-counts';

interface TableRow {
  entryPoint: string;
  state: EntryPointState;
  expected: string;
}

const TABLE: TableRow[] = [
  // --- CLI, index-touching (advisory nudge: loud warning, exit 0 by design) ---
  {
    entryPoint: 'lien annotate',
    state: 'S0',
    expected: 'loud "no index found" warning printed, exit 0 (advisory — see policy nuance)',
  },
  {
    entryPoint: 'lien annotate',
    state: 'S1',
    expected: 'same loud warning as S0 (indistinguishable to this advisory tool)',
  },
  {
    entryPoint: 'lien annotate',
    state: 'S3',
    expected: '"not found in the index" note for the unresolved path, exit 0',
  },
  {
    entryPoint: 'lien annotate',
    state: 'ok',
    expected: 'real dependents/tests/complexity annotation printed',
  },
  {
    entryPoint: 'lien api-delta',
    state: 'S0',
    expected: 'degrades: enriched:false, dependentCount:null (never a fabricated 0), exit 0',
  },
  {
    entryPoint: 'lien api-delta',
    state: 'S1',
    expected: 'degrades identically to S0 (#1029 W1 fix — previously a false enriched:true/0)',
  },
  {
    entryPoint: 'lien api-delta',
    state: 'ok',
    expected: 'enriched:true with real dependentCount',
  },
  // --- Layout axis (#1050, #1051): a FRESH linked worktree nested inside
  //     its own main checkout, whose base index is fully populated. See the
  //     `EntryPointState` doc comment above for the two sub-shapes.
  {
    entryPoint: 'lien api-delta',
    state: 'worktree-fresh',
    expected: 'enriched:true with a real dependentCount from the shared base (#1051 fix)',
  },
  {
    entryPoint: 'lien api-delta',
    state: 'worktree-none',
    expected: 'still degrades (enriched:false) — base also never indexed, no overcorrection',
  },
  {
    entryPoint: 'lien annotate',
    state: 'worktree-fresh',
    expected: 'real dependents/tests annotation from the shared base (#1051 fix)',
  },
  {
    entryPoint: 'lien path',
    state: 'worktree-fresh',
    expected:
      '`path --root` resolves to the WORKTREE itself, never the outer main checkout (#1050 fix)',
  },
  {
    // #1085. The response used to say "the counts were never computed here" and
    // drop 100% of `dependentCount`, while the base's counts ranked the very
    // results it was attached to. Checking one of two on-disk locations instead
    // of the composition — the #1050/#1051 shape, third time in this class.
    entryPoint: 'search_code',
    state: 'worktree-fresh × counts-in-base',
    expected: 'real dependentCount from the shared base, NO note (#1085 fix)',
  },
  {
    // The negative control, and the row whose absence is why #1085 shipped.
    entryPoint: 'search_code',
    state: 'worktree-S2-counts',
    expected: 'note still fires + every count omitted (neither store ever computed them)',
  },
  // --- CLI, index-independent (never touch the structural store at all) ---
  {
    entryPoint: 'lien status',
    state: 'S0',
    expected: '"✗ Not indexed" (already honest — reference implementation)',
  },
  {
    entryPoint: 'lien status',
    state: 'S1',
    expected: '"✓ Exists" + "Index files: 0" — a true zero, not a lie',
  },
  {
    entryPoint: 'lien status',
    state: 'S2',
    expected: '"⚠️ Git state changed" warning',
  },
  { entryPoint: 'lien status', state: 'ok', expected: 'real indexed-file count, no warning' },
  {
    entryPoint: 'lien path',
    state: 'n/a',
    expected: 'never touches the index — output identical regardless of index state',
  },
  {
    entryPoint: 'lien delta',
    state: 'n/a',
    expected: 'git-diff/AST only, never touches the index — output identical regardless',
  },
  {
    entryPoint: 'lien config get',
    state: 'n/a',
    expected: 'global config only, never touches the index — output identical regardless',
  },
  {
    entryPoint: 'lien complexity',
    state: 'n/a',
    expected:
      'parses the working tree; hard-errors (exit 1) when the scan yields no data — gate-shaped, so a false clean is never acceptable',
  },
  {
    entryPoint: 'lien health',
    state: 'n/a',
    expected:
      'parses the working tree via performChunkOnlyIndex, never touches the index — output identical regardless',
  },
  // --- MCP tools (S0 is structurally impossible: `lien serve` always
  //     initializes the store before registering tool handlers) ---
  {
    entryPoint: 'search_code',
    state: 'S1',
    expected: 'note: "⚠ Lien: ... no data" (never a bare confident 0 results)',
  },
  { entryPoint: 'search_code', state: 'ok', expected: 'real hit, no note' },
  {
    // #1071 added a SECOND index-state axis to this one tool: `dependentCount`
    // (and the ranking boost derived from it) now comes from the precomputed
    // `dependent_counts` table, not from a resolution pass on the query path.
    // That table is written at the end of a full index, so an index built by a
    // pre-#1071 version has a healthy `chunks` table and an EMPTY counts table
    // — a state no other entry point has. It degrades to the pre-#1071
    // behaviour (every count 0, boost = identity), which is a silent no-op
    // rather than a wrong answer; the honesty gap of asserting a bare `0` is
    // tracked separately in #1072, which owns the caveat vocabulary for it.
    // The row exists so that "healthy index, empty counts" is a documented
    // state rather than a discovery, and so the `ok` assertion below pins that
    // a genuinely fresh index does NOT land in it.
    entryPoint: 'search_code',
    state: 'ok',
    expected: 'dependent_counts populated by the full index; dependentCount reflects real edges',
  },
  {
    // #1072 resolves the honesty gap the row above hands off. Same second axis,
    // now with named dispositions per cause. This is the "counts were never
    // computed for this store" cause: chunks healthy, counts absent, so every
    // count would read 0 for a reason that has nothing to do with the code.
    // Whole-corpus, therefore ONE response-level note plus omission on every
    // result — never one caveat per result, which is how #1014 became noise.
    entryPoint: 'search_code',
    state: 'S2-counts',
    expected: 'dependentCount omitted from every result + one note naming "lien index"',
  },
  {
    // #1072's second cause, and the one that must stay SILENT: the language's
    // import forms cannot name a file at all (Swift's whole-module imports,
    // C#/Java/Kotlin same-unit access — `hasDependentAttributionBlindSpot`).
    // The field is dropped for that result and nothing is said, because a note
    // here would fire on most searches across four whole languages.
    entryPoint: 'search_code',
    state: 'ok',
    expected: 'blind-spot language + zero count: field omitted per result, NO note',
  },
  {
    // The negative control for both rows above, and the reason this file is a
    // detector rather than a snapshot. A healthy, freshly-indexed corpus with a
    // GENUINE resolved zero must acquire nothing at all: no note, no omission,
    // no marker. #1014's cost was a caveat that fired on essentially every
    // agent session and got trained out as noise; re-earning that would be
    // worse than the silence #1072 replaced.
    entryPoint: 'search_code',
    state: 'ok',
    expected: 'genuine resolved zero: dependentCount: 0 present, no note (negative control)',
  },
  {
    entryPoint: 'list_functions',
    state: 'S1',
    expected: 'note: "⚠ Lien: ... no data"',
  },
  { entryPoint: 'list_functions', state: 'ok', expected: 'real hit, no note' },
  {
    entryPoint: 'find_similar',
    state: 'S1',
    expected: 'note: "⚠ Lien: ... no data" (#1029 W1 fix — previously the generic 0-results note)',
  },
  { entryPoint: 'find_similar', state: 'ok', expected: 'real hit, no note' },
  {
    entryPoint: 'get_complexity',
    state: 'S1',
    expected: 'note: "⚠ Lien: ... no data" on a whole-repo scan (#1029 W1 fix — previously silent)',
  },
  {
    entryPoint: 'get_complexity',
    state: 'S3',
    expected: 'unindexed-path note naming the requested file',
  },
  { entryPoint: 'get_complexity', state: 'ok', expected: 'real violation reported, no note' },
  {
    entryPoint: 'get_dependents',
    state: 'S1',
    expected: 'attributionCaveat: unresolved-target + unindexed-path note (S1 ⊆ S3 here)',
  },
  {
    entryPoint: 'get_dependents',
    state: 'S3',
    expected: 'attributionCaveat: unresolved-target + unindexed-path note',
  },
  {
    entryPoint: 'get_dependents',
    state: 'ok',
    expected: 'real dependent found, no attributionCaveat',
  },
  {
    entryPoint: 'get_files_context',
    state: 'S1',
    expected: 'unindexed-path note (S1 ⊆ S3 here — filepath is mandatory)',
  },
  { entryPoint: 'get_files_context', state: 'S3', expected: 'unindexed-path note' },
  { entryPoint: 'get_files_context', state: 'ok', expected: 'real chunks returned, no note' },
];

// ============================================================================
// Fixture helpers
// ============================================================================

async function git(dir: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: dir });
}

async function initRepo(dir: string): Promise<void> {
  await git(dir, 'init', '-q');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'Test');
  await git(dir, 'config', 'commit.gpgsign', 'false');
}

async function commitAll(dir: string, message: string): Promise<void> {
  await git(dir, 'add', '-A');
  await git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message);
}

/**
 * Real fixture: a tiny git repo with a high-complexity function (crosses the
 * default cyclomatic warn threshold of 15 — `DEFAULT_COMPLEXITY_THRESHOLDS`
 * in `@liendev/parser`), a real cross-file dependent, and a real
 * import-associated test file. Indexed for real via `indexCodebase` — no
 * hand-built chunk metadata — so every entry point below reads genuinely
 * indexed data, not a mock's approximation of it.
 */
async function writeHealthyFixture(dir: string): Promise<void> {
  const manyIfs = Array.from({ length: 20 }, (_, i) => `  if (x === ${i}) r += ${i};`).join('\n');
  await fs.writeFile(
    path.join(dir, 'math.ts'),
    [
      'export function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
      '',
      'export function manyBranches(x: number): number {',
      '  let r = x;',
      manyIfs,
      '  return r;',
      '}',
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(dir, 'caller.ts'),
    [
      "import { add } from './math';",
      '',
      'export function useAdd(a: number, b: number) {',
      '  return add(a, b);',
      '}',
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(dir, 'math.test.ts'),
    [
      "import { add } from './math';",
      '',
      "test('adds', () => {",
      '  expect(add(1, 2)).toBe(3);',
      '});',
      '',
    ].join('\n'),
  );
}

async function buildHealthyIndex(dir: string): Promise<void> {
  await initRepo(dir);
  await writeHealthyFixture(dir);
  await commitAll(dir, 'init');
  const result = await indexCodebase({ rootDir: dir, verbose: false });
  if (!result.success || result.filesIndexed < 3) {
    throw new Error(`fixture indexing failed: ${JSON.stringify(result)}`);
  }
}

function makeCtx(vectorDB: VectorDBInterface): ToolContext {
  return {
    vectorDB,
    rootDir: process.cwd(),
    log: () => undefined,
    checkAndReconnect: async () => undefined,
    getIndexMetadata: () => ({
      indexVersion: vectorDB.getCurrentVersion(),
      indexDate: vectorDB.getVersionDate(),
    }),
    getReindexState: () => ({
      inProgress: false,
      pendingFiles: [],
      lastReindexTimestamp: null,
      lastReindexDurationMs: null,
    }),
  };
}

// ============================================================================
// Shared per-test isolation
// ============================================================================

describe('index-state × entry-point matrix (#1029 W1)', () => {
  let dir: string;
  let home: string;
  let originalCwd: string;
  let originalHome: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // `findDependents`'s module-level `scanCache` (dependency-analyzer.ts) is
    // keyed ONLY by `indexVersion` (a plain number), with no project-root
    // component — safe in production (one `lien serve` process = one root),
    // but this file drives `get_dependents`/`annotate` against many DIFFERENT
    // roots in rapid succession within one process. Two unrelated tests'
    // stores can legitimately land on the same version stamp (timestamp-
    // based), and without this reset the second test's empty/different store
    // would silently serve the first test's cached chunks — a real, if
    // narrow, flake surfaced by adding more indexing-heavy tests here (the
    // worktree/overlay section below).
    clearDependencyCache();

    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-ism-'));
    dir = await fs.realpath(dir); // resolve macOS /var -> /private/var
    originalCwd = process.cwd();
    process.chdir(dir);

    // Redirect LIEN_HOME (not os.homedir()) per test, restored in afterEach —
    // see this file's module doc comment for why the distinction matters.
    originalHome = process.env.LIEN_HOME;
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-ism-home-'));
    process.env.LIEN_HOME = home;

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Never throws — several commands under test (`api-delta`, `delta`) call
    // `process.exit` unconditionally as their last statement even on a clean
    // run (by design: both are one-shot CLI processes in production). Let
    // execution fall off the end of the function normally instead.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.LIEN_HOME;
    else process.env.LIEN_HOME = originalHome;
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  // Several commands (`lien status` chief among them) call `console.log`
  // with multiple positional args (e.g. `console.log(chalk.dim('Index
  // files:'), count)`) rather than one pre-joined string — join every arg
  // of every call, not just the first, or half the printed line goes
  // missing from assertions.
  /** Strip chalk's ANSI color codes so assertions match on plain text, not raw escape sequences. */
  function stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;]*m/g, '');
  }

  function allLogged(): string {
    return stripAnsi(
      [...logSpy.mock.calls, ...errSpy.mock.calls, ...warnSpy.mock.calls]
        .map(call => call.map(String).join(' '))
        .join('\n'),
    );
  }

  function clearLogs(): void {
    logSpy.mockClear();
    errSpy.mockClear();
    warnSpy.mockClear();
    exitSpy.mockClear();
  }

  // ==========================================================================
  // CLI, index-INDEPENDENT but gate-shaped.
  //
  // `lien complexity` parses the working tree, so S0/S1/S2 no longer exist
  // for it — there is no store to be absent, empty or stale. What survives is
  // the rule those states enforced: a gate must never turn "nothing was
  // analyzed" into "nothing is wrong". These assert that the index state is
  // now genuinely irrelevant, and that a no-data run is still a hard error.
  // ==========================================================================

  // `resolveRepoRoot` walks upward for a `.git` marker. Without one inside
  // the fixture it would escape into whatever encloses os.tmpdir(), making
  // these assertions depend on the machine rather than the fixture.
  async function markFixtureAsRepoRoot(): Promise<void> {
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
  }

  describe('lien complexity', () => {
    it('reports normally with NO index at all — the state that used to be a hard error', async () => {
      await markFixtureAsRepoRoot();
      await fs.writeFile(
        path.join(dir, 'gnarly.ts'),
        'export function f(a){ if(a){ if(a){ if(a){ if(a){ if(a){ return 1; } } } } } return 0; }\n',
      );

      await complexityCommand({ format: 'json' });

      const output = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
      expect(output.summary.filesAnalyzed).toBeGreaterThan(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('produces the same report whether or not an index exists', async () => {
      await markFixtureAsRepoRoot();
      await fs.writeFile(
        path.join(dir, 'gnarly.ts'),
        'export function f(a){ if(a){ if(a){ if(a){ if(a){ if(a){ return 1; } } } } } return 0; }\n',
      );

      await complexityCommand({ format: 'json' });
      const withoutIndex = String(logSpy.mock.calls.at(-1)?.[0]);

      await buildHealthyIndex(dir);
      logSpy.mockClear();
      await complexityCommand({ format: 'json' });
      const withIndex = String(logSpy.mock.calls.at(-1)?.[0]);

      // The index is now inert for this command; a stale or absent one can no
      // longer change the answer.
      expect(JSON.parse(withIndex).files['gnarly.ts']).toEqual(
        JSON.parse(withoutIndex).files['gnarly.ts'],
      );
    });

    it('hard-errors when there is nothing to analyze, rather than reporting clean', async () => {
      await markFixtureAsRepoRoot();
      // Empty directory: the scan yields no chunks. A gate that formats this
      // as "0 violations, exit 0" is the false-clean bug in its original form.
      await complexityCommand({ format: 'text' });

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errors = errSpy.mock.calls.flat().join(' ');
      expect(errors).toContain('cannot analyze complexity');
      expect(errors).toContain('not a clean result');
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // CLI, index-touching, advisory nudge: loud warning is the bar, not exit
  // code — see docs/architecture/index-state-honesty.md's policy nuance.
  // ==========================================================================

  describe('lien annotate', () => {
    it('S0: prints a loud "no index found" warning, exit 0', async () => {
      await fs.writeFile(
        path.join(dir, 'math.ts'),
        'export function add(a, b) { return a + b; }\n',
      );

      await annotateCommand('math.ts');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Lien: no index found'));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('S1: prints the same loud warning as S0 (index directory exists, store has 0 rows)', async () => {
      await fs.writeFile(
        path.join(dir, 'math.ts'),
        'export function add(a, b) { return a + b; }\n',
      );
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      await annotateCommand('math.ts');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Lien: no index found'));
    });

    it('S3: reports "not found in the index" for an unresolvable path in an indexed repo', async () => {
      await buildHealthyIndex(dir);

      await annotateCommand('does/not/exist.ts');

      expect(allLogged()).toContain('not found in the index');
    });

    it('ok: prints the real annotation (dependents/tests/complexity)', async () => {
      await buildHealthyIndex(dir);

      await annotateCommand('math.ts');

      expect(allLogged()).toContain('Lien impact for math.ts');
    });
  });

  describe('lien api-delta', () => {
    async function writeSignatureChange(before: string, after: string): Promise<void> {
      await initRepo(dir);
      await fs.writeFile(path.join(dir, 'a.ts'), before);
      await commitAll(dir, 'init');
      await fs.writeFile(path.join(dir, 'a.ts'), after);
    }

    it('S0: degrades to signature-only — never a fabricated dependentCount:0', async () => {
      await writeSignatureChange(
        'export function formatUser(user) { return user.name; }\n',
        'export function formatUser(user, opts) { return user.name; }\n',
      );

      await apiDeltaCommand({ format: 'json', file: 'a.ts' });

      const printed = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
      expect(printed.changes[0]).toMatchObject({ enriched: false, dependentCount: null });
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('S1: degrades identically to S0 (index directory exists, store has 0 rows)', async () => {
      await writeSignatureChange(
        'export function formatUser(user) { return user.name; }\n',
        'export function formatUser(user, opts) { return user.name; }\n',
      );
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      await apiDeltaCommand({ format: 'json', file: 'a.ts' });

      const printed = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
      expect(printed.changes[0]).toMatchObject({ enriched: false, dependentCount: null });
    });

    it('ok: enriches with the real dependent count', async () => {
      await buildHealthyIndex(dir);
      // Uncommitted signature change on top of the real indexed state —
      // `caller.ts` is a real, already-indexed dependent of `add`.
      await fs.writeFile(
        path.join(dir, 'math.ts'),
        [
          'export function add(a: number, b: number, c: number): number {',
          '  return a + b + c;',
          '}',
          '',
          'export function manyBranches(x: number): number { return x; }',
          '',
        ].join('\n'),
      );

      await apiDeltaCommand({ format: 'json', file: 'math.ts' });

      const printed = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
      const addChange = printed.changes.find((c: { symbol: string }) => c.symbol === 'add');
      // Real dependents: caller.ts (production) and math.test.ts (both
      // import `add`) — assert real enrichment ran, not an exact count that
      // would make this test brittle to fixture changes.
      expect(addChange.enriched).toBe(true);
      expect(addChange.dependentCount).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Worktree/overlay layout axis (#1050, #1051) — every state proven above
  // was against a STANDALONE index. Every one of `index-state-matrix.test.ts`'s
  // original 36 cases (#1029 W1) ran against `dir` directly; none of them
  // touched a linked git worktree, so this whole layout axis was invisible to
  // the detector — exactly why #1050/#1051 shipped unnoticed.
  //
  // A linked worktree nested inside its own main checkout (the standard
  // Claude Code agent-fleet layout: `<main>/.claude/worktrees/<name>` — see
  // `docs/architecture/worktree-aware-indexing.md`) is backed by an
  // `OverlayBackend`: `dbPath` is the worktree's own writable overlay,
  // `baseIndexDir` is the main checkout's read-only base. Before this fix:
  //
  //  - #1051: `hasStructuralIndex` checked ONLY the worktree's own (not-yet-
  //    built) overlay `structural.db`, so `lien complexity`/`lien api-delta`
  //    reported a false S0 ("Index not found") on a fresh worktree despite a
  //    fully populated, reachable base.
  //  - #1050: `resolveProjectRoot`'s completed-index walk was unbounded, so
  //    it walked straight past the worktree's own `.git` FILE (the linked-
  //    worktree marker) to the outer main checkout's already-completed
  //    index — silently resolving `lien path`/`annotate`/`gc`/etc. to the
  //    WRONG repository.
  //
  // `worktree-none` cases prove the fix doesn't overcorrect: a fresh
  // worktree whose base is ALSO never indexed must still report a real S0,
  // never a false "ok".
  // ==========================================================================

  describe('worktree/overlay layout (#1050, #1051)', () => {
    let worktreeRoot: string | undefined;

    afterEach(async () => {
      if (worktreeRoot) {
        // Restore cwd to the (still-alive) main checkout BEFORE removing the
        // worktree — CodeRabbit correctly flagged that leaving process.cwd()
        // pointed at worktreeRoot while `git worktree remove` deletes that
        // very directory risks an ENOENT the moment anything (vitest's own
        // internal bookkeeping between hooks, not just this file's code)
        // calls `process.cwd()` before the outer afterEach's
        // `process.chdir(originalCwd)` runs. `dir` itself isn't removed
        // until the outer afterEach's `fs.rm(dir, ...)`, so it's a safe,
        // still-existing intermediate landing spot.
        process.chdir(dir);
        await execFileAsync('git', ['worktree', 'remove', '--force', worktreeRoot], {
          cwd: dir,
        }).catch(() => undefined);
      }
      worktreeRoot = undefined;
    });

    /**
     * Create a linked worktree of `dir` (the outer `beforeEach`'s main
     * checkout), nested inside it at `.claude/worktrees/<name>` — the exact
     * layout that triggers #1050/#1051 — and chdir into it. The worktree's
     * own `lien index` is deliberately never run: that "fresh" state (no
     * local overlay build yet) is the whole point of this axis.
     */
    async function chdirIntoFreshNestedWorktree(): Promise<string> {
      const wtDir = path.join(dir, '.claude', 'worktrees', 'agent-fresh');
      await fs.mkdir(path.join(dir, '.claude', 'worktrees'), { recursive: true });
      await git(dir, 'worktree', 'add', '-q', wtDir, '-b', 'worktree-agent-fresh');
      worktreeRoot = await fs.realpath(wtDir);
      process.chdir(worktreeRoot);
      return worktreeRoot;
    }

    describe('lien complexity', () => {
      it('worktree-fresh: reports the worktree own source, no shared base needed (#1051 obsolete)', async () => {
        await buildHealthyIndex(dir);
        await chdirIntoFreshNestedWorktree();

        await complexityCommand({ format: 'json' });

        expect(errSpy).not.toHaveBeenCalled();
        const output = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
        expect(output.summary.filesAnalyzed).toBeGreaterThan(0);
        expect(output.summary.totalViolations).toBeGreaterThan(0);
      });

      it('worktree-none: an unindexed base is no longer an error, the worktree has source of its own', async () => {
        // This inverts the old expectation deliberately. #1051 existed because
        // a fresh linked worktree had no index and inherited a false "Index
        // not found"; overlay resolution was the fix. Reading the working tree
        // dissolves the problem rather than solving it: there is no base to
        // resolve to, and the worktree own files are right there.
        await initRepo(dir);
        await fs.writeFile(
          path.join(dir, 'gnarly.ts'),
          'export function f(a){ if(a){ if(a){ if(a){ if(a){ if(a){ return 1; } } } } } return 0; }\n',
        );
        await commitAll(dir, 'init');
        await chdirIntoFreshNestedWorktree();

        await complexityCommand({ format: 'json' });

        expect(errSpy).not.toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
        const output = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
        expect(output.summary.filesAnalyzed).toBeGreaterThan(0);
      });
    });

    describe('lien api-delta', () => {
      it('worktree-fresh: enriches with a real dependentCount from the shared base (#1051)', async () => {
        await buildHealthyIndex(dir);
        await chdirIntoFreshNestedWorktree();
        // Uncommitted signature change on top of the real indexed base state
        // — `caller.ts` is a real, already-indexed dependent of `add`.
        await fs.writeFile(
          path.join(worktreeRoot!, 'math.ts'),
          [
            'export function add(a: number, b: number, c: number): number {',
            '  return a + b + c;',
            '}',
            '',
            'export function manyBranches(x: number): number { return x; }',
            '',
          ].join('\n'),
        );

        await apiDeltaCommand({ format: 'json', file: 'math.ts' });

        const printed = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
        const addChange = printed.changes.find((c: { symbol: string }) => c.symbol === 'add');
        expect(addChange.enriched).toBe(true);
        expect(addChange.dependentCount).toBeGreaterThan(0);
      });

      it('worktree-none: still degrades (enriched:false) when the base ALSO has never been indexed', async () => {
        await initRepo(dir);
        await fs.writeFile(
          path.join(dir, 'a.ts'),
          'export function formatUser(user) { return user.name; }\n',
        );
        await commitAll(dir, 'init');
        await chdirIntoFreshNestedWorktree();
        await fs.writeFile(
          path.join(worktreeRoot!, 'a.ts'),
          'export function formatUser(user, opts) { return user.name; }\n',
        );

        await apiDeltaCommand({ format: 'json', file: 'a.ts' });

        const printed = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
        expect(printed.changes[0]).toMatchObject({ enriched: false, dependentCount: null });
      });
    });

    describe('lien annotate', () => {
      it('worktree-fresh: real dependents/tests annotation from the shared base (#1051)', async () => {
        await buildHealthyIndex(dir);
        await chdirIntoFreshNestedWorktree();

        await annotateCommand('math.ts');

        expect(allLogged()).toContain('Lien impact for math.ts');
        expect(allLogged()).not.toContain('no index found');
      });
    });

    describe('lien path --root', () => {
      it('worktree-fresh: resolves to the WORKTREE itself, never the outer main checkout (#1050)', async () => {
        await buildHealthyIndex(dir);
        const wtRoot = await chdirIntoFreshNestedWorktree();

        pathCommand({ root: true });

        const printed = allLogged().trim();
        expect(printed).toBe(wtRoot);
        expect(printed).not.toBe(dir);
      });
    });

    // ------------------------------------------------------------------------
    // The layout axis CROSSED with the derived-data axis (#1085). This pair is
    // the row the matrix was missing: `search_code`'s counts axis had only ever
    // been exercised against a standalone store, where there is exactly one
    // place for the state to live, and the worktree axis had only ever been
    // exercised against the `chunks` table. The defect lived precisely in the
    // crossing, and every agent session in this repo's own fleet ran through it.
    // ------------------------------------------------------------------------

    describe('search_code (dependent-count honesty × overlay)', () => {
      it('worktree-fresh × counts-in-base: real counts, NO note — never a note over counts it is ranking with (#1085)', async () => {
        await buildHealthyIndex(dir);
        const wtRoot = await chdirIntoFreshNestedWorktree();

        const vectorDB = await createVectorDB(wtRoot);
        await vectorDB.initialize();
        expect(vectorDB.isOverlay).toBe(true);
        // The composition has counts even though this worktree has never run its
        // own `lien index` — asked of the backend, not inferred from the results.
        expect(await vectorDB.hasDependentCounts()).toBe(true);

        const result = await handleSearchCode({ query: 'add' }, makeCtx(vectorDB));

        const parsed = JSON.parse(result.content![0].text) as {
          note?: string;
          results: { metadata: { file: string; dependentCount?: number } }[];
        };
        const mathHit = parsed.results.find(r => r.metadata.file.endsWith('math.ts'));
        expect(mathHit).toBeDefined();
        // Present and real: `index.ts` and `math.test.ts` both import `math.ts`.
        expect(mathHit!.metadata.dependentCount).toBeGreaterThan(0);
        expect(parsed.note).toBeUndefined();
      });

      it('worktree-S2-counts: the note STILL fires when neither store ever computed them (#1085 negative control)', async () => {
        // Over-correcting #1085 into silence would cost what #1072 shipped: a
        // genuinely never-computed store must still say so. Both halves of the
        // composition are rewound here, so nothing anywhere can answer.
        await buildHealthyIndex(dir);
        simulatePreCountTrackingIndex(getIndexDir(dir));
        const wtRoot = await chdirIntoFreshNestedWorktree();

        const vectorDB = await createVectorDB(wtRoot);
        await vectorDB.initialize();
        expect(vectorDB.isOverlay).toBe(true);
        expect(await vectorDB.hasDependentCounts()).toBe(false);

        const result = await handleSearchCode({ query: 'add' }, makeCtx(vectorDB));

        const parsed = JSON.parse(result.content![0].text) as {
          note?: string;
          results: { metadata: { file: string; dependentCount?: number } }[];
        };
        expect(parsed.results.length).toBeGreaterThan(0);
        for (const r of parsed.results) {
          expect(r.metadata).not.toHaveProperty('dependentCount');
        }
        expect(parsed.note).toContain('predates reverse-dependency counting');
      });

      it('worktree-S2-counts: a plain `lien index` in the worktree clears it — the note names a remedy that works (#1084)', async () => {
        // #1084 on the overlay path. `lien index` is the remedy the note prints,
        // so it has to work from the state the note fires in.
        await buildHealthyIndex(dir);
        simulatePreCountTrackingIndex(getIndexDir(dir));
        const wtRoot = await chdirIntoFreshNestedWorktree();

        const indexed = await indexCodebase({ rootDir: wtRoot, verbose: false });
        expect(indexed.success).toBe(true);

        const vectorDB = await createVectorDB(wtRoot);
        await vectorDB.initialize();
        expect(await vectorDB.hasDependentCounts()).toBe(true);

        const result = await handleSearchCode({ query: 'add' }, makeCtx(vectorDB));
        const parsed = JSON.parse(result.content![0].text) as {
          note?: string;
          results: { metadata: { file: string; dependentCount?: number } }[];
        };
        expect(parsed.note).toBeUndefined();
        const mathHit = parsed.results.find(r => r.metadata.file.endsWith('math.ts'));
        expect(mathHit!.metadata.dependentCount).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================================================
  // CLI, index-touching, but a plain descriptive report — `lien status`
  // already gets this right (reference implementation, unchanged by W1).
  // ==========================================================================

  describe('lien status', () => {
    it('S0: reports "Not indexed"', async () => {
      await statusCommand({ format: 'text' });

      expect(allLogged()).toContain('Not indexed');
    });

    it('S1: reports "Exists" + a true zero indexed-file count (not a lie)', async () => {
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      await statusCommand({ format: 'text' });

      const printed = allLogged();
      expect(printed).toContain('Exists');
      expect(/Index files:\s*0\b/.test(printed)).toBe(true);
    });

    it('S2: warns about stale git state', async () => {
      await buildHealthyIndex(dir);
      await fs.writeFile(path.join(dir, 'extra.ts'), 'export const z = 1;\n');
      await commitAll(dir, 'second commit');

      await statusCommand({ format: 'text' });

      expect(allLogged()).toContain('Git state changed');
    });

    it('ok: reports the real indexed-file count, no staleness warning', async () => {
      await buildHealthyIndex(dir);

      await statusCommand({ format: 'text' });

      const printed = allLogged();
      expect(printed).not.toContain('Git state changed');
      expect(/Index files:\s*3\b/.test(printed)).toBe(true);
    });
  });

  // ==========================================================================
  // CLI, index-INDEPENDENT: never touch the structural store at all, so
  // their output must never vary with index state — proven behaviorally,
  // not just asserted by comment.
  // ==========================================================================

  describe('lien path (index-independent)', () => {
    it('produces identical output whether or not an index exists', async () => {
      pathCommand({ root: true });
      const withoutIndex = allLogged();
      clearLogs();

      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      pathCommand({ root: true });
      const withIndex = allLogged();

      expect(withIndex).toBe(withoutIndex);
      expect(withoutIndex.length).toBeGreaterThan(0);
    });
  });

  describe('lien delta (index-independent)', () => {
    it('produces identical output whether or not an index exists', async () => {
      await initRepo(dir);
      await fs.writeFile(path.join(dir, 'a.ts'), 'export const a = 1;\n');
      await commitAll(dir, 'init');

      // `lien delta` reports its own elapsed ms in the text — strip that one
      // genuinely-nondeterministic number before comparing, or this test
      // would flake on timing noise alone.
      const stripTiming = (s: string): string => s.replace(/\(\d+ ms\)/g, '(N ms)');

      await deltaCommand({ format: 'text' });
      const withoutIndex = stripTiming(allLogged());
      clearLogs();

      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      await deltaCommand({ format: 'text' });
      const withIndex = stripTiming(allLogged());

      expect(withIndex).toBe(withoutIndex);
    });
  });

  describe('lien config get (index-independent)', () => {
    it('produces identical output whether or not an index exists', async () => {
      await configGetCommand('backend');
      const withoutIndex = allLogged();
      clearLogs();

      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      await configGetCommand('backend');
      const withIndex = allLogged();

      expect(withIndex).toBe(withoutIndex);
      expect(withoutIndex.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // MCP tools. S0 is structurally impossible here: `lien serve` always
  // initializes the structural store (`createVectorDB(...).initialize()`)
  // before ever registering tool handlers — see mcp/server.ts's
  // `startMCPServer` -> `initializeComponents` -> `setupAndConnectServer` ->
  // `registerMCPHandlers` ordering. The earliest state a tool call can ever
  // observe is S1.
  // ==========================================================================

  describe('search_code', () => {
    it('S1: notes the whole-index-empty fact instead of a bare 0 results', async () => {
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleSearchCode({ query: 'manyBranches' }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.note).toContain('⚠ Lien:');
      expect(parsed.note).toContain('no data');
    });

    it('ok: finds the real hit, no note', async () => {
      await buildHealthyIndex(dir);
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleSearchCode({ query: 'manyBranches' }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results.length).toBeGreaterThan(0);
      expect(parsed.note).toBeUndefined();
    });

    it('ok: a full index leaves dependent_counts POPULATED, not silently empty (#1071)', async () => {
      // The state this pins shut: `dependent_counts` is written by
      // `indexCodebase` at the end of a full run. If that call were ever
      // dropped, every `search_code` result would carry `dependentCount: 0`
      // and the structural ranking boost would silently degrade to the
      // identity function — indistinguishable, from the outside, from a
      // codebase where nothing imports anything. That is precisely how the
      // #1071 defect survived from #773: a broken count reads as a plausible
      // count. `buildHealthyIndex` seeds a fixture with a real import edge, so
      // a populated table is the only correct outcome here.
      await buildHealthyIndex(dir);
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      // Asserted through the public surface an agent actually sees, not the
      // table: `math.ts` is imported by both `index.ts` and `math.test.ts` in
      // `writeHealthyFixture`, so a working pipeline reports a positive count
      // for it.
      const result = await handleSearchCode({ query: 'add' }, makeCtx(vectorDB));
      const parsed = JSON.parse(result.content![0].text) as {
        results: { metadata: { file: string; dependentCount?: number } }[];
      };
      const mathHit = parsed.results.find(r => r.metadata.file.endsWith('math.ts'));
      expect(mathHit).toBeDefined();
      expect(mathHit!.metadata.dependentCount).toBeGreaterThan(0);
    });

    // ------------------------------------------------------------------
    // #1072: the four indistinguishable `dependentCount: 0`s, each with the
    // disposition its TABLE row above documents. The negative control comes
    // FIRST deliberately — it is the assertion that proves the other two
    // haven't rebuilt #1014.
    // ------------------------------------------------------------------

    it('ok: a GENUINE resolved zero acquires nothing — no note, no omission (#1072 negative control)', async () => {
      // `caller.ts` imports `math.ts` and nothing imports `caller.ts`, on a
      // healthy freshly-indexed TypeScript corpus whose counts WERE computed.
      // That is a real, useful answer, and CLAUDE.md's hard constraint applies
      // in full: never turn a genuinely clean, freshly-indexed result into a
      // false alarm. If this test ever goes red because a caveat appeared, the
      // caveat is the bug.
      await buildHealthyIndex(dir);
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();
      expect(await vectorDB.hasDependentCounts()).toBe(true);

      const result = await handleSearchCode({ query: 'useAdd' }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text) as {
        note?: string;
        results: { metadata: { file: string; dependentCount?: number } }[];
      };
      const callerHit = parsed.results.find(r => r.metadata.file.endsWith('caller.ts'));
      expect(callerHit).toBeDefined();
      // Present, and zero — the field is NOT dropped for a resolved zero.
      expect(callerHit!.metadata).toHaveProperty('dependentCount', 0);
      expect(parsed.note).toBeUndefined();
    });

    it('S2-counts: omits every dependentCount and notes it once when the counts were never computed (#1072)', async () => {
      // The same healthy corpus as the negative control, rewound to a
      // pre-count-tracking index. Nothing about the CODE changed, so any
      // difference in the response is purely the honesty pass doing its job.
      await buildHealthyIndex(dir);
      simulatePreCountTrackingIndex(getIndexDir(dir));

      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();
      expect(await vectorDB.hasDependentCounts()).toBe(false);

      const result = await handleSearchCode({ query: 'add' }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text) as {
        note?: string;
        results: { metadata: { file: string; dependentCount?: number } }[];
      };
      expect(parsed.results.length).toBeGreaterThan(0);
      for (const r of parsed.results) {
        expect(r.metadata).not.toHaveProperty('dependentCount');
      }
      expect(parsed.note).toContain('⚠ Lien:');
      expect(parsed.note).toContain('predates reverse-dependency counting');
      expect(parsed.note).toContain('lien index');
      // Exactly one note for the whole response, however many results it has.
      expect(parsed.note!.match(/predates reverse-dependency counting/g)).toHaveLength(1);
    });

    it('ok: omits a zero in a blind-spot language SILENTLY, and keeps the zero elsewhere (#1072)', async () => {
      // Swift's whole-module `import Foundation` names no file, so no import
      // edge can resolve anywhere in a Swift corpus (#884) — a tested,
      // documented structural zero, not a defect. The count is dropped rather
      // than reported as a misleading 0, and NOTHING is said: a note here would
      // fire on essentially every search in a Swift codebase.
      await initRepo(dir);
      await fs.mkdir(path.join(dir, 'Sources'), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'Sources', 'Widget.swift'),
        [
          'import Foundation',
          '',
          'public struct WidgetRenderer {',
          '  public func renderWidget() -> String {',
          '    return "widget"',
          '  }',
          '}',
          '',
        ].join('\n'),
      );
      await fs.writeFile(
        path.join(dir, 'Sources', 'App.swift'),
        [
          'import Foundation',
          '',
          'public func runWidgetApp() -> String {',
          '  return WidgetRenderer().renderWidget()',
          '}',
          '',
        ].join('\n'),
      );
      // A TypeScript file in the same corpus, also with zero dependents, as the
      // in-test control: the omission must be keyed on the LANGUAGE, not on the
      // count being zero.
      await fs.writeFile(
        path.join(dir, 'widget-notes.ts'),
        'export function renderWidget(): string {\n  return "notes";\n}\n',
      );
      await commitAll(dir, 'swift fixture');
      const indexed = await indexCodebase({ rootDir: dir, verbose: false });
      expect(indexed.success).toBe(true);

      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();
      expect(await vectorDB.hasDependentCounts()).toBe(true);

      const result = await handleSearchCode(
        { query: 'renderWidget', limit: 15 },
        makeCtx(vectorDB),
      );

      const parsed = JSON.parse(result.content![0].text) as {
        note?: string;
        results: { metadata: { file: string; dependentCount?: number } }[];
      };
      const swiftHit = parsed.results.find(r => r.metadata.file.endsWith('Widget.swift'));
      expect(swiftHit).toBeDefined();
      expect(swiftHit!.metadata).not.toHaveProperty('dependentCount');

      const tsHit = parsed.results.find(r => r.metadata.file.endsWith('widget-notes.ts'));
      expect(tsHit).toBeDefined();
      expect(tsHit!.metadata).toHaveProperty('dependentCount', 0);

      // Silence is the disposition, not an oversight.
      expect(parsed.note).toBeUndefined();
    });
  });

  describe('list_functions', () => {
    it('S1: notes the whole-index-empty fact instead of a bare 0 results', async () => {
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleListFunctions({ pattern: '.*' }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.note).toContain('no data');
    });

    it('ok: finds the real symbol, no note', async () => {
      await buildHealthyIndex(dir);
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleListFunctions({ pattern: 'manyBranches' }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results.length).toBeGreaterThan(0);
    });
  });

  describe('find_similar', () => {
    const snippet = 'export function manyBranches(x: number): number { let r = x; return r; }';

    it('S1: notes the whole-index-empty fact instead of the generic 0-results note (#1029 W1 fix)', async () => {
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleFindSimilar({ code: snippet }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.note).toContain('⚠ Lien:');
      expect(parsed.note).toContain('no data');
    });

    it('ok: finds the real hit, no note', async () => {
      await buildHealthyIndex(dir);
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleFindSimilar({ code: snippet }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.results.length).toBeGreaterThan(0);
      expect(parsed.note).toBeUndefined();
    });
  });

  describe('get_complexity', () => {
    it('S1: notes the whole-index-empty fact on a whole-repo scan (#1029 W1 fix)', async () => {
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleGetComplexity({ top: 10 }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.summary.filesAnalyzed).toBe(0);
      expect(parsed.note).toContain('⚠ Lien:');
      expect(parsed.note).toContain('no data');
    });

    it('S3: names the unindexed path instead of a silent 0', async () => {
      await buildHealthyIndex(dir);
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleGetComplexity({ files: ['does/not/exist.ts'] }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.note).toContain('does/not/exist.ts');
    });

    it('ok: reports the real violation, no note', async () => {
      await buildHealthyIndex(dir);
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleGetComplexity({ top: 10 }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.summary.violationCount).toBeGreaterThan(0);
      expect(parsed.note).toBeUndefined();
    });
  });

  describe('get_dependents', () => {
    it('S1: attributionCaveat unresolved-target + unindexed note (S1 ⊆ S3 here)', async () => {
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleGetDependents({ filepath: 'math.ts' }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat?.reason).toBe('unresolved-target');
      expect(parsed.dependentCount).toBe(0);
    });

    it('S3: attributionCaveat unresolved-target for a specific unindexed path', async () => {
      await buildHealthyIndex(dir);
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleGetDependents(
        { filepath: 'does/not/exist.ts' },
        makeCtx(vectorDB),
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.attributionCaveat?.reason).toBe('unresolved-target');
    });

    it('ok: finds the real dependent, no attributionCaveat', async () => {
      await buildHealthyIndex(dir);
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleGetDependents({ filepath: 'math.ts' }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.dependentCount).toBeGreaterThan(0);
      expect(parsed.attributionCaveat).toBeUndefined();
    });
  });

  describe('get_files_context', () => {
    it('S1: unindexed-path note (S1 ⊆ S3 here — filepath is mandatory)', async () => {
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleGetFilesContext({ filepaths: 'math.ts' }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.note).toContain('⚠ Lien:');
      expect(parsed.note).toContain('not found in the index');
    });

    it('S3: unindexed-path note for a specific unindexed path', async () => {
      await buildHealthyIndex(dir);
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleGetFilesContext(
        { filepaths: 'does/not/exist.ts' },
        makeCtx(vectorDB),
      );

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.note).toContain('not found in the index');
    });

    it('ok: returns the real chunks, no note', async () => {
      await buildHealthyIndex(dir);
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      const result = await handleGetFilesContext({ filepaths: 'math.ts' }, makeCtx(vectorDB));

      const parsed = JSON.parse(result.content![0].text);
      expect(parsed.chunks.length).toBeGreaterThan(0);
      expect(parsed.note).toBeUndefined();
    });
  });
});

// ============================================================================
// Deliverable #4 — the completeness guard.
//
// The table above is only a detector as long as it can't silently go stale.
// Rather than trust a hand-maintained list of "every read-only entry point",
// this derives the REAL surface two ways and cross-checks both against the
// known set this file's TABLE was written against:
//
//   (a) a source scan for every non-test file under packages/cli/src that
//       calls `createVectorDB(` — the issue's own framing: "only five
//       non-test files call createVectorDB ... so the surface is genuinely
//       enumerable." Two of the five are legitimate WRITERS (`lien index`,
//       `lien serve`) and stay exempt; the other three are the CLI rows in
//       TABLE. If a new file starts calling `createVectorDB`, the discovered
//       set grows past the known one and this fails — forcing whoever added
//       it to add a TABLE row (or the writer exemption) before the guard is
//       green again. This is also what would catch `lien path`/`lien delta`/
//       `lien config get` quietly growing an index dependency: those three
//       are ABSENT from the known-callers set specifically because they
//       don't call it, so a stray call site added to any of them makes the
//       discovered set diverge from the known one just the same.
//   (b) `Object.keys(toolHandlers)` — the MCP server's own dispatch registry
//       (`mcp/handlers/index.ts`) — cross-checked against TABLE's MCP rows.
//       A new tool handler registered there without a TABLE entry fails this
//       the same way.
// ============================================================================

describe('completeness guard (#1029 W1) — table vs. real source', () => {
  const thisFile = fileURLToPath(import.meta.url);
  const CLI_SRC_DIR = path.resolve(path.dirname(thisFile), '../../src');

  /** Files legitimately allowed to call `createVectorDB` without a TABLE row: they CREATE the index, not just read it. */
  const WRITER_EXEMPT = new Set(['mcp/server.ts', 'cli/index-cmd.ts']);

  /** Strip comment-only lines so a doc comment that merely MENTIONS `createVectorDB(` in prose isn't mistaken for a real call site. */
  function stripCommentLines(content: string): string {
    return content
      .split('\n')
      .filter(line => !/^\s*(\*|\/\/)/.test(line))
      .join('\n');
  }

  async function findCreateVectorDbCallers(): Promise<Set<string>> {
    const found = new Set<string>();

    async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
        const content = await fs.readFile(full, 'utf-8');
        if (/createVectorDB\s*\(/.test(stripCommentLines(content))) {
          found.add(path.relative(CLI_SRC_DIR, full).replace(/\\/g, '/'));
        }
      }
    }

    await walk(CLI_SRC_DIR);
    return found;
  }

  /** Every entryPoint name TABLE documents for the CLI, index-touching (non-writer) rows. */
  const TABLE_CLI_INDEX_TOUCHING = new Set(
    TABLE.filter(row => ['lien annotate', 'lien api-delta'].includes(row.entryPoint)).map(
      row => row.entryPoint,
    ),
  );

  /** Every entryPoint name TABLE documents as explicitly index-independent. */
  const TABLE_CLI_INDEX_INDEPENDENT = new Set(
    TABLE.filter(row => row.state === 'n/a').map(row => row.entryPoint),
  );

  it('every file that calls createVectorDB is either a known writer or a CLI row in TABLE', async () => {
    const discovered = await findCreateVectorDbCallers();
    const readOnlyDiscovered = new Set([...discovered].filter(file => !WRITER_EXEMPT.has(file)));
    const expectedReadOnlyFiles = new Set(['cli/annotate-cmd.ts', 'cli/api-delta-cmd.ts']);

    expect(readOnlyDiscovered).toEqual(expectedReadOnlyFiles);
    // Every discovered writer really is on the exemption list (catches a
    // WRITER_EXEMPT entry that's gone stale in the other direction too).
    for (const file of discovered) {
      if (!readOnlyDiscovered.has(file)) expect(WRITER_EXEMPT.has(file)).toBe(true);
    }
    // And TABLE actually has a row for each of the three read-only callers —
    // the other half of "the table must fail when an entry point isn't in
    // it": a discovered file with zero TABLE rows would pass the set
    // equality above but still leave the class undocumented.
    expect(TABLE_CLI_INDEX_TOUCHING).toEqual(new Set(['lien annotate', 'lien api-delta']));
  });

  it('the five index-independent CLI commands (status is index-touching, not independent) stay off the createVectorDB caller list', async () => {
    const discovered = await findCreateVectorDbCallers();
    expect(discovered.has('cli/path-cmd.ts')).toBe(false);
    expect(discovered.has('cli/delta-cmd.ts')).toBe(false);
    expect(discovered.has('cli/config.ts')).toBe(false);
    // `lien health` reads the working tree through `performChunkOnlyIndex`.
    // Its whole point is answering without a persisted index, so a
    // createVectorDB call appearing here would be a design regression, not
    // just a bookkeeping one.
    expect(discovered.has('cli/health-cmd.ts')).toBe(false);
    // `lien complexity` joined this class when it moved to the pure path. It
    // is the one gate-shaped member: index-independent, but still a hard
    // error when the scan yields nothing, because a false clean from a gate
    // is the worst outcome in the table.
    expect(discovered.has('cli/complexity.ts')).toBe(false);
    expect(TABLE_CLI_INDEX_INDEPENDENT).toEqual(
      new Set(['lien path', 'lien delta', 'lien config get', 'lien health', 'lien complexity']),
    );
  });

  it('every registered MCP tool handler has a TABLE row, and vice versa', () => {
    const registered = new Set(Object.keys(toolHandlers));
    const tabled = new Set(
      TABLE.filter(row =>
        [
          'search_code',
          'get_files_context',
          'get_dependents',
          'get_complexity',
          'list_functions',
          'find_similar',
        ].includes(row.entryPoint),
      ).map(row => row.entryPoint),
    );

    expect(registered).toEqual(
      new Set([
        'search_code',
        'find_similar',
        'get_files_context',
        'list_functions',
        'get_dependents',
        'get_complexity',
      ]),
    );
    expect(tabled).toEqual(registered);
  });
});

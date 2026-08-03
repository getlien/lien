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
import { createVectorDB, indexCodebase, type VectorDBInterface } from '@liendev/core';
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
  | 'worktree-none';

interface TableRow {
  entryPoint: string;
  state: EntryPointState;
  expected: string;
}

const TABLE: TableRow[] = [
  // --- CLI, index-touching (gate-shaped: hard error on S0/S1) ---
  { entryPoint: 'lien complexity', state: 'S0', expected: 'error, exit 1, "Index not found"' },
  {
    entryPoint: 'lien complexity',
    state: 'S1',
    expected: 'error, exit 1, "Index is empty (0 indexed files)"',
  },
  {
    entryPoint: 'lien complexity',
    state: 'S2',
    expected: 'loud stderr staleness warning, still analyzes (never silent, never blocks)',
  },
  {
    entryPoint: 'lien complexity',
    state: 'ok',
    expected: 'real report; exit 0 on a genuinely clean fixture (no over-firing)',
  },
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
    entryPoint: 'lien complexity',
    state: 'worktree-fresh',
    expected: 'real report from the shared base — no false "Index not found" (#1051 fix)',
  },
  {
    entryPoint: 'lien complexity',
    state: 'worktree-none',
    expected: 'still a real hard error (base also never indexed — no overcorrection)',
  },
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
  // --- MCP tools (S0 is structurally impossible: `lien serve` always
  //     initializes the store before registering tool handlers) ---
  {
    entryPoint: 'search_code',
    state: 'S1',
    expected: 'note: "⚠ Lien: ... no data" (never a bare confident 0 results)',
  },
  { entryPoint: 'search_code', state: 'ok', expected: 'real hit, no note' },
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
  // CLI, index-touching, gate-shaped: S0/S1 must be a hard error.
  // ==========================================================================

  describe('lien complexity', () => {
    it('S0: errors loudly, exit 1, never opens the database', async () => {
      await complexityCommand({ format: 'text' });

      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Index not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('S1: errors loudly, exit 1 (index directory exists, store has 0 rows)', async () => {
      const vectorDB = await createVectorDB(dir);
      await vectorDB.initialize();

      await complexityCommand({ format: 'text' });

      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Index is empty'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('S2: warns loudly but still analyzes (stale git state, never silent)', async () => {
      await buildHealthyIndex(dir);
      await fs.writeFile(path.join(dir, 'extra.ts'), 'export const z = 1;\n');
      await commitAll(dir, 'second commit');

      await complexityCommand({ format: 'text' });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stale'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Complexity Analysis'));
    });

    it('ok: reports the real violation on a genuinely clean, freshly-indexed fixture — no over-firing', async () => {
      await buildHealthyIndex(dir);

      await complexityCommand({ format: 'json' });

      const output = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
      expect(output.summary.filesAnalyzed).toBeGreaterThan(0);
      expect(output.summary.totalViolations).toBeGreaterThan(0);
      expect(errSpy).not.toHaveBeenCalled();
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
      it('worktree-fresh: real report from the shared base, not a false "Index not found" (#1051)', async () => {
        await buildHealthyIndex(dir);
        await chdirIntoFreshNestedWorktree();

        await complexityCommand({ format: 'json' });

        expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining('Index not found'));
        const output = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
        expect(output.summary.filesAnalyzed).toBeGreaterThan(0);
        expect(output.summary.totalViolations).toBeGreaterThan(0);
      });

      it('worktree-none: still a real hard error when the base ALSO has never been indexed (no overcorrection)', async () => {
        await initRepo(dir);
        await fs.writeFile(path.join(dir, 'a.ts'), 'export const a = 1;\n');
        await commitAll(dir, 'init');
        await chdirIntoFreshNestedWorktree();

        await complexityCommand({ format: 'text' });

        expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Index not found'));
        expect(exitSpy).toHaveBeenCalledWith(1);
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
    TABLE.filter(row =>
      ['lien complexity', 'lien annotate', 'lien api-delta'].includes(row.entryPoint),
    ).map(row => row.entryPoint),
  );

  /** Every entryPoint name TABLE documents as explicitly index-independent. */
  const TABLE_CLI_INDEX_INDEPENDENT = new Set(
    TABLE.filter(row => row.state === 'n/a').map(row => row.entryPoint),
  );

  it('every file that calls createVectorDB is either a known writer or a CLI row in TABLE', async () => {
    const discovered = await findCreateVectorDbCallers();
    const readOnlyDiscovered = new Set([...discovered].filter(file => !WRITER_EXEMPT.has(file)));
    const expectedReadOnlyFiles = new Set([
      'cli/annotate-cmd.ts',
      'cli/api-delta-cmd.ts',
      'cli/complexity.ts',
    ]);

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
    expect(TABLE_CLI_INDEX_TOUCHING).toEqual(
      new Set(['lien complexity', 'lien annotate', 'lien api-delta']),
    );
  });

  it('the three index-independent CLI commands (status is index-touching, not independent) stay off the createVectorDB caller list', async () => {
    const discovered = await findCreateVectorDbCallers();
    expect(discovered.has('cli/path-cmd.ts')).toBe(false);
    expect(discovered.has('cli/delta-cmd.ts')).toBe(false);
    expect(discovered.has('cli/config.ts')).toBe(false);
    expect(TABLE_CLI_INDEX_INDEPENDENT).toEqual(
      new Set(['lien path', 'lien delta', 'lien config get']),
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

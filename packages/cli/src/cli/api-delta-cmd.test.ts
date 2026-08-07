import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as coreModule from '@liendev/core';
import { apiDeltaCommand, formatApiDeltaText, type ApiDeltaOptions } from './api-delta-cmd.js';
import { readBlastEvents } from '../utils/blast-events.js';
import { clearDependencyCache } from '../mcp/handlers/dependency-analyzer.js';

const execFileAsync = promisify(execFile);

const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

// Only `createVectorDB` is mocked — everything else in this file (git
// plumbing, chunking) runs for real, mirroring annotate-cmd.test.ts's
// integration style.
vi.mock('@liendev/core', async () => {
  const actual = await vi.importActual<typeof import('@liendev/core')>('@liendev/core');
  return {
    ...actual,
    createVectorDB: vi.fn(actual.createVectorDB),
  };
});

describe('formatApiDeltaText', () => {
  it('reports a clean line when there are no changes', () => {
    const text = stripAnsi(formatApiDeltaText([], 'HEAD'));
    expect(text).toContain('no exported-signature changes vs HEAD');
  });

  it('renders a signature-changed row with dependent counts and risk', () => {
    const text = stripAnsi(
      formatApiDeltaText(
        [
          {
            filepath: 'src/foo.ts',
            changes: [
              {
                symbol: 'formatUser',
                symbolName: 'formatUser',
                kind: 'signature-changed',
                beforeSignature: 'a',
                afterSignature: 'b',
                dependentCount: 4,
                untestedDependentCount: 1,
                riskLevel: 'medium',
                enriched: true,
                docRefCount: null,
                docRefPaths: [],
                attributionCaveat: null,
              },
            ],
          },
        ],
        'HEAD',
      ),
    );
    expect(text).toContain('src/foo.ts');
    expect(text).toContain('formatUser');
    expect(text).toContain('4 dependents, 1 untested, risk medium');
    expect(text).toContain('get_dependents');
    expect(text).not.toContain('docs reference');
  });

  it('renders a degraded row without counts', () => {
    const text = stripAnsi(
      formatApiDeltaText(
        [
          {
            filepath: 'src/foo.ts',
            changes: [
              {
                symbol: 'oldHelper',
                symbolName: 'oldHelper',
                kind: 'removed',
                dependentCount: null,
                untestedDependentCount: null,
                riskLevel: null,
                enriched: false,
                docRefCount: null,
                docRefPaths: [],
                attributionCaveat: null,
              },
            ],
          },
        ],
        'HEAD',
      ),
    );
    expect(text).toContain('index unavailable for counts');
  });

  it('renders a removed row with docRefs, showing the capped path list and a "+N more" tail', () => {
    const text = stripAnsi(
      formatApiDeltaText(
        [
          {
            filepath: 'src/factory.ts',
            changes: [
              {
                symbol: 'createVectorDB',
                symbolName: 'createVectorDB',
                kind: 'removed',
                dependentCount: 26,
                untestedDependentCount: 2,
                riskLevel: 'critical',
                enriched: true,
                docRefCount: 5,
                docRefPaths: ['CLAUDE.md', 'docs/architecture/README.md', 'docs/guide.md'],
                attributionCaveat: null,
              },
            ],
          },
        ],
        'HEAD',
      ),
    );
    expect(text).toContain(
      '5 docs reference createVectorDB: CLAUDE.md, docs/architecture/README.md, docs/guide.md (+2 more)',
    );
  });

  // #1097: a bare "0 dependents, risk low" is a false-all-clear when the
  // underlying language has a known import-invisible access shape (C#,
  // Java, Kotlin, Swift) — the text renderer must surface the same caveat
  // get_dependents exposes as attributionCaveat, not silently drop it.
  it('renders the attributionCaveat note as a trailing warning line (#1097)', () => {
    const text = stripAnsi(
      formatApiDeltaText(
        [
          {
            filepath: 'src/main/java/Logger.java',
            changes: [
              {
                symbol: 'logInfo',
                symbolName: 'logInfo',
                kind: 'signature-changed',
                beforeSignature: 'a',
                afterSignature: 'b',
                dependentCount: 0,
                untestedDependentCount: 0,
                riskLevel: 'low',
                enriched: true,
                docRefCount: null,
                docRefPaths: [],
                attributionCaveat: {
                  reason: 'dependent-attribution-incomplete',
                  note: 'No import-based dependents were found for src/main/java/Logger.java (symbol: "logInfo"), but its language lets real callers use its exports with no per-file import naming it at all.',
                },
              },
            ],
          },
        ],
        'HEAD',
      ),
    );
    expect(text).toContain('Logger.java');
    expect(text).toContain('0 dependents, 0 untested, risk low');
    expect(text).toContain('logInfo');
    expect(text).toContain(
      'No import-based dependents were found for src/main/java/Logger.java (symbol: "logInfo")',
    );
  });

  it('omits the docRefs clause when docRefCount is zero', () => {
    const text = stripAnsi(
      formatApiDeltaText(
        [
          {
            filepath: 'src/foo.ts',
            changes: [
              {
                symbol: 'unusedHelper',
                symbolName: 'unusedHelper',
                kind: 'removed',
                dependentCount: 0,
                untestedDependentCount: 0,
                riskLevel: 'low',
                enriched: true,
                docRefCount: 0,
                docRefPaths: [],
                attributionCaveat: null,
              },
            ],
          },
        ],
        'HEAD',
      ),
    );
    expect(text).not.toContain('docs reference');
  });
});

describe('apiDeltaCommand — operational failures exit 2', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 2 on an empty --file (usage error, not silence)', async () => {
    await expect(apiDeltaCommand({ format: 'text', file: '' })).rejects.toThrow('__exit__:2');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('non-empty path'));
  });

  it('exits 2 on an empty --base', async () => {
    await expect(apiDeltaCommand({ format: 'text', base: '' })).rejects.toThrow('__exit__:2');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('non-empty ref'));
  });

  it('exits 2 on an invalid --format', async () => {
    await expect(apiDeltaCommand({ format: 'yaml' as unknown as 'text' })).rejects.toThrow(
      '__exit__:2',
    );
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid --format'));
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('apiDeltaCommand — integration (real git fixtures, no index)', () => {
  let dir: string;
  let home: string;
  let originalCwd: string;
  let originalHome: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  async function git(...args: string[]): Promise<void> {
    await execFileAsync('git', args, { cwd: dir });
  }

  async function write(rel: string, content: string): Promise<void> {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }

  async function initRepo(): Promise<void> {
    await git('init', '-q');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
  }

  async function commitAll(msg: string): Promise<void> {
    await git('add', '-A');
    await git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg);
  }

  /** Run apiDeltaCommand and resolve to the exit code, instead of throwing the sentinel. */
  async function runApiDelta(options: ApiDeltaOptions): Promise<number> {
    try {
      await apiDeltaCommand(options);
    } catch (error) {
      const match = /__exit__:(\d+)/.exec(error instanceof Error ? error.message : String(error));
      if (match) return Number(match[1]);
      throw error;
    }
    return 0;
  }

  function lastJsonLog(): Record<string, unknown> {
    const call = logSpy.mock.calls.at(-1);
    return JSON.parse(String(call?.[0]));
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-api-delta-cmd-'));
    dir = await fs.realpath(dir); // resolve macOS /var -> /private/var
    originalCwd = process.cwd();
    process.chdir(dir);

    // Isolate index/ledger recording under a temp LIEN_HOME so these tests
    // never touch the real developer machine's ~/.lien/indices, and never
    // find a real structural.db (exercising the degrade-to-signature-only path).
    originalHome = process.env.LIEN_HOME;
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-api-delta-cmd-home-'));
    process.env.LIEN_HOME = home;

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.LIEN_HOME;
    else process.env.LIEN_HOME = originalHome;
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('exits 2 outside a git repository', async () => {
    await fs.rm(path.join(dir, '.git'), { recursive: true, force: true }).catch(() => undefined);
    const exitCode = await runApiDelta({ format: 'text' });
    expect(exitCode).toBe(2);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('not a git repository'));
  });

  it('reports the exported-signature change for a single file (--file fast path, degraded — no index)', async () => {
    await initRepo();
    await write('a.ts', 'export function formatUser(user) { return user.name; }');
    await commitAll('init');
    await write('a.ts', 'export function formatUser(user, opts) { return user.name; }');

    const exitCode = await runApiDelta({ format: 'json', file: 'a.ts' });
    expect(exitCode).toBe(0); // advisory only — always exits 0 once it ran

    const result = lastJsonLog() as {
      filepath: string;
      changes: Array<{ symbol: string; kind: string; enriched: boolean }>;
    };
    expect(result.filepath).toBe('a.ts');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      symbol: 'formatUser',
      kind: 'signature-changed',
      enriched: false, // no structural.db in this fresh temp home
      dependentCount: null,
    });
  });

  it('prints the clean single-file object when the edit did not change an exported signature', async () => {
    await initRepo();
    await write('a.ts', 'export function formatUser(user) { return user.name; }');
    await commitAll('init');
    await write('a.ts', 'export function formatUser(user) { return user.name.trim(); }');

    const exitCode = await runApiDelta({ format: 'json', file: 'a.ts' });
    expect(exitCode).toBe(0);
    expect(lastJsonLog()).toEqual({ filepath: 'a.ts', changes: [] });
  });

  it('records one ledger event per changed file, readable via readBlastEvents', async () => {
    await initRepo();
    await write('a.ts', 'export function formatUser(user) { return user.name; }');
    await commitAll('init');
    await write('a.ts', 'export function formatUser(user, opts) { return user.name; }');

    await runApiDelta({ format: 'json', file: 'a.ts' });

    const events = await readBlastEvents(dir);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      filepath: 'a.ts',
      enriched: false,
      changes: [{ symbol: 'formatUser', kind: 'signature-changed' }],
    });
  });

  it('records nothing to the ledger for a clean run (no exported signature change)', async () => {
    await initRepo();
    await write('a.ts', 'export function formatUser(user) { return user.name; }');
    await commitAll('init');
    await write('a.ts', 'export function formatUser(user) { return user.name.trim(); }');

    await runApiDelta({ format: 'json', file: 'a.ts' });

    expect(await readBlastEvents(dir)).toEqual([]);
  });

  it('text format renders the report for the same single-file change', async () => {
    await initRepo();
    await write('a.ts', 'export function formatUser(user) { return user.name; }');
    await commitAll('init');
    await write('a.ts', 'export function formatUser(user, opts) { return user.name; }');

    await runApiDelta({ format: 'text', file: 'a.ts' });

    const text = stripAnsi(String(logSpy.mock.calls.at(-1)?.[0]));
    expect(text).toContain('formatUser');
    expect(text).toContain('index unavailable for counts');
  });
});

describe('apiDeltaCommand — enrichment when an index is present', () => {
  let dir: string;
  let home: string;
  let originalCwd: string;
  let originalHome: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  async function git(...args: string[]): Promise<void> {
    await execFileAsync('git', args, { cwd: dir });
  }

  async function write(rel: string, content: string): Promise<void> {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }

  function lastJsonLog(): Record<string, unknown> {
    const call = logSpy.mock.calls.at(-1);
    return JSON.parse(String(call?.[0]));
  }

  beforeEach(async () => {
    // `findDependents`'s scan cache (`dependency-analyzer.ts`) is keyed by
    // `indexVersion` alone and lives at module scope — several tests below
    // reuse `getCurrentVersion: () => 1`, so without clearing it here, a
    // later test's stub `scanAll` would be silently skipped in favor of an
    // earlier test's cached chunks at the same version.
    clearDependencyCache();

    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-api-delta-enrich-'));
    dir = await fs.realpath(dir);
    originalCwd = process.cwd();
    process.chdir(dir);

    originalHome = process.env.LIEN_HOME;
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-api-delta-enrich-home-'));
    process.env.LIEN_HOME = home;

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);

    await git('init', '-q');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.LIEN_HOME;
    else process.env.LIEN_HOME = originalHome;
    vi.restoreAllMocks();
    vi.mocked(coreModule.createVectorDB).mockClear();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('reports dependentCount/riskLevel/enriched:true when findDependents succeeds against a stub index', async () => {
    await write('a.ts', 'export function formatUser(user) { return user.name; }');
    await git('add', '-A');
    await git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    await write('a.ts', 'export function formatUser(user, opts) { return user.name; }');

    // `hasStructuralIndex`'s cheap pre-check only looks for the file's
    // existence at the real per-repo index dir — its content doesn't matter
    // since `createVectorDB` itself is mocked below.
    const { getIndexDir } = await import('@liendev/core');
    const realIndexDir = getIndexDir(dir);
    await fs.mkdir(realIndexDir, { recursive: true });
    await fs.writeFile(path.join(realIndexDir, 'structural.db'), '', 'utf-8');

    // The target file itself must have a chunk in the stub index (#928) --
    // get_dependents/findDependents now requires the requested target to be
    // indexed at all before running its fuzzy dependent search, to stop an
    // unresolvable path from silently inheriting an unrelated file's graph.
    // A real index always has at least one chunk for a.ts itself; this stub
    // must model that too, or the target reads as "not indexed" and
    // dependentCount comes back 0 regardless of caller.ts below.
    const targetChunk = {
      content: 'export function formatUser(user) { return user.name; }',
      metadata: {
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
        type: 'function',
        language: 'typescript',
        symbolName: 'formatUser',
        symbolType: 'function',
        exports: ['formatUser'],
      },
      score: 0,
      relevance: 'not_relevant',
    };
    const callerChunk = {
      content: 'formatUser(x);',
      metadata: {
        file: 'caller.ts',
        startLine: 1,
        endLine: 1,
        type: 'function',
        language: 'typescript',
        symbolName: 'useIt',
        symbolType: 'function',
        imports: ['./a'],
        importedSymbols: { './a': ['formatUser'] },
        callSites: [{ symbol: 'formatUser', line: 1 }],
      },
      score: 0,
      relevance: 'not_relevant',
    };
    vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      hasData: vi.fn().mockResolvedValue(true),
      getCurrentVersion: vi.fn().mockReturnValue(1),
      scanAll: vi.fn().mockResolvedValue([targetChunk, callerChunk]),
    } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

    await expect(apiDeltaCommand({ format: 'json', file: 'a.ts' })).rejects.toThrow('__exit__:0');

    const result = lastJsonLog() as {
      filepath: string;
      changes: Array<{
        symbol: string;
        enriched: boolean;
        dependentCount: number | null;
        untestedDependentCount: number | null;
      }>;
    };
    // The stub index supplies exactly one caller (caller.ts, a non-test file
    // importing and calling formatUser) — assert the real counts, not just
    // that enrichment ran at all.
    expect(result.changes[0]).toMatchObject({
      enriched: true,
      dependentCount: 1,
      untestedDependentCount: 1,
    });
    expect(errSpy).not.toHaveBeenCalled();
  });

  // #1029 W1: the index DIRECTORY existing (structural.db on disk) is not
  // the same as the store having usable data — a cleared/moved-aside/
  // mid-rebuild store must degrade exactly like "no index at all" (S0),
  // never report a real-looking `enriched: true, dependentCount: 0`.
  it('degrades to signature-only when the index directory exists but the store has 0 rows', async () => {
    await write('a.ts', 'export function formatUser(user) { return user.name; }');
    await git('add', '-A');
    await git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    await write('a.ts', 'export function formatUser(user, opts) { return user.name; }');

    const { getIndexDir } = await import('@liendev/core');
    const realIndexDir = getIndexDir(dir);
    await fs.mkdir(realIndexDir, { recursive: true });
    await fs.writeFile(path.join(realIndexDir, 'structural.db'), '', 'utf-8');

    vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      hasData: vi.fn().mockResolvedValue(false),
      getCurrentVersion: vi.fn().mockReturnValue(1),
      scanAll: vi.fn().mockResolvedValue([]),
    } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

    await expect(apiDeltaCommand({ format: 'json', file: 'a.ts' })).rejects.toThrow('__exit__:0');

    const result = lastJsonLog() as {
      changes: Array<{
        symbol: string;
        enriched: boolean;
        dependentCount: number | null;
        untestedDependentCount: number | null;
      }>;
    };
    expect(result.changes[0]).toMatchObject({
      symbol: 'formatUser',
      enriched: false,
      dependentCount: null,
      untestedDependentCount: null,
    });
  });

  it('reports docRefCount/docRefPaths for a REMOVED symbol referenced by doc chunks in the stub index', async () => {
    await write('a.ts', 'export function oldHelper() { return 1; }');
    await git('add', '-A');
    await git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    await write('a.ts', '// oldHelper removed\n');

    const { getIndexDir } = await import('@liendev/core');
    const realIndexDir = getIndexDir(dir);
    await fs.mkdir(realIndexDir, { recursive: true });
    await fs.writeFile(path.join(realIndexDir, 'structural.db'), '', 'utf-8');

    const docChunk = {
      content: 'The `oldHelper` function is documented here.',
      metadata: { file: 'CLAUDE.md', startLine: 1, endLine: 1, type: 'doc', language: 'markdown' },
      score: 0,
      relevance: 'not_relevant',
    };
    vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      hasData: vi.fn().mockResolvedValue(true),
      getCurrentVersion: vi.fn().mockReturnValue(1),
      scanAll: vi.fn().mockResolvedValue([docChunk]),
    } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

    await expect(apiDeltaCommand({ format: 'json', file: 'a.ts' })).rejects.toThrow('__exit__:0');

    const result = lastJsonLog() as {
      changes: Array<{
        kind: string;
        docRefCount: number | null;
        docRefPaths: string[];
      }>;
    };
    expect(result.changes[0]).toMatchObject({
      kind: 'removed',
      docRefCount: 1,
      docRefPaths: ['CLAUDE.md'],
    });

    const events = await readBlastEvents(dir);
    expect(events).toHaveLength(1);
    expect(events[0].changes[0]).toMatchObject({ symbol: 'oldHelper', docRefCount: 1 });
  });

  it('leaves docRefCount null for a signature-changed symbol (docRefs only applies to removals)', async () => {
    await write('a.ts', 'export function formatUser(user) { return user.name; }');
    await git('add', '-A');
    await git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    await write('a.ts', 'export function formatUser(user, opts) { return user.name; }');

    const { getIndexDir } = await import('@liendev/core');
    const realIndexDir = getIndexDir(dir);
    await fs.mkdir(realIndexDir, { recursive: true });
    await fs.writeFile(path.join(realIndexDir, 'structural.db'), '', 'utf-8');

    vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      hasData: vi.fn().mockResolvedValue(true),
      getCurrentVersion: vi.fn().mockReturnValue(1),
      scanAll: vi.fn().mockResolvedValue([]),
    } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

    await expect(apiDeltaCommand({ format: 'json', file: 'a.ts' })).rejects.toThrow('__exit__:0');

    const result = lastJsonLog() as {
      changes: Array<{ kind: string; docRefCount: number | null; docRefPaths: string[] }>;
    };
    expect(result.changes[0]).toMatchObject({
      kind: 'signature-changed',
      docRefCount: null,
      docRefPaths: [],
    });
  });

  // #1097: `enrichOneChange` always calls `findDependents` with
  // `change.symbolName` set (symbol-scoped), which is exactly the shape
  // that used to make `checkDependentAttributionIncomplete` (parser-side)
  // skip its whole determination unconditionally. A Java method with zero
  // import-graph-visible dependents (the same-package access shape #1005
  // already flags at the file level) must now surface the same caveat here
  // too, instead of a bare "0 dependents, risk low" false-all-clear.
  it('surfaces attributionCaveat for a zero-dependent Java SYMBOL query (same-package blind spot, #1097)', async () => {
    await write(
      'src/main/java/Logger.java',
      'public class Logger {\n  public void logInfo(String msg) {\n    System.out.println(msg);\n  }\n}\n',
    );
    await git('add', '-A');
    await git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    await write(
      'src/main/java/Logger.java',
      'public class Logger {\n  public void logInfo(String msg, String tag) {\n    System.out.println(msg);\n  }\n}\n',
    );

    const { getIndexDir } = await import('@liendev/core');
    const realIndexDir = getIndexDir(dir);
    await fs.mkdir(realIndexDir, { recursive: true });
    await fs.writeFile(path.join(realIndexDir, 'structural.db'), '', 'utf-8');

    // The stub index carries ONLY the target file's own chunk — no other
    // file's chunk anywhere in the corpus references it. This is the real
    // shape of #1005's Java same-package blind spot: real callers exist in
    // the same package with no import statement naming Logger at all, so
    // the import graph has zero candidate importers, not "some importers
    // that don't call logInfo specifically".
    const targetChunk = {
      content: 'public void logInfo(String msg) { System.out.println(msg); }',
      metadata: {
        file: 'src/main/java/Logger.java',
        startLine: 1,
        endLine: 5,
        type: 'function',
        language: 'java',
        symbolName: 'logInfo',
        symbolType: 'method',
        parentClass: 'Logger',
        exports: ['Logger'],
      },
      score: 0,
      relevance: 'not_relevant',
    };
    vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      hasData: vi.fn().mockResolvedValue(true),
      getCurrentVersion: vi.fn().mockReturnValue(1),
      scanAll: vi.fn().mockResolvedValue([targetChunk]),
    } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

    await expect(
      apiDeltaCommand({ format: 'json', file: 'src/main/java/Logger.java' }),
    ).rejects.toThrow('__exit__:0');

    const result = lastJsonLog() as {
      changes: Array<{
        symbol: string;
        symbolName: string;
        kind: string;
        enriched: boolean;
        dependentCount: number | null;
        attributionCaveat: { reason: string; note: string } | null;
      }>;
    };
    expect(result.changes[0].symbolName).toBe('logInfo');
    expect(result.changes[0].enriched).toBe(true);
    expect(result.changes[0].dependentCount).toBe(0);
    expect(result.changes[0].attributionCaveat).not.toBeNull();
    expect(result.changes[0].attributionCaveat?.reason).toBe('dependent-attribution-incomplete');
    expect(result.changes[0].attributionCaveat?.note).toContain('logInfo');

    // #1097 (Lien Review finding on this same PR): the persisted ledger
    // record must carry the same caveat as the live CLI output — dropping
    // it here would make `lien stats`/`readBlastEvents` see a false
    // verified-clear for a run that actually surfaced this exact hedge.
    const events = await readBlastEvents(dir);
    expect(events).toHaveLength(1);
    expect(events[0].changes[0].attributionCaveat).toMatchObject({
      reason: 'dependent-attribution-incomplete',
    });
  });

  // Control: the identical shape (symbol query, zero import-graph
  // dependents, targetIndexed) in a NON-blind-spot language (TypeScript)
  // must NOT start getting a spurious caveat — #1014's whole point is that
  // an over-firing caveat gets trained out as noise.
  it('does NOT surface attributionCaveat for a zero-dependent TypeScript SYMBOL query (control, #1097)', async () => {
    await write('a.ts', 'export function unusedHelper(x) { return x; }');
    await git('add', '-A');
    await git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    await write('a.ts', 'export function unusedHelper(x, y) { return x; }');

    const { getIndexDir } = await import('@liendev/core');
    const realIndexDir = getIndexDir(dir);
    await fs.mkdir(realIndexDir, { recursive: true });
    await fs.writeFile(path.join(realIndexDir, 'structural.db'), '', 'utf-8');

    const targetChunk = {
      content: 'export function unusedHelper(x) { return x; }',
      metadata: {
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
        type: 'function',
        language: 'typescript',
        symbolName: 'unusedHelper',
        symbolType: 'function',
        exports: ['unusedHelper'],
      },
      score: 0,
      relevance: 'not_relevant',
    };
    vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      hasData: vi.fn().mockResolvedValue(true),
      getCurrentVersion: vi.fn().mockReturnValue(1),
      scanAll: vi.fn().mockResolvedValue([targetChunk]),
    } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

    await expect(apiDeltaCommand({ format: 'json', file: 'a.ts' })).rejects.toThrow('__exit__:0');

    const result = lastJsonLog() as {
      changes: Array<{
        dependentCount: number | null;
        attributionCaveat: { reason: string; note: string } | null;
      }>;
    };
    expect(result.changes[0].dependentCount).toBe(0);
    expect(result.changes[0].attributionCaveat).toBeNull();
  });
});

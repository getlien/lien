import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { complexityCommand } from './complexity.js';
import * as coreModule from '@liendev/core';
import type { ChunkMetadata } from '@liendev/parser';

const execFileAsync = promisify(execFile);

// Mock dependencies
vi.mock('@liendev/core', async () => {
  const actual = await vi.importActual<typeof import('@liendev/core')>('@liendev/core');
  return {
    ...actual,
    createVectorDB: vi.fn(),
  };
});

describe('complexityCommand', () => {
  let mockVectorDB: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let consoleWarnSpy: any;
  let processExitSpy: any;
  let dir: string;
  let home: string;
  let originalCwd: string;
  let originalHome: string | undefined;

  /** Real per-repo index dir for `dir`, resolved the same way `hasStructuralIndex` does. */
  async function indexDir(): Promise<string> {
    const { getIndexDir } = await import('@liendev/core');
    return getIndexDir(dir);
  }

  /** Stub `structural.db` on real disk — its content never matters here since `createVectorDB` itself is mocked below; only its existence is what `hasStructuralIndex` checks. */
  async function writeIndexStub(): Promise<void> {
    const dbDir = await indexDir();
    await fs.mkdir(dbDir, { recursive: true });
    await fs.writeFile(path.join(dbDir, 'structural.db'), '', 'utf-8');
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-complexity-cmd-'));
    dir = await fs.realpath(dir); // resolve macOS /var -> /private/var
    originalCwd = process.cwd();
    process.chdir(dir);

    // Isolate under a temp LIEN_HOME so these tests never touch the real
    // developer machine's ~/.lien/indices, and the "index exists" check
    // below reflects only what each test sets up.
    originalHome = process.env.LIEN_HOME;
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-complexity-cmd-home-'));
    process.env.LIEN_HOME = home;

    // Most tests below assume an already-indexed project and only exercise
    // report/exit-code behavior — set that up by default; the "missing
    // index" test removes it.
    await writeIndexStub();

    // Mock VectorDB instance methods
    mockVectorDB = {
      initialize: vi.fn().mockResolvedValue(undefined),
      scanAll: vi.fn(), // Used for actual analysis
      // Healthy-index default; the "indexed-but-empty" test below overrides
      // this to `false` to exercise `classifyIndexState`'s S1 branch.
      hasData: vi.fn().mockResolvedValue(true),
    };

    // The factory hands back our mock instance
    vi.mocked(coreModule.createVectorDB).mockResolvedValue(mockVectorDB);

    // Spy on console
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Spy on process.exit - don't make it throw, just track calls
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      // Don't throw, just prevent actual exit
    }) as any);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(coreModule.createVectorDB).mockReset();
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.LIEN_HOME;
    else process.env.LIEN_HOME = originalHome;
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('should output text format by default', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 15,
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    mockVectorDB.scanAll.mockResolvedValue(chunks);

    await complexityCommand({
      format: 'text',
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain('Complexity Analysis');
  });

  it('should output JSON format when requested', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 15,
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    mockVectorDB.scanAll.mockResolvedValue(chunks);

    await complexityCommand({
      format: 'json',
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0][0];

    // Should be valid JSON
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output);
    expect(parsed.summary).toBeDefined();
    expect(parsed.files).toBeDefined();
  });

  it('should output SARIF format when requested', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 15,
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    mockVectorDB.scanAll.mockResolvedValue(chunks);

    await complexityCommand({
      format: 'sarif',
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0][0];

    // Should be valid JSON with SARIF structure
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output);
    expect(parsed.$schema).toContain('sarif');
    expect(parsed.runs).toBeDefined();
  });

  it('should filter by specific files when provided', async () => {
    const chunks = [
      {
        content: 'function test1() { }',
        metadata: {
          file: 'src/file1.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test1',
          symbolType: 'function',
          complexity: 15,
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
      {
        content: 'function test2() { }',
        metadata: {
          file: 'src/file2.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test2',
          symbolType: 'function',
          complexity: 20,
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    mockVectorDB.scanAll.mockResolvedValue(chunks);

    await complexityCommand({
      files: ['src/file1.ts'],
      format: 'json',
    });

    const output = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);

    // Should only include file1
    expect(parsed.files['src/file1.ts']).toBeDefined();
    expect(parsed.files['src/file2.ts']).toBeUndefined();
  });

  it('should exit with code 1 when --fail-on error and errors exist', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 35, // Will be error (>= 30, which is 2.0x threshold of 15)
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    mockVectorDB.scanAll.mockResolvedValue(chunks);

    await complexityCommand({
      format: 'text',
      failOn: 'error',
    });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should not exit when --fail-on error and only warnings exist', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 20, // Warning only (>= 15, < 30)
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    mockVectorDB.scanAll.mockResolvedValue(chunks);

    await complexityCommand({
      format: 'text',
      failOn: 'error',
    });

    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should exit with code 1 when --fail-on warning and warnings exist', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 20, // Warning (>= 15)
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    mockVectorDB.scanAll.mockResolvedValue(chunks);

    await complexityCommand({
      format: 'text',
      failOn: 'warning',
    });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle invalid --fail-on value', async () => {
    await complexityCommand({
      format: 'text',
      failOn: 'critical' as any, // Invalid value
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid --fail-on value "critical"'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle invalid --format value', async () => {
    await complexityCommand({
      format: 'xml' as any, // Invalid format
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid --format value "xml"'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  // Regression test for the false-clean-on-never-indexed-directory bug: a
  // virgin project (no structural.db on disk at all) used to sail through
  // `createVectorDB(rootDir).initialize()` — which itself creates an empty,
  // valid store via `CREATE TABLE IF NOT EXISTS` — and then report "0
  // violations, exit 0" as if the codebase were clean. It must instead fail
  // loudly, and it must never create the store as a side effect.
  it('should error loudly on a never-indexed project, without creating a structural.db', async () => {
    await fs.rm(await indexDir(), { recursive: true, force: true });

    await complexityCommand({ format: 'text' });

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Index not found'));
    expect(processExitSpy).toHaveBeenCalledWith(1);
    // The whole point of the fix: never even open the database for a
    // project that has never been indexed.
    expect(coreModule.createVectorDB).not.toHaveBeenCalled();
    await expect(fs.access(path.join(await indexDir(), 'structural.db'))).rejects.toThrow();
  });

  // Regression test for the sibling false-clean bug the "never-indexed" test
  // above doesn't cover: an index DIRECTORY that exists (structural.db is on
  // disk) but whose store has zero rows — e.g. cleared, moved aside, or
  // indexed against an all-ignored tree. Before this fix, `ensureIndexExists`
  // only checked file existence, so this state sailed straight through to
  // `ComplexityAnalyzer` and reported "0 violations, exit 0" indistinguishable
  // from a genuinely clean, fully-indexed codebase.
  it('should error loudly on an indexed-but-empty project (store has 0 rows), without proceeding to analysis', async () => {
    mockVectorDB.hasData.mockResolvedValue(false);

    await complexityCommand({ format: 'text' });

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Index is empty'));
    expect(processExitSpy).toHaveBeenCalledWith(1);
    // Never even ran the analyzer over the empty store.
    expect(mockVectorDB.scanAll).not.toHaveBeenCalled();
  });

  it('should handle a thrown error from the database gracefully once the index exists', async () => {
    mockVectorDB.scanAll.mockRejectedValue(new Error('corrupt store'));

    await complexityCommand({
      format: 'text',
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  describe('index staleness warning', () => {
    async function git(...args: string[]): Promise<void> {
      await execFileAsync('git', args, { cwd: dir });
    }

    async function initRepoWithCommit(): Promise<void> {
      await git('init', '-q');
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
      await git('config', 'commit.gpgsign', 'false');
      await fs.writeFile(path.join(dir, 'a.ts'), 'export const a = 1;\n');
      await git('add', '-A');
      await git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    }

    it('warns but still reports when the on-disk index git state differs from the current working tree', async () => {
      await initRepoWithCommit();
      await fs.writeFile(
        path.join(await indexDir(), '.git-state.json'),
        JSON.stringify({ branch: 'stale-branch', commit: '0'.repeat(40) }),
        'utf-8',
      );
      mockVectorDB.scanAll.mockResolvedValue([]);

      await complexityCommand({ format: 'text' });

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('stale'));
      // Still ran the real analysis — a staleness warning doesn't block.
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Complexity Analysis'));
    });

    it('does not warn when the on-disk index git state matches the current working tree', async () => {
      await initRepoWithCommit();
      const { getCurrentBranch, getCurrentCommit } = await import('@liendev/core');
      const branch = await getCurrentBranch(dir);
      const commit = await getCurrentCommit(dir);
      await fs.writeFile(
        path.join(await indexDir(), '.git-state.json'),
        JSON.stringify({ branch, commit }),
        'utf-8',
      );
      mockVectorDB.scanAll.mockResolvedValue([]);

      await complexityCommand({ format: 'text' });

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('does not warn when the index has no recorded git state (indexed before git tracking, or non-repo)', async () => {
      // No .git-state.json written, no git repo initialized: a genuinely
      // clean, freshly-indexed project must not get a false staleness
      // warning.
      mockVectorDB.scanAll.mockResolvedValue([]);

      await complexityCommand({ format: 'text' });

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });
});

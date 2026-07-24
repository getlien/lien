import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as coreModule from '@liendev/core';
import {
  noteEditCommand,
  noteRunCommand,
  reportCommand,
  formatVerifyTestsAdvisory,
  wasRecentlyBlocked,
  BLOCK_SUPPRESSION_WINDOW_MS,
} from './verify-tests-cmd.js';
import {
  recordEdit,
  recordRun,
  readSession,
  testSessionFilePath,
  type TestLedgerEvent,
} from '../utils/test-ledger.js';

// Only `createVectorDB` is mocked, mirroring annotate-cmd.test.ts's
// `--tests-only` integration style — `note-edit` drives the exact same
// `scanTestAssociations` helper `annotate --tests-only` uses.
vi.mock('@liendev/core', async () => {
  const actual = await vi.importActual<typeof import('@liendev/core')>('@liendev/core');
  return {
    ...actual,
    createVectorDB: vi.fn(actual.createVectorDB),
  };
});

// A stable, real file (must exist on disk — `resolvePaths` checks) with no
// requirement that it actually be associated with any test in the real
// index; `createVectorDB`'s `scanAll` is mocked per-test to control that.
const target = 'packages/cli/src/cli/index.ts';

function testChunkImporting(file: string): unknown {
  return {
    content: '',
    metadata: {
      file: 'packages/cli/src/cli/index.test.ts',
      startLine: 1,
      endLine: 5,
      type: 'function',
      language: 'typescript',
      symbolName: 'itWorks',
      symbolType: 'function',
      imports: [file],
    },
    score: 0,
    relevance: 'not_relevant',
  };
}

describe('formatVerifyTestsAdvisory', () => {
  it('renders the frozen wording, including the escape-hatch sentence', () => {
    const text = formatVerifyTestsAdvisory([
      { file: 'packages/cli/src/foo.ts', tests: ['foo.test.ts'] },
    ]);
    expect(text).toBe(
      [
        'Before finishing: these files you edited this session have associated tests I',
        'did not observe running in a Bash command:',
        '  • packages/cli/src/foo.ts → foo.test.ts',
        "If you already ran them (watch mode, an IDE, or a wrapper this ledger can't see),",
        'disregard and stop again. Otherwise, consider running them before you finish.',
      ].join('\n'),
    );
  });

  it('shows one test and a "(+N more)" suffix when a file has more than one associated test', () => {
    const text = formatVerifyTestsAdvisory([
      { file: 'packages/core/src/bar.ts', tests: ['bar.test.ts', 'bar.integration.test.ts'] },
    ]);
    expect(text).toContain('packages/core/src/bar.ts → bar.test.ts (+1 more)');
  });

  it('lists every unverified file', () => {
    const text = formatVerifyTestsAdvisory([
      { file: 'a.ts', tests: ['a.test.ts'] },
      { file: 'b.ts', tests: ['b.test.ts'] },
    ]);
    expect(text).toContain('• a.ts → a.test.ts');
    expect(text).toContain('• b.ts → b.test.ts');
  });
});

describe('wasRecentlyBlocked', () => {
  it('is false with no events', () => {
    expect(wasRecentlyBlocked([], new Date('2026-01-01T00:10:00.000Z'))).toBe(false);
  });

  it('is true for a blocked event within the window', () => {
    const events: TestLedgerEvent[] = [{ kind: 'blocked', timestamp: '2026-01-01T00:05:00.000Z' }];
    expect(wasRecentlyBlocked(events, new Date('2026-01-01T00:10:00.000Z'), 10 * 60 * 1000)).toBe(
      true,
    );
  });

  it('is false for a blocked event older than the window', () => {
    const events: TestLedgerEvent[] = [{ kind: 'blocked', timestamp: '2026-01-01T00:00:00.000Z' }];
    expect(wasRecentlyBlocked(events, new Date('2026-01-01T00:15:00.000Z'), 10 * 60 * 1000)).toBe(
      false,
    );
  });

  it('ignores non-blocked events', () => {
    const events: TestLedgerEvent[] = [
      { kind: 'edit', timestamp: '2026-01-01T00:09:00.000Z', file: 'a.ts', tests: [] },
      { kind: 'run', timestamp: '2026-01-01T00:09:30.000Z', command: 'npm test' },
    ];
    expect(wasRecentlyBlocked(events, new Date('2026-01-01T00:10:00.000Z'))).toBe(false);
  });

  it('ignores an unparsable timestamp rather than throwing', () => {
    const events: TestLedgerEvent[] = [{ kind: 'blocked', timestamp: 'not-a-date' }];
    expect(wasRecentlyBlocked(events, new Date())).toBe(false);
  });

  it('defaults the window to BLOCK_SUPPRESSION_WINDOW_MS', () => {
    const justInside = new Date(Date.now() - (BLOCK_SUPPRESSION_WINDOW_MS - 1000)).toISOString();
    const justOutside = new Date(Date.now() - (BLOCK_SUPPRESSION_WINDOW_MS + 1000)).toISOString();
    expect(wasRecentlyBlocked([{ kind: 'blocked', timestamp: justInside }])).toBe(true);
    expect(wasRecentlyBlocked([{ kind: 'blocked', timestamp: justOutside }])).toBe(false);
  });
});

describe('verify-tests-cmd — integration', () => {
  let home: string;
  let originalHome: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const session = 'verify-tests-cmd-test-session';

  beforeEach(async () => {
    originalHome = process.env.LIEN_HOME;
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-verify-tests-cmd-'));
    process.env.LIEN_HOME = home;

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.LIEN_HOME;
    else process.env.LIEN_HOME = originalHome;
    vi.restoreAllMocks();
    vi.mocked(coreModule.createVectorDB).mockClear();
    await fs.rm(home, { recursive: true, force: true });
  });

  describe('noteEditCommand', () => {
    it('records the edit and prints the byte-identical reminder line when the file has associated tests', async () => {
      vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
        initialize: vi.fn().mockResolvedValue(undefined),
        scanAll: vi.fn().mockResolvedValue([testChunkImporting(target)]),
      } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

      await noteEditCommand({ session, file: target });

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toBe(
        `Lien: you changed ${target} — associated tests: packages/cli/src/cli/index.test.ts. Run them before completing.`,
      );
      expect(exitSpy).toHaveBeenCalledWith(0);

      const rootDir = String((await import('./project-root.js')).resolveProjectRoot());
      const events = await readSession(rootDir, session);
      expect(events).toEqual([
        expect.objectContaining({
          kind: 'edit',
          file: target,
          tests: ['packages/cli/src/cli/index.test.ts'],
        }),
      ]);
    });

    it('prints the JSON shape in --format json', async () => {
      vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
        initialize: vi.fn().mockResolvedValue(undefined),
        scanAll: vi.fn().mockResolvedValue([testChunkImporting(target)]),
      } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

      await noteEditCommand({ session, file: target, format: 'json' });

      const parsed = JSON.parse(String(logSpy.mock.calls[0][0]));
      expect(parsed).toEqual({ filepath: target, tests: ['packages/cli/src/cli/index.test.ts'] });
    });

    it('prints nothing and records nothing when the file has no associated tests', async () => {
      vi.mocked(coreModule.createVectorDB).mockResolvedValueOnce({
        initialize: vi.fn().mockResolvedValue(undefined),
        scanAll: vi.fn().mockResolvedValue([testChunkImporting('some/other/file.ts')]),
      } as unknown as Awaited<ReturnType<typeof coreModule.createVectorDB>>);

      await noteEditCommand({ session, file: target });

      expect(logSpy).not.toHaveBeenCalled();
      const rootDir = String((await import('./project-root.js')).resolveProjectRoot());
      expect(await readSession(rootDir, session)).toEqual([]);
    });

    it('is a fail-open no-op when --session is missing', async () => {
      await noteEditCommand({ file: target });
      expect(logSpy).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('is a fail-open no-op when --file is missing', async () => {
      await noteEditCommand({ session });
      expect(logSpy).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('is a fail-open no-op on an invalid --format', async () => {
      await noteEditCommand({ session, file: target, format: 'yaml' });
      expect(logSpy).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('noteRunCommand', () => {
    it('records a run when the command looks like a test invocation', async () => {
      await noteRunCommand({ session, command: 'npm test' });

      const rootDir = String((await import('./project-root.js')).resolveProjectRoot());
      const events = await readSession(rootDir, session);
      expect(events).toEqual([expect.objectContaining({ kind: 'run', command: 'npm test' })]);
    });

    it('records nothing when the command does not look like a test run', async () => {
      await noteRunCommand({ session, command: 'git status' });

      const rootDir = String((await import('./project-root.js')).resolveProjectRoot());
      expect(await readSession(rootDir, session)).toEqual([]);
    });

    it('is a fail-open no-op when --session is missing', async () => {
      await noteRunCommand({ command: 'npm test' });
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('is a fail-open no-op when --command is missing', async () => {
      await noteRunCommand({ session });
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('reportCommand', () => {
    it('prints nothing when the session has no recorded events', async () => {
      await reportCommand({ session });
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('prints the advisory for an edit whose tests were never observed running', async () => {
      const rootDir = String((await import('./project-root.js')).resolveProjectRoot());
      await recordEdit(rootDir, session, 'packages/cli/src/foo.ts', ['foo.test.ts']);

      await reportCommand({ session });

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(String(logSpy.mock.calls[0][0])).toContain('packages/cli/src/foo.ts → foo.test.ts');
    });

    it('stays silent once a covering scoped run is recorded', async () => {
      const rootDir = String((await import('./project-root.js')).resolveProjectRoot());
      await recordEdit(rootDir, session, 'packages/cli/src/foo.ts', ['foo.test.ts']);
      await recordRun(rootDir, session, 'vitest run packages/cli/src/foo.test.ts');

      await reportCommand({ session });
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('stays silent once a broad run is recorded', async () => {
      const rootDir = String((await import('./project-root.js')).resolveProjectRoot());
      await recordEdit(rootDir, session, 'packages/cli/src/foo.ts', ['foo.test.ts']);
      await recordRun(rootDir, session, 'npm test');

      await reportCommand({ session });
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('prints the JSON {unverified} shape', async () => {
      const rootDir = String((await import('./project-root.js')).resolveProjectRoot());
      await recordEdit(rootDir, session, 'packages/cli/src/foo.ts', ['foo.test.ts']);

      await reportCommand({ session, format: 'json' });

      const parsed = JSON.parse(String(logSpy.mock.calls[0][0]));
      expect(parsed).toEqual({
        unverified: [{ file: 'packages/cli/src/foo.ts', tests: ['foo.test.ts'] }],
      });
    });

    it('is a fail-open no-op when --session is missing', async () => {
      await reportCommand({});
      expect(logSpy).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('records a blocked event the first time it actually blocks', async () => {
      const rootDir = String((await import('./project-root.js')).resolveProjectRoot());
      await recordEdit(rootDir, session, 'packages/cli/src/foo.ts', ['foo.test.ts']);

      await reportCommand({ session });

      const events = await readSession(rootDir, session);
      expect(events.some(e => e.kind === 'blocked')).toBe(true);
    });

    it('suppresses a second block within the 10-minute window (belt-and-braces loop prevention)', async () => {
      const rootDir = String((await import('./project-root.js')).resolveProjectRoot());
      await recordEdit(rootDir, session, 'packages/cli/src/foo.ts', ['foo.test.ts']);
      const filePath = testSessionFilePath(rootDir, session)!;
      await fs.appendFile(
        filePath,
        `${JSON.stringify({ kind: 'blocked', timestamp: new Date().toISOString() })}\n`,
        'utf-8',
      );

      await reportCommand({ session });

      expect(logSpy).not.toHaveBeenCalled();
    });

    it('blocks again once the suppression window has passed', async () => {
      const rootDir = String((await import('./project-root.js')).resolveProjectRoot());
      await recordEdit(rootDir, session, 'packages/cli/src/foo.ts', ['foo.test.ts']);
      const filePath = testSessionFilePath(rootDir, session)!;
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
      await fs.appendFile(
        filePath,
        `${JSON.stringify({ kind: 'blocked', timestamp: elevenMinutesAgo })}\n`,
        'utf-8',
      );

      await reportCommand({ session });

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(String(logSpy.mock.calls[0][0])).toContain('packages/cli/src/foo.ts → foo.test.ts');
    });

    it('the JSON {unverified} shape is also suppressed within the window (uniform across formats)', async () => {
      const rootDir = String((await import('./project-root.js')).resolveProjectRoot());
      await recordEdit(rootDir, session, 'packages/cli/src/foo.ts', ['foo.test.ts']);
      const filePath = testSessionFilePath(rootDir, session)!;
      await fs.appendFile(
        filePath,
        `${JSON.stringify({ kind: 'blocked', timestamp: new Date().toISOString() })}\n`,
        'utf-8',
      );

      await reportCommand({ session, format: 'json' });

      const parsed = JSON.parse(String(logSpy.mock.calls[0][0]));
      expect(parsed).toEqual({ unverified: [] });
    });
  });
});

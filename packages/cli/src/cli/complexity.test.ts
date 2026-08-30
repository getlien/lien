import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { complexityCommand } from './complexity.js';
import * as parserModule from '@liendev/parser';
import type { ChunkMetadata } from '@liendev/parser';

// `lien complexity` parses the working tree; there is no index to stub. Only
// the scan is mocked, so the real `analyzeComplexityFromChunks` runs over the
// chunks each test supplies.
vi.mock('@liendev/parser', async () => {
  const actual = await vi.importActual<typeof import('@liendev/parser')>('@liendev/parser');
  return { ...actual, performChunkOnlyIndex: vi.fn() };
});

/** A chunk complex enough to trip the warning threshold. */
function chunk(overrides: Partial<ChunkMetadata> = {}) {
  return {
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
      ...overrides,
    } as ChunkMetadata,
  };
}

/** Shape of a successful `performChunkOnlyIndex` result. */
function scanOf(chunks: ReturnType<typeof chunk>[]) {
  return {
    success: true,
    filesIndexed: new Set(chunks.map(c => c.metadata.file)).size,
    chunksCreated: chunks.length,
    durationMs: 1,
    chunks,
  };
}

describe('complexityCommand', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;
  let dir: string;
  let originalCwd: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-complexity-cmd-'));
    dir = await fs.realpath(dir); // resolve macOS /var -> /private/var
    originalCwd = process.cwd();
    process.chdir(dir);

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(parserModule.performChunkOnlyIndex).mockReset();
    process.chdir(originalCwd);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('outputs text format by default', async () => {
    vi.mocked(parserModule.performChunkOnlyIndex).mockResolvedValue(scanOf([chunk()]) as never);

    await complexityCommand({ format: 'text' });

    expect(consoleLogSpy).toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls[0][0]).toContain('Complexity Analysis');
  });

  it('outputs JSON when requested', async () => {
    vi.mocked(parserModule.performChunkOnlyIndex).mockResolvedValue(scanOf([chunk()]) as never);

    await complexityCommand({ format: 'json' });

    expect(() => JSON.parse(consoleLogSpy.mock.calls[0][0])).not.toThrow();
  });

  it('outputs SARIF when requested', async () => {
    vi.mocked(parserModule.performChunkOnlyIndex).mockResolvedValue(scanOf([chunk()]) as never);

    await complexityCommand({ format: 'sarif' });

    const sarif = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(sarif.$schema).toContain('sarif');
  });

  it('filters to the requested files', async () => {
    const chunks = [
      chunk({ file: 'src/keep.ts', symbolName: 'keep' }),
      chunk({ file: 'src/drop.ts', symbolName: 'drop' }),
    ];
    vi.mocked(parserModule.performChunkOnlyIndex).mockResolvedValue(scanOf(chunks) as never);
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/keep.ts'), '');

    await complexityCommand({ format: 'json', files: ['src/keep.ts'] });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain('keep.ts');
    expect(output).not.toContain('drop.ts');
  });

  it('exits 1 when --fail-on error and errors exist', async () => {
    // 2x threshold is the error band (SEVERITY.error), 15 is only a warning.
    vi.mocked(parserModule.performChunkOnlyIndex).mockResolvedValue(
      scanOf([chunk({ complexity: 60 })]) as never,
    );

    await complexityCommand({ format: 'text', failOn: 'error' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('does not exit when --fail-on error and only warnings exist', async () => {
    vi.mocked(parserModule.performChunkOnlyIndex).mockResolvedValue(
      scanOf([chunk({ complexity: 15 })]) as never,
    );

    await complexityCommand({ format: 'text', failOn: 'error' });

    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('exits 1 when --fail-on warning and warnings exist', async () => {
    vi.mocked(parserModule.performChunkOnlyIndex).mockResolvedValue(
      scanOf([chunk({ complexity: 15 })]) as never,
    );

    await complexityCommand({ format: 'text', failOn: 'warning' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects an invalid --fail-on value', async () => {
    await complexityCommand({ format: 'text', failOn: 'invalid' as never });
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects an invalid --format value', async () => {
    await complexityCommand({ format: 'invalid' as never });
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  // --- No-data honesty -----------------------------------------------------
  //
  // These replace the old S0/S1 index-state tests. The persisted index is
  // gone, so "never indexed" and "indexed but empty" no longer exist as
  // states — but the rule that produced them does. `lien complexity` is
  // gate-shaped, so a run with nothing to analyze must be a hard error, not a
  // confident "0 violations, exit 0".

  it('hard-errors when the scan fails, instead of reporting a clean codebase', async () => {
    vi.mocked(parserModule.performChunkOnlyIndex).mockResolvedValue({
      success: false,
      error: 'No files found to index',
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: 1,
      chunks: [],
    } as never);

    await complexityCommand({ format: 'text' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
    const errors = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(errors).toContain('No files found to index');
    expect(errors).toContain('not a clean result');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('hard-errors when the scan succeeds but parses nothing', async () => {
    vi.mocked(parserModule.performChunkOnlyIndex).mockResolvedValue(scanOf([]) as never);

    await complexityCommand({ format: 'text' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy.mock.calls.flat().join(' ')).toContain('no parseable chunks');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('never reports a clean result on no data, even without --fail-on', async () => {
    // The old bug shape: gate flags off, so an empty analysis would format as
    // "0 violations" and exit 0. The error must not depend on --fail-on.
    vi.mocked(parserModule.performChunkOnlyIndex).mockResolvedValue(scanOf([]) as never);

    await complexityCommand({ format: 'json' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('handles a thrown scan error gracefully', async () => {
    vi.mocked(parserModule.performChunkOnlyIndex).mockRejectedValue(new Error('boom'));

    await complexityCommand({ format: 'text' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

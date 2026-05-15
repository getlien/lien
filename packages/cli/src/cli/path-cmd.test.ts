import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import { extractRepoId } from '@liendev/parser';
import { pathCommand } from './path-cmd.js';

describe('pathCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('--store prints ~/.lien/indices/<repoId> for the current cwd', () => {
    pathCommand({ store: true });
    const expected = path.join(os.homedir(), '.lien', 'indices', extractRepoId(process.cwd()));
    expect(logSpy).toHaveBeenCalledWith(expected);
  });

  it('--extensions prints supported extensions, one per line, with no leading dot', () => {
    pathCommand({ extensions: true });
    expect(logSpy).toHaveBeenCalled();
    const lines = logSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(lines).toContain('ts');
    expect(lines).toContain('py');
    expect(lines.every((l: string) => !l.startsWith('.'))).toBe(true);
  });

  it('rejects no flags with a clear error and exit 1', () => {
    expect(() => pathCommand({})).toThrow('exit:1');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('specify one of'));
  });

  it('rejects both flags as mutually exclusive', () => {
    expect(() => pathCommand({ store: true, extensions: true })).toThrow('exit:1');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('mutually exclusive'));
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { extractRepoId } from '@liendev/parser';
import { gateCommand } from './gate-cmd.js';
import { resolveProjectRoot } from './project-root.js';

const STORE = path.join(
  os.homedir(),
  '.lien',
  'indices',
  extractRepoId(resolveProjectRoot(process.cwd())),
);
const DISABLED = path.join(STORE, 'gate-disabled');
const BLOCKING = path.join(STORE, 'gate-blocking');

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe('gateCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
    await fs.rm(DISABLED, { force: true });
    await fs.rm(BLOCKING, { force: true });
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    await fs.rm(DISABLED, { force: true });
    await fs.rm(BLOCKING, { force: true });
  });

  it('off writes gate-disabled and clears gate-blocking', async () => {
    await fs.mkdir(STORE, { recursive: true });
    await fs.writeFile(BLOCKING, '');
    await gateCommand('off');
    expect(await exists(DISABLED)).toBe(true);
    expect(await exists(BLOCKING)).toBe(false);
  });

  it('on clears both flags', async () => {
    await fs.mkdir(STORE, { recursive: true });
    await fs.writeFile(DISABLED, '');
    await fs.writeFile(BLOCKING, '');
    await gateCommand('on');
    expect(await exists(DISABLED)).toBe(false);
    expect(await exists(BLOCKING)).toBe(false);
  });

  it('block writes gate-blocking and clears gate-disabled', async () => {
    await fs.mkdir(STORE, { recursive: true });
    await fs.writeFile(DISABLED, '');
    await gateCommand('block');
    expect(await exists(BLOCKING)).toBe(true);
    expect(await exists(DISABLED)).toBe(false);
  });

  it('status reports the current mode without mutating state', async () => {
    await fs.mkdir(STORE, { recursive: true });
    await fs.writeFile(DISABLED, '');
    await gateCommand('status');
    expect(logSpy).toHaveBeenCalledWith(expect.anything(), 'off');
    expect(await exists(DISABLED)).toBe(true);
  });

  it('rejects unknown actions with exit 1', async () => {
    await expect(gateCommand('nope')).rejects.toThrow('exit:1');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('invalid action'));
  });
});

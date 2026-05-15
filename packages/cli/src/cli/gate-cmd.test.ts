import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { extractRepoId } from '@liendev/parser';
import { gateCommand } from './gate-cmd.js';
import { resolveProjectRoot } from './project-root.js';

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe('gateCommand', () => {
  let tmpHome: string;
  let STORE: string;
  let DISABLED: string;
  let ADVISORY: string;
  let LEGACY_BLOCKING: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let homeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-gate-test-'));
    homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);

    STORE = path.join(
      tmpHome,
      '.lien',
      'indices',
      extractRepoId(resolveProjectRoot(process.cwd())),
    );
    DISABLED = path.join(STORE, 'gate-disabled');
    ADVISORY = path.join(STORE, 'gate-advisory');
    LEGACY_BLOCKING = path.join(STORE, 'gate-blocking');

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    homeSpy.mockRestore();
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('on clears every flag (blocking is the default, no flag needed)', async () => {
    await fs.mkdir(STORE, { recursive: true });
    await fs.writeFile(DISABLED, '');
    await fs.writeFile(ADVISORY, '');
    await fs.writeFile(LEGACY_BLOCKING, '');
    await gateCommand('on');
    expect(await exists(DISABLED)).toBe(false);
    expect(await exists(ADVISORY)).toBe(false);
    expect(await exists(LEGACY_BLOCKING)).toBe(false);
  });

  it('block is an alias of on', async () => {
    await fs.mkdir(STORE, { recursive: true });
    await fs.writeFile(ADVISORY, '');
    await gateCommand('block');
    expect(await exists(ADVISORY)).toBe(false);
    expect(await exists(DISABLED)).toBe(false);
  });

  it('off writes gate-disabled and clears advisory/legacy flags', async () => {
    await fs.mkdir(STORE, { recursive: true });
    await fs.writeFile(ADVISORY, '');
    await fs.writeFile(LEGACY_BLOCKING, '');
    await gateCommand('off');
    expect(await exists(DISABLED)).toBe(true);
    expect(await exists(ADVISORY)).toBe(false);
    expect(await exists(LEGACY_BLOCKING)).toBe(false);
  });

  it('advisory writes gate-advisory and clears disabled/legacy flags', async () => {
    await fs.mkdir(STORE, { recursive: true });
    await fs.writeFile(DISABLED, '');
    await fs.writeFile(LEGACY_BLOCKING, '');
    await gateCommand('advisory');
    expect(await exists(ADVISORY)).toBe(true);
    expect(await exists(DISABLED)).toBe(false);
    expect(await exists(LEGACY_BLOCKING)).toBe(false);
  });

  it('status reports off when gate-disabled exists', async () => {
    await fs.mkdir(STORE, { recursive: true });
    await fs.writeFile(DISABLED, '');
    await gateCommand('status');
    expect(logSpy).toHaveBeenCalledWith(expect.anything(), 'off');
    expect(await exists(DISABLED)).toBe(true);
  });

  it('status reports advisory when gate-advisory exists', async () => {
    await fs.mkdir(STORE, { recursive: true });
    await fs.writeFile(ADVISORY, '');
    await gateCommand('status');
    expect(logSpy).toHaveBeenCalledWith(expect.anything(), 'advisory (UI-only)');
  });

  it('status reports on (blocking) when no flags are set', async () => {
    await fs.mkdir(STORE, { recursive: true });
    await gateCommand('status');
    expect(logSpy).toHaveBeenCalledWith(expect.anything(), 'on (blocking)');
  });

  it('rejects unknown actions with exit 1', async () => {
    await expect(gateCommand('nope')).rejects.toThrow('exit:1');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('invalid action'));
  });
});

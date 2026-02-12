import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { initCommand } from './init.js';

describe('initCommand', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    testDir = path.join(process.cwd(), '.test-init-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });

    originalCwd = process.cwd();
    process.chdir(testDir);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);

    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    vi.restoreAllMocks();
  });

  it('should create .cursor/mcp.json when nothing exists', async () => {
    await initCommand({ yes: true });

    const mcpConfigPath = path.join(testDir, '.cursor', 'mcp.json');
    const raw = await fs.readFile(mcpConfigPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config).toEqual({
      mcpServers: {
        lien: { command: 'lien', args: ['serve'] },
      },
    });
  });

  it('should merge into existing .cursor/mcp.json without lien entry', async () => {
    const cursorDir = path.join(testDir, '.cursor');
    await fs.mkdir(cursorDir, { recursive: true });
    const mcpConfigPath = path.join(cursorDir, 'mcp.json');
    await fs.writeFile(
      mcpConfigPath,
      JSON.stringify({ mcpServers: { other: { command: 'other' } } }),
    );

    await initCommand({ yes: true });

    const raw = await fs.readFile(mcpConfigPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.lien).toEqual({ command: 'lien', args: ['serve'] });
    expect(config.mcpServers.other).toEqual({ command: 'other' });
  });

  it('should skip when already configured', async () => {
    const cursorDir = path.join(testDir, '.cursor');
    await fs.mkdir(cursorDir, { recursive: true });
    const mcpConfigPath = path.join(cursorDir, 'mcp.json');
    const existingConfig = {
      mcpServers: { lien: { command: 'lien', args: ['serve'] } },
    };
    await fs.writeFile(mcpConfigPath, JSON.stringify(existingConfig));

    const logSpy = vi.spyOn(console, 'log');

    await initCommand({ yes: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Already configured'));

    // File should not have been rewritten
    const raw = await fs.readFile(mcpConfigPath, 'utf-8');
    // Original was written without pretty-print, so it should stay the same
    expect(raw).toBe(JSON.stringify(existingConfig));
  });

  it('should warn about legacy .lien.config.json', async () => {
    const legacyPath = path.join(testDir, '.lien.config.json');
    await fs.writeFile(legacyPath, JSON.stringify({ version: '0.2.0' }));

    const logSpy = vi.spyOn(console, 'log');

    await initCommand({ yes: true });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('.lien.config.json found but no longer used'),
    );
  });

  it('should handle permission errors gracefully', async () => {
    await expect(initCommand({ yes: true })).resolves.not.toThrow();
  });
});

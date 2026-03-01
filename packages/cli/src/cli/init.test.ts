import { execFileSync } from 'child_process';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { initCommand } from './init.js';
import type { EditorId } from './init.js';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

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

  // --- Cursor ---

  it('should create .cursor/mcp.json when nothing exists', async () => {
    await initCommand({ editor: 'cursor' });

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

    await initCommand({ editor: 'cursor' });

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

    await initCommand({ editor: 'cursor' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Already configured'));

    // File should not have been rewritten
    const raw = await fs.readFile(mcpConfigPath, 'utf-8');
    expect(raw).toBe(JSON.stringify(existingConfig));
  });

  it('should show Cursor restart message', async () => {
    const logSpy = vi.spyOn(console, 'log');
    await initCommand({ editor: 'cursor' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Restart Cursor to activate.'));
  });

  // --- Claude Code ---

  it('should create .mcp.json for claude-code', async () => {
    await initCommand({ editor: 'claude-code' });

    const configPath = path.join(testDir, '.mcp.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config).toEqual({
      mcpServers: {
        lien: { command: 'lien', args: ['serve'] },
      },
    });
  });

  it('should merge into existing .mcp.json for claude-code', async () => {
    const configPath = path.join(testDir, '.mcp.json');
    await fs.writeFile(configPath, JSON.stringify({ mcpServers: { other: { command: 'other' } } }));

    await initCommand({ editor: 'claude-code' });

    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.lien).toEqual({ command: 'lien', args: ['serve'] });
    expect(config.mcpServers.other).toEqual({ command: 'other' });
  });

  it('should show Claude Code restart message', async () => {
    const logSpy = vi.spyOn(console, 'log');
    await initCommand({ editor: 'claude-code' });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Restart Claude Code to activate.'),
    );
  });

  // --- Windsurf ---

  it('should create global mcp_config.json for windsurf with --root', async () => {
    // Mock homedir to point inside testDir so we don't write to real home
    const fakeHome = path.join(testDir, 'fakehome');
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    await initCommand({ editor: 'windsurf' });

    const configPath = path.join(fakeHome, '.codeium', 'windsurf', 'mcp_config.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.lien.command).toBe('lien');
    expect(config.mcpServers.lien.args).toContain('--root');
    expect(config.mcpServers.lien.args).toContain(path.resolve(testDir));
  });

  it('should merge into existing windsurf config', async () => {
    const fakeHome = path.join(testDir, 'fakehome');
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const configDir = path.join(fakeHome, '.codeium', 'windsurf');
    await fs.mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, 'mcp_config.json');
    await fs.writeFile(configPath, JSON.stringify({ mcpServers: { other: { command: 'other' } } }));

    await initCommand({ editor: 'windsurf' });

    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.lien.args).toContain('--root');
    expect(config.mcpServers.other).toEqual({ command: 'other' });
  });

  it('should show Windsurf restart message', async () => {
    const fakeHome = path.join(testDir, 'fakehome');
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const logSpy = vi.spyOn(console, 'log');
    await initCommand({ editor: 'windsurf' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Restart Windsurf to activate.'));
  });

  // --- OpenCode ---

  it('should create opencode.json with mcp key and array command', async () => {
    await initCommand({ editor: 'opencode' });

    const configPath = path.join(testDir, 'opencode.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config).toEqual({
      mcp: {
        lien: { type: 'local', command: ['lien', 'serve'] },
      },
    });
  });

  it('should merge into existing opencode.json preserving non-mcp keys', async () => {
    const configPath = path.join(testDir, 'opencode.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({ theme: 'dark', mcp: { other: { type: 'local', command: ['other'] } } }),
    );

    await initCommand({ editor: 'opencode' });

    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config.theme).toBe('dark');
    expect(config.mcp.lien).toEqual({ type: 'local', command: ['lien', 'serve'] });
    expect(config.mcp.other).toEqual({ type: 'local', command: ['other'] });
  });

  it('should skip when opencode already configured', async () => {
    const configPath = path.join(testDir, 'opencode.json');
    const existingConfig = {
      mcp: { lien: { type: 'local', command: ['lien', 'serve'] } },
    };
    await fs.writeFile(configPath, JSON.stringify(existingConfig));

    const logSpy = vi.spyOn(console, 'log');
    await initCommand({ editor: 'opencode' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Already configured'));

    // File should not have been rewritten
    const raw = await fs.readFile(configPath, 'utf-8');
    expect(raw).toBe(JSON.stringify(existingConfig));
  });

  it('should show OpenCode restart message', async () => {
    const logSpy = vi.spyOn(console, 'log');
    await initCommand({ editor: 'opencode' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Restart OpenCode to activate.'));
  });

  // --- Kilo Code ---

  it('should create .kilocode/mcp.json for kilo-code', async () => {
    await initCommand({ editor: 'kilo-code' });

    const configPath = path.join(testDir, '.kilocode', 'mcp.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config).toEqual({
      mcpServers: {
        lien: { command: 'lien', args: ['serve'] },
      },
    });
  });

  it('should merge into existing .kilocode/mcp.json', async () => {
    const kiloDir = path.join(testDir, '.kilocode');
    await fs.mkdir(kiloDir, { recursive: true });
    const configPath = path.join(kiloDir, 'mcp.json');
    await fs.writeFile(configPath, JSON.stringify({ mcpServers: { other: { command: 'other' } } }));

    await initCommand({ editor: 'kilo-code' });

    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.lien).toEqual({ command: 'lien', args: ['serve'] });
    expect(config.mcpServers.other).toEqual({ command: 'other' });
  });

  it('should show VS Code restart message for kilo-code', async () => {
    const logSpy = vi.spyOn(console, 'log');
    await initCommand({ editor: 'kilo-code' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Restart VS Code to activate.'));
  });

  // --- Antigravity ---

  it('should print snippet instead of writing a file for antigravity', async () => {
    const logSpy = vi.spyOn(console, 'log');

    await initCommand({ editor: 'antigravity' });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Add this to your Antigravity MCP settings.'),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"mcpServers"'));

    // No config file should have been written
    const files = await fs.readdir(testDir);
    const configFiles = files.filter(
      f => f.endsWith('.json') || f.startsWith('.cursor') || f.startsWith('.kilocode'),
    );
    expect(configFiles).toHaveLength(0);
  });

  // --- Legacy config warning ---

  it('should warn about legacy .lien.config.json', async () => {
    const legacyPath = path.join(testDir, '.lien.config.json');
    await fs.writeFile(legacyPath, JSON.stringify({ version: '0.2.0' }));

    const logSpy = vi.spyOn(console, 'log');

    await initCommand({ editor: 'cursor' });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('.lien.config.json found but no longer used'),
    );
  });

  // --- Edge cases ---

  it('should complete without throwing errors', async () => {
    await expect(initCommand({ editor: 'cursor' })).resolves.not.toThrow();
  });

  it('should not have --root in per-project editor args', async () => {
    const perProjectEditors: EditorId[] = ['cursor', 'claude-code', 'opencode', 'kilo-code'];

    for (const editorId of perProjectEditors) {
      await initCommand({ editor: editorId });
    }

    // Check cursor config doesn't have --root
    const cursorConfig = JSON.parse(
      await fs.readFile(path.join(testDir, '.cursor', 'mcp.json'), 'utf-8'),
    );
    expect(cursorConfig.mcpServers.lien.args).not.toContain('--root');

    // Check opencode config doesn't have --root
    const opencodeConfig = JSON.parse(
      await fs.readFile(path.join(testDir, 'opencode.json'), 'utf-8'),
    );
    expect(opencodeConfig.mcp.lien.command).not.toContain('--root');
  });

  // --- --with-lsp ---

  it('should create .lsp.json for claude-code with --with-lsp when tsconfig.json exists', async () => {
    await fs.writeFile(path.join(testDir, 'tsconfig.json'), '{}');
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(''));

    await initCommand({ editor: 'claude-code', withLsp: true });

    const lspConfigPath = path.join(testDir, '.lsp.json');
    const raw = await fs.readFile(lspConfigPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config.typescript).toBeDefined();
    expect(config.typescript.command).toBe('typescript-language-server');
    expect(config.typescript.args).toEqual(['--stdio']);
    expect(config.typescript.extensionToLanguage['.ts']).toBe('typescript');
  });

  it('should detect multiple languages from project markers', async () => {
    await fs.writeFile(path.join(testDir, 'package.json'), '{}');
    await fs.writeFile(path.join(testDir, 'requirements.txt'), '');
    await fs.writeFile(path.join(testDir, 'go.mod'), '');
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(''));

    await initCommand({ editor: 'claude-code', withLsp: true });

    const raw = await fs.readFile(path.join(testDir, '.lsp.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.typescript).toBeDefined();
    expect(config.python).toBeDefined();
    expect(config.go).toBeDefined();
  });

  it('should detect Go from go.mod marker', async () => {
    await fs.writeFile(path.join(testDir, 'go.mod'), '');
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(''));

    await initCommand({ editor: 'claude-code', withLsp: true });

    const raw = await fs.readFile(path.join(testDir, '.lsp.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.go).toEqual({
      command: 'gopls',
      args: ['serve'],
      extensionToLanguage: { '.go': 'go' },
    });
  });

  it('should detect Rust from Cargo.toml marker', async () => {
    await fs.writeFile(path.join(testDir, 'Cargo.toml'), '');
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(''));

    await initCommand({ editor: 'claude-code', withLsp: true });

    const raw = await fs.readFile(path.join(testDir, '.lsp.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.rust).toEqual({
      command: 'rust-analyzer',
      extensionToLanguage: { '.rs': 'rust' },
    });
    // rust-analyzer has empty args, so args should not be present
    expect(config.rust.args).toBeUndefined();
  });

  it('should detect C# from .csproj marker extension', async () => {
    await fs.writeFile(path.join(testDir, 'MyApp.csproj'), '');
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(''));

    await initCommand({ editor: 'claude-code', withLsp: true });

    const raw = await fs.readFile(path.join(testDir, '.lsp.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.csharp).toBeDefined();
    expect(config.csharp.command).toBe('csharp-ls');
  });

  it('should detect Java from pom.xml marker', async () => {
    await fs.writeFile(path.join(testDir, 'pom.xml'), '');
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(''));

    await initCommand({ editor: 'claude-code', withLsp: true });

    const raw = await fs.readFile(path.join(testDir, '.lsp.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.java).toBeDefined();
    expect(config.java.command).toBe('jdtls');
  });

  it('should detect PHP from composer.json marker', async () => {
    await fs.writeFile(path.join(testDir, 'composer.json'), '{}');
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(''));

    await initCommand({ editor: 'claude-code', withLsp: true });

    const raw = await fs.readFile(path.join(testDir, '.lsp.json'), 'utf-8');
    const config = JSON.parse(raw);

    expect(config.php).toBeDefined();
    expect(config.php.command).toBe('phpactor');
    expect(config.php.args).toEqual(['language-server']);
  });

  it('should skip .lsp.json when no languages detected', async () => {
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(''));

    const logSpy = vi.spyOn(console, 'log');
    await initCommand({ editor: 'claude-code', withLsp: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No supported languages detected'));

    // .lsp.json should not exist
    await expect(fs.access(path.join(testDir, '.lsp.json'))).rejects.toThrow();
  });

  it('should skip .lsp.json when it already exists', async () => {
    await fs.writeFile(path.join(testDir, 'tsconfig.json'), '{}');
    const existingLsp = { typescript: { command: 'custom-ts-server' } };
    await fs.writeFile(path.join(testDir, '.lsp.json'), JSON.stringify(existingLsp));
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(''));

    const logSpy = vi.spyOn(console, 'log');
    await initCommand({ editor: 'claude-code', withLsp: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Already configured'));

    // File should not have been overwritten
    const raw = await fs.readFile(path.join(testDir, '.lsp.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual(existingLsp);
  });

  it('should warn about missing LSP binaries', async () => {
    await fs.writeFile(path.join(testDir, 'go.mod'), '');
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not found');
    });

    const logSpy = vi.spyOn(console, 'log');
    await initCommand({ editor: 'claude-code', withLsp: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('gopls not found'));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('go install golang.org/x/tools/gopls@latest'),
    );
  });

  it('should not warn when LSP binary is available', async () => {
    await fs.writeFile(path.join(testDir, 'go.mod'), '');
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from('/usr/local/bin/gopls'));

    const logSpy = vi.spyOn(console, 'log');
    await initCommand({ editor: 'claude-code', withLsp: true });

    const warningCalls = logSpy.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('not found'),
    );
    expect(warningCalls).toHaveLength(0);
  });

  it('should warn when --with-lsp is used with non-claude-code editor', async () => {
    const logSpy = vi.spyOn(console, 'log');
    await initCommand({ editor: 'cursor', withLsp: true });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('--with-lsp is currently only supported for Claude Code'),
    );

    // .lsp.json should not exist
    await expect(fs.access(path.join(testDir, '.lsp.json'))).rejects.toThrow();
  });

  it('should not create .lsp.json without --with-lsp flag', async () => {
    await fs.writeFile(path.join(testDir, 'tsconfig.json'), '{}');

    await initCommand({ editor: 'claude-code' });

    await expect(fs.access(path.join(testDir, '.lsp.json'))).rejects.toThrow();
  });

  it('should omit args when LSP server has empty args array', async () => {
    await fs.writeFile(path.join(testDir, 'Cargo.toml'), '');
    vi.mocked(execFileSync).mockImplementation(() => Buffer.from(''));

    await initCommand({ editor: 'claude-code', withLsp: true });

    const raw = await fs.readFile(path.join(testDir, '.lsp.json'), 'utf-8');
    const config = JSON.parse(raw);

    // rust-analyzer has empty args, so 'args' key should not be present
    expect(Object.keys(config.rust)).toEqual(['command', 'extensionToLanguage']);
  });
});

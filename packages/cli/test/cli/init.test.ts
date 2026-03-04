import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { initCommand } from '../../src/cli/init.js';
import { EXPLORE_AGENT_CONTENT } from '../../src/cli/agents/explore-agent.js';

describe('initCommand', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-init-test-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('Explore agent installation', () => {
    it('installs .claude/agents/Explore.md for claude-code', async () => {
      await initCommand({ editor: 'claude-code', path: tmpDir });

      const agentPath = path.join(tmpDir, '.claude', 'agents', 'Explore.md');
      const content = await fs.readFile(agentPath, 'utf-8');
      expect(content).toBe(EXPLORE_AGENT_CONTENT);
    });

    it('does not overwrite existing Explore.md', async () => {
      const agentPath = path.join(tmpDir, '.claude', 'agents', 'Explore.md');
      await fs.mkdir(path.dirname(agentPath), { recursive: true });
      await fs.writeFile(agentPath, 'custom content');

      await initCommand({ editor: 'claude-code', path: tmpDir });

      const content = await fs.readFile(agentPath, 'utf-8');
      expect(content).toBe('custom content');
    });

    it('does not install Explore agent for non-claude-code editors', async () => {
      await initCommand({ editor: 'cursor', path: tmpDir });

      const agentPath = path.join(tmpDir, '.claude', 'agents', 'Explore.md');
      await expect(fs.access(agentPath)).rejects.toThrow();
    });
  });
});

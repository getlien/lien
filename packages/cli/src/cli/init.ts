import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { showCompactBanner } from '../utils/banner.js';

export interface InitOptions {
  upgrade?: boolean;
  yes?: boolean;
  path?: string;
}

const MCP_CONFIG = {
  command: 'lien',
  args: ['serve'],
};

export async function initCommand(options: InitOptions = {}) {
  showCompactBanner();

  const rootDir = options.path || process.cwd();
  const cursorDir = path.join(rootDir, '.cursor');
  const mcpConfigPath = path.join(cursorDir, 'mcp.json');

  // Check if .cursor/mcp.json exists
  let existingConfig: { mcpServers?: Record<string, unknown> } | null = null;
  try {
    const raw = await fs.readFile(mcpConfigPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Validate parsed JSON is a plain object we can merge into
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existingConfig = parsed;
    }
  } catch {
    // File doesn't exist or isn't valid JSON
  }

  if (existingConfig?.mcpServers?.lien) {
    // Already configured
    console.log(chalk.green('\n✓ Already configured — .cursor/mcp.json contains lien entry'));
  } else if (existingConfig) {
    // Merge lien into existing config
    existingConfig.mcpServers = existingConfig.mcpServers || {};
    existingConfig.mcpServers.lien = MCP_CONFIG;
    await fs.writeFile(mcpConfigPath, JSON.stringify(existingConfig, null, 2) + '\n');
    console.log(chalk.green('\n✓ Added lien to existing .cursor/mcp.json'));
  } else {
    // Create new .cursor/mcp.json
    await fs.mkdir(cursorDir, { recursive: true });
    const config = { mcpServers: { lien: MCP_CONFIG } };
    await fs.writeFile(mcpConfigPath, JSON.stringify(config, null, 2) + '\n');
    console.log(chalk.green('\n✓ Created .cursor/mcp.json'));
  }

  console.log(chalk.dim('  Restart Cursor to activate.\n'));

  // Check if old config exists and warn
  const legacyConfigPath = path.join(rootDir, '.lien.config.json');
  try {
    await fs.access(legacyConfigPath);
    console.log(chalk.yellow('⚠️  Note: .lien.config.json found but no longer used'));
    console.log(chalk.dim('  You can safely delete it.'));
  } catch {
    // Config doesn't exist - that's fine
  }
}

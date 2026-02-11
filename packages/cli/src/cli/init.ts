import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { showCompactBanner } from '../utils/banner.js';

export interface InitOptions {
  upgrade?: boolean;
  yes?: boolean;
  path?: string;
}

export async function initCommand(options: InitOptions = {}) {
  showCompactBanner();

  console.log(chalk.bold('\nLien Initialization\n'));
  console.log(chalk.green('✓ No per-project configuration needed!'));
  console.log(chalk.dim('\nLien now uses:'));
  console.log(chalk.dim('  • Auto-detected frameworks'));
  console.log(chalk.dim('  • Sensible defaults for all settings'));
  console.log(chalk.dim('  • Global config (optional) at ~/.lien/config.json'));

  console.log(chalk.bold('\nNext steps:'));
  console.log(chalk.dim('  1. Run'), chalk.bold('lien index'), chalk.dim('to index your codebase'));
  console.log(
    chalk.dim('  2. Run'),
    chalk.bold('lien serve'),
    chalk.dim('to start the MCP server'),
  );

  console.log(chalk.bold('\nGlobal Configuration (optional):'));
  console.log(chalk.dim('  To use Qdrant backend, create ~/.lien/config.json:'));
  console.log(chalk.dim('  {'));
  console.log(chalk.dim('    "backend": "qdrant",'));
  console.log(chalk.dim('    "qdrant": {'));
  console.log(chalk.dim('      "url": "http://localhost:6333",'));
  console.log(chalk.dim('      "apiKey": "optional-api-key"'));
  console.log(chalk.dim('    }'));
  console.log(chalk.dim('  }'));
  console.log(chalk.dim('\n  Or use environment variables:'));
  console.log(chalk.dim('    LIEN_BACKEND=qdrant'));
  console.log(chalk.dim('    LIEN_QDRANT_URL=http://localhost:6333'));
  console.log(chalk.dim('    LIEN_QDRANT_API_KEY=your-key'));

  // Check if old config exists and warn
  const rootDir = options.path || process.cwd();
  const configPath = path.join(rootDir, '.lien.config.json');
  try {
    await fs.access(configPath);
    console.log(chalk.yellow('\n⚠️  Note: .lien.config.json found but no longer used'));
    console.log(chalk.dim('  You can safely delete it.'));
  } catch {
    // Config doesn't exist - that's fine
  }
}

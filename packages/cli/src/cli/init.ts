import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { defaultConfig } from '../config/schema.js';

export async function initCommand() {
  const configPath = path.join(process.cwd(), '.lien.config.json');
  
  try {
    // Check if config already exists
    try {
      await fs.access(configPath);
      console.log(chalk.yellow('⚠️  .lien.config.json already exists'));
      return;
    } catch {
      // File doesn't exist, proceed
    }
    
    // Create config file
    await fs.writeFile(
      configPath,
      JSON.stringify(defaultConfig, null, 2) + '\n',
      'utf-8'
    );
    
    console.log(chalk.green('✓ Created .lien.config.json'));
    console.log(chalk.dim('\nNext steps:'));
    console.log(chalk.dim('  1. Run'), chalk.bold('lien index'), chalk.dim('to index your codebase'));
    console.log(chalk.dim('  2. Run'), chalk.bold('lien serve'), chalk.dim('to start the MCP server'));
    console.log(chalk.dim('  3. Configure Cursor to use the MCP server'));
  } catch (error) {
    console.error(chalk.red('Error creating config file:'), error);
    process.exit(1);
  }
}


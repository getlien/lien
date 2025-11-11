import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { configExists } from '../config/loader.js';

export async function statusCommand() {
  const rootDir = process.cwd();
  const projectName = path.basename(rootDir);
  
  // Use same hashing logic as VectorDB to show correct path
  const pathHash = crypto
    .createHash('md5')
    .update(rootDir)
    .digest('hex')
    .substring(0, 8);
  
  const indexPath = path.join(os.homedir(), '.lien', 'indices', `${projectName}-${pathHash}`);
  
  console.log(chalk.bold('Lien Status\n'));
  
  // Check if config exists
  const hasConfig = await configExists(rootDir);
  console.log(chalk.dim('Configuration:'), hasConfig ? chalk.green('✓ Found') : chalk.red('✗ Not initialized'));
  
  if (!hasConfig) {
    console.log(chalk.yellow('\nRun'), chalk.bold('lien init'), chalk.yellow('to initialize'));
    return;
  }
  
  // Check if index exists
  try {
    const stats = await fs.stat(indexPath);
    console.log(chalk.dim('Index location:'), indexPath);
    console.log(chalk.dim('Index status:'), chalk.green('✓ Exists'));
    
    // Try to get directory size
    try {
      const files = await fs.readdir(indexPath, { recursive: true });
      console.log(chalk.dim('Index files:'), files.length);
    } catch (e) {
      // Ignore
    }
    
    console.log(chalk.dim('Last modified:'), stats.mtime.toLocaleString());
  } catch (error) {
    console.log(chalk.dim('Index status:'), chalk.yellow('✗ Not indexed'));
    console.log(chalk.yellow('\nRun'), chalk.bold('lien index'), chalk.yellow('to index your codebase'));
  }
}


import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { startMCPServer } from '../mcp/server.js';
import { showBanner } from '../utils/banner.js';

export async function serveCommand(options: { port?: string; watch?: boolean; root?: string }) {
  const rootDir = options.root ? path.resolve(options.root) : process.cwd();
  
  try {
    // Validate root directory if --root was specified
    if (options.root) {
      try {
        const stats = await fs.stat(rootDir);
        if (!stats.isDirectory()) {
          console.error(chalk.red(`Error: --root path is not a directory: ${rootDir}`));
          process.exit(1);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.error(chalk.red(`Error: --root directory does not exist: ${rootDir}`));
        } else if ((error as NodeJS.ErrnoException).code === 'EACCES') {
          console.error(chalk.red(`Error: --root directory is not accessible: ${rootDir}`));
        } else {
          console.error(chalk.red(`Error: Failed to access --root directory: ${rootDir}`));
          console.error(chalk.dim((error as Error).message));
        }
        process.exit(1);
      }
    }
    
    // Log to stderr since stdout is for MCP protocol
    showBanner();
    console.error(chalk.bold('Starting MCP server...\n'));
    
    if (options.root) {
      console.error(chalk.dim(`Serving from: ${rootDir}\n`));
    }
    
    await startMCPServer({
      rootDir,
      verbose: true,
      watch: options.watch,
    });
  } catch (error) {
    console.error(chalk.red('Failed to start MCP server:'), error);
    process.exit(1);
  }
}


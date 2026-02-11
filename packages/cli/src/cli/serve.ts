import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { startMCPServer } from '../mcp/server.js';
import { showBanner } from '../utils/banner.js';

export async function serveCommand(options: {
  port?: string;
  watch?: boolean;
  noWatch?: boolean;
  root?: string;
}) {
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

    // Handle deprecated --watch flag
    if (options.watch) {
      console.error(chalk.yellow('⚠️  --watch flag is deprecated (file watching is now default)'));
      console.error(chalk.dim('    Use --no-watch to disable file watching\n'));
    }

    // Determine file watching state
    // Priority: --no-watch > --watch (deprecated) > config default
    const watch = options.noWatch ? false : options.watch ? true : undefined;

    await startMCPServer({
      rootDir,
      verbose: true,
      watch,
    });
  } catch (error) {
    console.error(chalk.red('Failed to start MCP server:'), error);
    process.exit(1);
  }
}

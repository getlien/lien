import chalk from 'chalk';
import path from 'path';
import { startMCPServer } from '../mcp/server.js';
import { showBanner } from '../utils/banner.js';

export async function serveCommand(options: { port?: string; watch?: boolean; root?: string }) {
  const rootDir = options.root ? path.resolve(options.root) : process.cwd();
  
  try {
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


import chalk from 'chalk';
import { startMCPServer } from '../mcp/server.js';

export async function serveCommand(options: { port?: string; watch?: boolean }) {
  const rootDir = process.cwd();
  
  try {
    // Log to stderr since stdout is for MCP protocol
    console.error(chalk.bold('Starting Lien MCP server...\n'));
    
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


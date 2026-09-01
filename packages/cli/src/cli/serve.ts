import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { startMCPServer } from '../mcp/server.js';
import { showBanner } from '../utils/banner.js';

/**
 * The removal notice.
 *
 * Written to STDERR, never stdout: stdout is the MCP protocol stream, and a
 * banner on it corrupts the very handshake this command exists to serve. The
 * rest of this file already logs to stderr for that reason.
 *
 * Un-suppressible by design. This is the last release in which `lien serve`
 * exists, so a user who never sees this warning experiences the removal as an
 * editor that silently stops working — the failure mode a deprecation cycle is
 * for. There is deliberately no `--quiet` and no env var to turn it off.
 */
function printRemovalNotice(): void {
  console.error(
    chalk.yellow.bold('\n⚠  `lien serve` is being REMOVED in the next release.\n') +
      chalk.yellow(
        '   The MCP server, the persisted index and lexical search are all going.\n' +
          '   This is the last version that ships them.\n\n',
      ) +
      chalk.dim(
        '   Lien becomes a local CLI you run directly — no server, no index, no setup:\n\n' +
          '     lien health      what is risky to change here?\n' +
          '     lien delta       did this change cross a complexity threshold?\n' +
          '     lien review      deterministic signals over your diff\n' +
          '     lien complexity  where is the tech debt?\n\n' +
          '   The MCP tools (search_code, get_dependents, get_files_context,\n' +
          '   list_functions, find_similar, get_complexity) have no replacement:\n' +
          "   use your editor's own search and your agent's own file tools.\n\n" +
          '   To stay on a version with the server, pin the one you have now:\n' +
          '     lien --version            # then\n' +
          '     npm install -g @liendev/lien@<that version>\n',
      ),
  );
}

export async function serveCommand(options: {
  port?: string;
  watch?: boolean;
  noWatch?: boolean;
  root?: string;
}) {
  // First, before any validation that might exit: a user whose --root is wrong
  // must still learn the command is going away.
  printRemovalNotice();

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

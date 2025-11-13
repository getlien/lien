import { Command } from 'commander';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initCommand } from './init.js';
import { statusCommand } from './status.js';
import { indexCommand } from './index-cmd.js';
import { serveCommand } from './serve.js';

// Get version from package.json dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

let packageJson;
try {
  packageJson = require(join(__dirname, '../package.json'));
} catch {
  packageJson = require(join(__dirname, '../../package.json'));
}

export const program = new Command();

program
  .name('lien')
  .description('Local semantic code search for AI assistants via MCP')
  .version(packageJson.version);

program
  .command('init')
  .description('Initialize Lien in the current directory')
  .option('-u, --upgrade', 'Upgrade existing config with new options')
  .action(initCommand);

program
  .command('index')
  .description('Index the codebase for semantic search')
  .option('-w, --watch', 'Watch for changes and re-index automatically')
  .action(indexCommand);

program
  .command('serve')
  .description('Start the MCP server for Cursor integration')
  .option('-p, --port <port>', 'Port number (for future use)', '7133')
  .option('-w, --watch', 'Enable file watching for real-time reindexing')
  .action(serveCommand);

program
  .command('status')
  .description('Show indexing status and statistics')
  .action(statusCommand);

program
  .command('reindex')
  .description('Clear index and re-index the entire codebase')
  .action(async () => {
    const { showCompactBanner } = await import('../utils/banner.js');
    const chalk = (await import('chalk')).default;
    const { VectorDB } = await import('../vectordb/lancedb.js');
    const { indexCodebase } = await import('../indexer/index.js');
    
    showCompactBanner();
    
    try {
      console.log(chalk.yellow('Clearing existing index...'));
      const vectorDB = new VectorDB(process.cwd());
      await vectorDB.initialize();
      await vectorDB.clear();
      console.log(chalk.green('✓ Index cleared\n'));
      
      await indexCodebase({
        rootDir: process.cwd(),
        verbose: true,
      });
    } catch (error) {
      console.error(chalk.red('Error during re-indexing:'), error);
      process.exit(1);
    }
  });


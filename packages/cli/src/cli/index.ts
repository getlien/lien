import { Command } from 'commander';
import { initCommand } from './init.js';
import { statusCommand } from './status.js';
import { indexCommand } from './index-cmd.js';
import { serveCommand } from './serve.js';

export const program = new Command();

program
  .name('lien')
  .description('Local semantic code search for AI assistants via MCP')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize Lien in the current directory')
  .action(initCommand);

program
  .command('index')
  .description('Index the codebase for semantic search')
  .option('-w, --watch', 'Watch for changes and re-index automatically')
  .action(indexCommand);

program
  .command('serve')
  .description('Start the MCP server for Cursor integration')
  .option('-p, --port <port>', 'Port number (for future use)', '3000')
  .action(serveCommand);

program
  .command('status')
  .description('Show indexing status and statistics')
  .action(statusCommand);

program
  .command('reindex')
  .description('Clear index and re-index the entire codebase')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const { VectorDB } = await import('../vectordb/lancedb.js');
    const { indexCodebase } = await import('../indexer/index.js');
    
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


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
  .option('-y, --yes', 'Skip interactive prompts and use defaults')
  .option('-p, --path <path>', 'Path to initialize (defaults to current directory)')
  .action(initCommand);

program
  .command('index')
  .description('Index the codebase for semantic search')
  .option('-f, --force', 'Force full reindex (skip incremental)')
  .option('-w, --watch', 'Watch for changes and re-index automatically')
  .option('-v, --verbose', 'Show detailed logging during indexing')
  .action(indexCommand);

program
  .command('serve')
  .description('Start the MCP server for Cursor integration')
  .option('-p, --port <port>', 'Port number (for future use)', '7133')
  .option('--no-watch', 'Disable file watching for this session')
  .option('-w, --watch', '[DEPRECATED] File watching is now enabled by default')
  .option('-r, --root <path>', 'Root directory to serve (defaults to current directory)')
  .action(serveCommand);

program
  .command('status')
  .description('Show indexing status and statistics')
  .action(statusCommand);

program
  .command('reindex')
  .description('Clear index and re-index the entire codebase')
  .option('-v, --verbose', 'Show detailed logging during indexing')
  .action(async (options) => {
    const { showCompactBanner } = await import('../utils/banner.js');
    const chalk = (await import('chalk')).default;
    const { VectorDB } = await import('../vectordb/lancedb.js');
    const { ManifestManager } = await import('../indexer/manifest.js');
    const { indexCodebase } = await import('../indexer/index.js');
    
    showCompactBanner();
    
    try {
      console.log(chalk.yellow('Clearing existing index and manifest...'));
      const vectorDB = new VectorDB(process.cwd());
      await vectorDB.initialize();
      await vectorDB.clear();
      
      // Also clear manifest
      const manifest = new ManifestManager(vectorDB.dbPath);
      await manifest.clear();
      
      console.log(chalk.green('✓ Index and manifest cleared\n'));
      
      await indexCodebase({
        rootDir: process.cwd(),
        verbose: options.verbose || false,
        force: true,  // Force full reindex
      });
    } catch (error) {
      console.error(chalk.red('Error during re-indexing:'), error);
      process.exit(1);
    }
  });


import chalk from 'chalk';
import { indexCodebase } from '../indexer/index.js';
import { showCompactBanner } from '../utils/banner.js';

export async function indexCommand(options: { watch?: boolean; verbose?: boolean; force?: boolean }) {
  showCompactBanner();
  
  try {
    // If force flag is set, clear the index and manifest first (clean slate)
    if (options.force) {
      const { VectorDB } = await import('../vectordb/lancedb.js');
      const { ManifestManager } = await import('../indexer/manifest.js');
      
      console.log(chalk.yellow('Clearing existing index and manifest...'));
      const vectorDB = new VectorDB(process.cwd());
      await vectorDB.initialize();
      await vectorDB.clear();
      
      // Also clear manifest
      const manifest = new ManifestManager(vectorDB.dbPath);
      await manifest.clear();
      
      console.log(chalk.green('✓ Index and manifest cleared\n'));
    }
    
    await indexCodebase({
      rootDir: process.cwd(),
      verbose: options.verbose || false,
      force: options.force || false,
    });
    
    if (options.watch) {
      console.log(chalk.yellow('\n⚠️  Watch mode not yet implemented'));
      // TODO: Implement file watching with chokidar
    }
  } catch (error) {
    console.error(chalk.red('Error during indexing:'), error);
    process.exit(1);
  }
}


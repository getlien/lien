import chalk from 'chalk';
import { indexCodebase } from '../indexer/index.js';
import { showCompactBanner } from '../utils/banner.js';

export async function indexCommand(options: { watch?: boolean; verbose?: boolean }) {
  showCompactBanner();
  
  // Enable debug output in test-patterns.ts when verbose mode is on
  if (options.verbose) {
    process.env.LIEN_VERBOSE = 'true';
  }
  
  try {
    await indexCodebase({
      rootDir: process.cwd(),
      verbose: options.verbose || false,
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


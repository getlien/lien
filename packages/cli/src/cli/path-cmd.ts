import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { extractRepoId, getSupportedExtensions } from '@liendev/parser';

interface PathOptions {
  store?: boolean;
  extensions?: boolean;
}

export function pathCommand(options: PathOptions): void {
  const selectedFlags = [options.store, options.extensions].filter(Boolean).length;

  if (selectedFlags === 0) {
    console.error(chalk.red('Error: specify one of --store or --extensions'));
    process.exit(1);
  }

  if (selectedFlags > 1) {
    console.error(chalk.red('Error: --store and --extensions are mutually exclusive'));
    process.exit(1);
  }

  if (options.store) {
    const repoId = extractRepoId(process.cwd());
    console.log(path.join(os.homedir(), '.lien', 'indices', repoId));
    return;
  }

  if (options.extensions) {
    for (const ext of getSupportedExtensions()) {
      console.log(ext);
    }
  }
}

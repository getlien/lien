import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { extractRepoId, getSupportedExtensions } from '@liendev/parser';
import { resolveProjectRoot } from './project-root.js';

interface PathOptions {
  store?: boolean;
  extensions?: boolean;
  root?: boolean;
}

export function pathCommand(options: PathOptions): void {
  const selectedFlags = [options.store, options.extensions, options.root].filter(Boolean).length;

  if (selectedFlags === 0) {
    console.error(chalk.red('Error: specify one of --store, --extensions, --root'));
    process.exit(1);
  }

  if (selectedFlags > 1) {
    console.error(chalk.red('Error: --store, --extensions, --root are mutually exclusive'));
    process.exit(1);
  }

  if (options.root) {
    console.log(resolveProjectRoot(process.cwd()));
    return;
  }

  if (options.store) {
    const repoId = extractRepoId(resolveProjectRoot(process.cwd()));
    console.log(path.join(os.homedir(), '.lien', 'indices', repoId));
    return;
  }

  if (options.extensions) {
    for (const ext of getSupportedExtensions()) {
      console.log(ext);
    }
  }
}

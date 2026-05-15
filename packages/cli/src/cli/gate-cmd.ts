import path from 'path';
import fs from 'fs/promises';
import chalk from 'chalk';
import { getStoreRoot } from './store-paths.js';

const VALID_ACTIONS = ['on', 'off', 'block', 'status'] as const;
type GateAction = (typeof VALID_ACTIONS)[number];

function getFlagPath(name: 'disabled' | 'blocking'): string {
  return path.join(getStoreRoot(), `gate-${name}`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureStoreDir(): Promise<void> {
  await fs.mkdir(getStoreRoot(), { recursive: true });
}

async function writeFlag(name: 'disabled' | 'blocking'): Promise<void> {
  await ensureStoreDir();
  await fs.writeFile(getFlagPath(name), '');
}

async function removeFlag(name: 'disabled' | 'blocking'): Promise<void> {
  await fs.rm(getFlagPath(name), { force: true });
}

export async function gateCommand(action: string): Promise<void> {
  if (!VALID_ACTIONS.includes(action as GateAction)) {
    console.error(
      chalk.red(`Error: invalid action "${action}". Use one of: ${VALID_ACTIONS.join(', ')}`),
    );
    process.exit(1);
  }

  try {
    switch (action as GateAction) {
      case 'on':
        await removeFlag('disabled');
        await removeFlag('blocking');
        console.log(chalk.green('Lien gate: on (advisory)'));
        return;
      case 'off':
        await writeFlag('disabled');
        await removeFlag('blocking');
        console.log(chalk.yellow('Lien gate: off (sentinels still recorded)'));
        return;
      case 'block':
        await removeFlag('disabled');
        await writeFlag('blocking');
        console.log(chalk.green('Lien gate: blocking (exit 2 on miss)'));
        return;
      case 'status': {
        const disabled = await exists(getFlagPath('disabled'));
        const blocking = await exists(getFlagPath('blocking'));
        const state = disabled ? 'off' : blocking ? 'blocking' : 'on (advisory)';
        console.log(chalk.dim('Lien gate:'), state);
        console.log(chalk.dim('Flag dir:'), getStoreRoot());
        return;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error: gate ${action} failed: ${msg}`));
    process.exit(1);
  }
}

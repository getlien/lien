import path from 'path';
import fs from 'fs/promises';
import chalk from 'chalk';
import { getStoreRoot } from './store-paths.js';

const VALID_ACTIONS = ['on', 'off', 'block', 'advisory', 'status'] as const;
type GateAction = (typeof VALID_ACTIONS)[number];

function getFlagPath(name: 'disabled' | 'advisory'): string {
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

async function writeFlag(name: 'disabled' | 'advisory'): Promise<void> {
  await ensureStoreDir();
  await fs.writeFile(getFlagPath(name), '');
}

async function removeFlag(name: 'disabled' | 'advisory'): Promise<void> {
  await fs.rm(getFlagPath(name), { force: true });
}

async function removeLegacyBlockingFlag(): Promise<void> {
  // Older versions wrote ~/.lien/indices/<id>/gate-blocking to mean "enforce".
  // Now enforcement is the default; the flag is orphaned. Clean it up so
  // `status` doesn't surface stale state.
  await fs.rm(path.join(getStoreRoot(), 'gate-blocking'), { force: true });
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
      case 'block':
        await removeFlag('disabled');
        await removeFlag('advisory');
        await removeLegacyBlockingFlag();
        console.log(chalk.green('Lien gate: on (blocking; exit 2 on miss)'));
        return;
      case 'off':
        await writeFlag('disabled');
        await removeFlag('advisory');
        await removeLegacyBlockingFlag();
        console.log(chalk.yellow('Lien gate: off (sentinels still recorded)'));
        return;
      case 'advisory':
        await removeFlag('disabled');
        await writeFlag('advisory');
        await removeLegacyBlockingFlag();
        console.log(
          chalk.yellow('Lien gate: advisory (UI-only nudge; model is NOT shown the message)'),
        );
        return;
      case 'status': {
        const disabled = await exists(getFlagPath('disabled'));
        const advisory = await exists(getFlagPath('advisory'));
        const state = disabled ? 'off' : advisory ? 'advisory (UI-only)' : 'on (blocking)';
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

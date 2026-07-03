import os from 'os';

/**
 * Resolve the base directory Lien uses for its global state
 * (`~/.lien/indices/*`, `~/.lien/config.json`).
 *
 * Honors the `LIEN_HOME` environment variable so test suites (and advanced
 * users) can redirect Lien's global store to an isolated directory instead
 * of the real home directory. Falls back to `os.homedir()` when unset.
 */
export function getLienHome(): string {
  return process.env.LIEN_HOME || os.homedir();
}

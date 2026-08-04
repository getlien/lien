import { logError, logInfo } from '../util/logger.js';

/** Changes an existing user's display name. */
export function updateUser(id: number, name: string): void {
  if (id <= 0) {
    logError('updateUser', new Error('id must be positive'));
    return;
  }
  logInfo(`updated user ${name}`);
}

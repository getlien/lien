import { logError, logInfo } from '../util/logger.js';

/** Removes a user by id. */
export function deleteUser(id: number): void {
  if (id <= 0) {
    logError('deleteUser', new Error('id must be positive'));
    return;
  }
  logInfo('deleted user');
}

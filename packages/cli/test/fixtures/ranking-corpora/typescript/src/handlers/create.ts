import { logError, logInfo } from '../util/logger.js';

/** Validates and records a new user by name. */
export function createUser(name: string): void {
  if (!name) {
    logError('createUser', new Error('name must not be empty'));
    return;
  }
  logInfo(`created user ${name}`);
}

import { createUser } from './handlers/create.js';
import { logInfo } from './util/logger.js';

/** Fixture corpus entry point, wiring the handlers to the shared logger. */
logInfo('starting ranking-typescript fixture service');
createUser('ada');

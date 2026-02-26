/**
 * Structured JSON logger for K8s log aggregation.
 * Writes to stderr so stdout stays clean for potential future use.
 */

import type { Logger } from '@liendev/review';

function log(level: string, message: string): void {
  const entry = JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    service: 'lien-runner',
  });
  process.stderr.write(entry + '\n');
}

export const jsonLogger: Logger = {
  info: (message: string) => log('info', message),
  warning: (message: string) => log('warn', message),
  error: (message: string) => log('error', message),
  debug: (message: string) => log('debug', message),
};

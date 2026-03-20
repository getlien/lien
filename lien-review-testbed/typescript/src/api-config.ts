/**
 * API configuration loaded from environment variables.
 * Validates values at startup and throws on invalid configuration
 * to prevent the service from running with dangerous settings.
 */

export const API_TIMEOUT = parseInt(process.env['API_TIMEOUT'] ?? '5000', 10);
export const MAX_RETRIES = parseInt(process.env['MAX_RETRIES'] ?? '3', 10);

if (API_TIMEOUT > 10000) {
  throw new Error(
    `API_TIMEOUT must be <= 10000ms to prevent connection starvation, got ${API_TIMEOUT}`,
  );
}

if (API_TIMEOUT < 100) {
  throw new Error(`API_TIMEOUT must be >= 100ms to allow for network latency, got ${API_TIMEOUT}`);
}

if (MAX_RETRIES > 5) {
  throw new Error(`MAX_RETRIES must be <= 5 to prevent retry storms, got ${MAX_RETRIES}`);
}

if (MAX_RETRIES < 0) {
  throw new Error(`MAX_RETRIES must be non-negative, got ${MAX_RETRIES}`);
}

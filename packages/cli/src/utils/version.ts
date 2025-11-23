import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * Centralized package version loader.
 * Handles different build output structures (development vs production).
 * 
 * Build scenarios:
 * - Development (ts-node): src/utils/version.ts → ../package.json
 * - Production (dist): dist/utils/version.js → ../package.json
 * - Nested builds: dist/something/version.js → ../../package.json
 */

// Setup require for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

let packageJson: { version: string; name?: string };

try {
  // Try relative to current file (works in most scenarios)
  packageJson = require(join(__dirname, '../package.json'));
} catch {
  try {
    // Fallback: go up one more level (nested build output)
    packageJson = require(join(__dirname, '../../package.json'));
  } catch {
    // Last resort: hardcoded fallback (should never happen in production)
    console.warn('[Lien] Warning: Could not load package.json, using fallback version');
    packageJson = { version: '0.0.0-unknown' };
  }
}

/**
 * Get the current package version
 */
export function getPackageVersion(): string {
  return packageJson.version;
}

/**
 * Get the full package.json (for compatibility)
 */
export function getPackageInfo(): { version: string; name?: string } {
  return packageJson;
}


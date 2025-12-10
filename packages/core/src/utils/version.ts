/**
 * Version utilities for @liendev/core
 * 
 * Core package has its own version. When CLI uses core,
 * it can override this with its own package version.
 */

// Default version for core
// In a real build, this would be injected or read from package.json
let coreVersion = '0.1.0';

/**
 * Get the current package version
 */
export function getPackageVersion(): string {
  return coreVersion;
}

/**
 * Set the package version (used by CLI to override with its version)
 */
export function setPackageVersion(version: string): void {
  coreVersion = version;
}

/**
 * Get the full package info (for compatibility)
 */
export function getPackageInfo(): { version: string; name: string } {
  return { version: coreVersion, name: '@liendev/core' };
}

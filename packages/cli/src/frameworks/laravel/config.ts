import { FrameworkConfig } from '../../config/schema.js';
import { laravelTestPatterns } from './test-patterns.js';

/**
 * Generate Laravel framework configuration
 */
export async function generateLaravelConfig(
  rootDir: string,
  relativePath: string
): Promise<FrameworkConfig> {
  return {
    include: [
      'app/**/*.php',
      'routes/**/*.php',
      'config/**/*.php',
      'database/**/*.php',
      'resources/**/*.php',
      '*.php',
    ],
    exclude: [
      'vendor/**',
      'storage/**',
      'bootstrap/cache/**',
      'public/**',
      'node_modules/**',
    ],
    testPatterns: laravelTestPatterns,
  };
}


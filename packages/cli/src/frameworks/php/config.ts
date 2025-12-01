import { FrameworkConfig } from '../../config/schema.js';

/**
 * Generate generic PHP framework configuration
 */
export async function generatePhpConfig(
  _rootDir: string,
  _relativePath: string
): Promise<FrameworkConfig> {
  return {
    include: [
      // PHP source code
      'src/**/*.php',
      'lib/**/*.php',
      'app/**/*.php',
      'tests/**/*.php',
      '*.php',
      
      // Common PHP project files
      'config/**/*.php',
      'public/**/*.php',
      
      // Documentation
      '**/*.md',
      '**/*.mdx',
      'docs/**/*.md',
      'README.md',
      'CHANGELOG.md',
    ],
    exclude: [
      'vendor/**',
      'node_modules/**',
      'dist/**',
      'build/**',
      'storage/**',
      'cache/**',
      
      // Test artifacts
      'coverage/**',
      'test-results/**',
      '.phpunit.cache/**',
      
      // Build outputs
      '__generated__/**',
    ],
  };
}


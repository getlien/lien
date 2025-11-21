import { FrameworkConfig } from '../../config/schema.js';

/**
 * Generate Laravel framework configuration
 */
export async function generateLaravelConfig(
  _rootDir: string,
  _relativePath: string
): Promise<FrameworkConfig> {
  return {
    include: [
      // PHP backend
      'app/**/*.php',
      'routes/**/*.php',
      'config/**/*.php',
      'database/**/*.php',
      'resources/**/*.php',
      'tests/**/*.php',
      '*.php',
      // Frontend assets (Vue/React/Inertia) - Broadened for flexibility
      '**/*.js',
      '**/*.ts',
      '**/*.jsx',
      '**/*.tsx',
      '**/*.vue',
      // Blade templates
      'resources/views/**/*.blade.php',
      // Documentation
      '**/*.md',
      '**/*.mdx',
      'docs/**/*.md',
      'README.md',
      'CHANGELOG.md',
    ],
    exclude: [
      'vendor/**',
      'storage/**',
      'bootstrap/cache/**',
      'public/**',
      'node_modules/**',
      'dist/**',
      'build/**',
      
      // Test artifacts (source files are indexed, but not output)
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      
      // Build/generated artifacts
      '__generated__/**',
      
      // Frontend build outputs
      '.vite/**',
      '.nuxt/**',
      '.next/**',
    ],
  };
}


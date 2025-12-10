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
      // Frontend assets (Vue/React/Inertia) - Scoped to resources/ to avoid build output
      'resources/**/*.js',
      'resources/**/*.ts',
      'resources/**/*.jsx',
      'resources/**/*.tsx',
      'resources/**/*.vue',
      // Blade templates
      'resources/views/**/*.blade.php',
      // Documentation
      'docs/**/*.md',
      'README.md',
      'CHANGELOG.md',
    ],
    exclude: [
      // Composer dependencies (CRITICAL: exclude before any include patterns)
      '**/vendor/**',
      'vendor/**',
      
      // Build outputs (Vite/Mix compiled assets)
      '**/public/build/**',
      'public/build/**',
      'public/hot',
      '**/dist/**',
      'dist/**',
      '**/build/**',
      'build/**',
      
      // Laravel system directories
      'storage/**',
      'bootstrap/cache/**',
      'public/**/*.js',  // Compiled JS in public
      'public/**/*.css', // Compiled CSS in public
      
      // Database boilerplate (not useful for semantic search)
      'database/migrations/**',
      'database/seeders/**',
      'database/factories/**',
      
      // Node.js dependencies
      '**/node_modules/**',
      'node_modules/**',
      
      // Test artifacts
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      
      // Build/generated artifacts
      '__generated__/**',
      
      // Frontend build outputs
      '.vite/**',
      '.nuxt/**',
      '.next/**',
      
      // Minified files
      '**/*.min.js',
      '**/*.min.css',
    ],
  };
}


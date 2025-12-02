import { FrameworkConfig } from '../../config/schema.js';

/**
 * Generate Node.js framework configuration
 */
export async function generateNodeJsConfig(
  _rootDir: string,
  _relativePath: string
): Promise<FrameworkConfig> {
  return {
    include: [
      // Broader patterns to catch all common project structures
      // (frontend/, src/, lib/, app/, components/, etc.)
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.vue',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.md',
      '**/*.mdx',
    ],
    exclude: [
      // Node.js dependencies (with ** prefix for nested projects)
      '**/node_modules/**',
      'node_modules/**',
      
      // PHP/Composer dependencies (for monorepos with PHP)
      '**/vendor/**',
      'vendor/**',
      
      // Build outputs
      '**/dist/**',
      'dist/**',
      '**/build/**',
      'build/**',
      '**/public/build/**',
      'public/build/**',
      'out/**',
      
      // Framework build caches
      '.next/**',
      '.nuxt/**',
      '.vite/**',
      '.lien/**',
      
      // Test artifacts
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      
      // Build/generated artifacts
      '__generated__/**',
      
      // Common build/cache directories
      '.cache/**',
      '.turbo/**',
      '.vercel/**',
      '.netlify/**',
      
      // Minified/bundled files
      '**/*.min.js',
      '**/*.min.css',
      '**/*.bundle.js',
    ],
  };
}


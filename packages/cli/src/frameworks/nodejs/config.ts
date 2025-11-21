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
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.next/**',
      '.nuxt/**',
      '.vite/**',
      '.lien/**',
      'out/**',
      '*.min.js',
      '*.min.css',
      '*.bundle.js',
      
      // Test artifacts (source files are indexed, but not output)
      'playwright-report/**',
      'test-results/**',
      
      // Build/generated artifacts
      '__generated__/**',
      
      // Common build/cache directories
      '.cache/**',
      '.turbo/**',
      '.vercel/**',
      '.netlify/**',
    ],
  };
}


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
      'out/**',
      '*.min.js',
      '*.min.css',
      '*.bundle.js',
      // Exclude common build/cache directories
      '.cache/**',
      '.turbo/**',
      '.vercel/**',
      '.netlify/**',
      '__generated__/**',
    ],
  };
}


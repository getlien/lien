import { FrameworkConfig } from '../../config/schema.js';
import { nodejsTestPatterns } from './test-patterns.js';

/**
 * Generate Node.js framework configuration
 */
export async function generateNodeJsConfig(
  _rootDir: string,
  _relativePath: string
): Promise<FrameworkConfig> {
  return {
    include: [
      'src/**/*.ts',
      'src/**/*.tsx',
      'src/**/*.js',
      'src/**/*.jsx',
      'src/**/*.mjs',
      'src/**/*.cjs',
      'lib/**/*.ts',
      'lib/**/*.js',
      '*.ts',
      '*.js',
      '*.mjs',
      '*.cjs',
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.next/**',
      '.nuxt/**',
      'out/**',
      '*.min.js',
      '*.min.css',
      '*.bundle.js',
    ],
    testPatterns: nodejsTestPatterns,
  };
}


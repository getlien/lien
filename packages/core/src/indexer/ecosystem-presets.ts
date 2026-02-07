import fs from 'fs/promises';
import path from 'path';

/**
 * An ecosystem preset defines marker files and exclude patterns
 * for a specific development ecosystem.
 */
export interface EcosystemPreset {
  name: string;
  markerFiles: string[];
  excludePatterns: string[];
}

/**
 * Predefined ecosystem presets.
 * Each preset checks for marker files and provides exclude patterns
 * for common build artifacts, caches, and generated files.
 */
export const ECOSYSTEM_PRESETS: EcosystemPreset[] = [
  {
    name: 'nodejs',
    markerFiles: ['package.json'],
    excludePatterns: [
      '.next/**',
      '**/.next/**',
      '.nuxt/**',
      '**/.nuxt/**',
      '.vite/**',
      '**/.vite/**',
      '.turbo/**',
      '**/.turbo/**',
      '.vercel/**',
      '**/.vercel/**',
      '.netlify/**',
      '**/.netlify/**',
      'coverage/**',
      '**/coverage/**',
      'playwright-report/**',
      '**/playwright-report/**',
      'test-results/**',
      '**/test-results/**',
      '__generated__/**',
      '**/__generated__/**',
      '.cache/**',
      '**/.cache/**',
      'out/**',
      '**/out/**',
      'public/build/**',
      '**/public/build/**',
      '*.bundle.js',
      '**/*.bundle.js',
    ],
  },
  {
    name: 'python',
    markerFiles: ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile'],
    excludePatterns: [
      'venv/**',
      '**/venv/**',
      '.venv/**',
      '**/.venv/**',
      '__pycache__/**',
      '**/__pycache__/**',
      '*.pyc',
      '**/*.pyc',
      '*.pyo',
      '**/*.pyo',
      '*.pyd',
      '**/*.pyd',
      '*.egg-info/**',
      '**/*.egg-info/**',
      '.tox/**',
      '**/.tox/**',
      '.pytest_cache/**',
      '**/.pytest_cache/**',
      '.coverage',
      'htmlcov/**',
      '**/htmlcov/**',
      '.mypy_cache/**',
      '**/.mypy_cache/**',
      'docs/_build/**',
      'migrations/**',
      '**/migrations/**',
    ],
  },
  {
    name: 'php',
    markerFiles: ['composer.json'],
    excludePatterns: [
      'storage/**',
      '**/storage/**',
      'cache/**',
      '**/cache/**',
      'bootstrap/cache/**',
      '**/bootstrap/cache/**',
      '.phpunit.cache/**',
      '**/.phpunit.cache/**',
      'public/build/**',
      '**/public/build/**',
    ],
  },
  {
    name: 'laravel',
    markerFiles: ['artisan'],
    excludePatterns: [
      'database/migrations/**',
      'database/seeders/**',
      'database/factories/**',
      'public/**/*.js',
      'public/**/*.css',
      'public/hot',
      'public/build/**',
    ],
  },
];

/**
 * Detect which ecosystems are present in a project by checking for marker files.
 *
 * @param rootDir - Project root directory
 * @returns Array of matched ecosystem names
 */
export async function detectEcosystems(rootDir: string): Promise<string[]> {
  const matched: string[] = [];

  for (const preset of ECOSYSTEM_PRESETS) {
    for (const marker of preset.markerFiles) {
      try {
        await fs.access(path.join(rootDir, marker));
        matched.push(preset.name);
        break; // One marker is enough per preset
      } catch {
        // Marker not found, try next
      }
    }
  }

  return matched;
}

/**
 * Get merged exclude patterns for the given ecosystem names.
 * Returns a deduplicated array of exclude patterns.
 *
 * @param ecosystemNames - Array of ecosystem names (e.g. ['nodejs', 'python'])
 * @returns Deduplicated exclude patterns
 */
export function getEcosystemExcludePatterns(ecosystemNames: string[]): string[] {
  const patterns = new Set<string>();

  for (const name of ecosystemNames) {
    const preset = ECOSYSTEM_PRESETS.find(p => p.name === name);
    if (preset) {
      for (const pattern of preset.excludePatterns) {
        patterns.add(pattern);
      }
    }
  }

  return [...patterns];
}

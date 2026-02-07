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

/** Directories to skip when scanning for marker files in subdirectories */
const SKIP_DIRS = new Set([
  'node_modules', 'vendor', '.git', '.lien', 'dist', 'build',
  '.next', '.nuxt', '.vite', '.turbo', 'venv', '.venv',
  '__pycache__', '.tox', 'coverage', '.cache',
]);

/** Check if a marker file exists in a directory */
async function hasMarkerFile(dir: string, marker: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, marker));
    return true;
  } catch {
    return false;
  }
}

/** Get rootDir + immediate subdirectories, skipping known artifact dirs */
async function getSearchDirs(rootDir: string): Promise<string[]> {
  const dirs = [rootDir];
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        dirs.push(path.join(rootDir, entry.name));
      }
    }
  } catch {
    // Can't read subdirs, just check root
  }
  return dirs;
}

/**
 * Detect which ecosystems are present in a project by checking for marker files.
 * Checks rootDir and immediate subdirectories (depth 1) for monorepo support.
 *
 * @param rootDir - Project root directory
 * @returns Array of matched ecosystem names
 */
export async function detectEcosystems(rootDir: string): Promise<string[]> {
  const matched = new Set<string>();
  const searchDirs = await getSearchDirs(rootDir);

  for (const dir of searchDirs) {
    for (const preset of ECOSYSTEM_PRESETS) {
      if (matched.has(preset.name)) continue;
      for (const marker of preset.markerFiles) {
        if (await hasMarkerFile(dir, marker)) {
          matched.add(preset.name);
          break;
        }
      }
    }
  }

  return [...matched];
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

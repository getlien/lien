import { FrameworkConfig } from '../../config/schema.js';

/**
 * Generate Python framework configuration
 */
export async function generatePythonConfig(
  _rootDir: string,
  _relativePath: string
): Promise<FrameworkConfig> {
  return {
    include: [
      // Python source code - broad patterns
      '**/*.py',
      
      // Documentation
      '**/*.md',
      '**/*.mdx',
      'docs/**/*.md',
      'README.md',
      'CHANGELOG.md',
    ],
    exclude: [
      // Virtual environments (CRITICAL)
      '**/venv/**',
      'venv/**',
      '**/.venv/**',
      '.venv/**',
      '**/env/**',
      'env/**',
      '**/.env/**',
      '.env/**',
      '**/virtualenv/**',
      'virtualenv/**',
      
      // Python build artifacts
      '**/__pycache__/**',
      '__pycache__/**',
      '**/*.pyc',
      '**/*.pyo',
      '**/*.pyd',
      '**/*.egg-info/**',
      '*.egg-info/**',
      '**/dist/**',
      'dist/**',
      '**/build/**',
      'build/**',
      '**/eggs/**',
      'eggs/**',
      '**/*.egg/**',
      
      // Test artifacts
      '**/.tox/**',
      '.tox/**',
      '**/.pytest_cache/**',
      '.pytest_cache/**',
      '**/.coverage/**',
      '.coverage/**',
      '**/htmlcov/**',
      'htmlcov/**',
      '**/.mypy_cache/**',
      '.mypy_cache/**',
      
      // Documentation build
      '**/docs/_build/**',
      'docs/_build/**',
      
      // Node.js dependencies (for mixed projects)
      '**/node_modules/**',
      'node_modules/**',
      
      // Vendor directories
      '**/vendor/**',
      'vendor/**',
      
      // IDE
      '**/.idea/**',
      '.idea/**',
      '**/.vscode/**',
      '.vscode/**',
      
      // Migrations (often auto-generated)
      '**/migrations/**',
    ],
  };
}


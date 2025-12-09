import { FrameworkConfig } from '../../config/schema.js';

/**
 * Generate Shopify theme framework configuration
 */
export async function generateShopifyConfig(
  _rootDir: string,
  _relativePath: string
): Promise<FrameworkConfig> {
  return {
    include: [
      // Core Liquid templates
      'layout/**/*.liquid',
      'sections/**/*.liquid',
      'snippets/**/*.liquid',
      'templates/**/*.liquid', // Matches any nesting level (e.g., templates/customers/account.liquid)
      'templates/**/*.json',   // JSON template definitions (Shopify 2.0+)
      
      // Theme editor blocks (Online Store 2.0)
      'blocks/**/*.liquid',
      
      // Assets (CSS, JS with optional Liquid templating)
      'assets/**/*.js',
      'assets/**/*.js.liquid',
      'assets/**/*.css',
      'assets/**/*.css.liquid',
      'assets/**/*.scss',
      'assets/**/*.scss.liquid',
      
      // Configuration files
      'config/*.json',
      
      // Locales (i18n)
      'locales/*.json',
      
      // Documentation
      '*.md',
      'docs/**/*.md',
      
      // Shopify-specific config files
      'shopify.theme.toml',
      '.shopifyignore',
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.git/**',
      
      // Playwright/testing artifacts
      'playwright-report/**',
      'test-results/**',
      
      // Build/generated artifacts
      '__generated__/**',
      
      // Common frontend build outputs
      '.vite/**',
      '.nuxt/**',
      '.next/**',
    ],
  };
}


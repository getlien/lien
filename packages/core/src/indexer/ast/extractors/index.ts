import type { SupportedLanguage } from '../types.js';
import type { LanguageExportExtractor } from './types.js';
import { JavaScriptExportExtractor, TypeScriptExportExtractor } from './javascript.js';
import { PHPExportExtractor } from './php.js';
import { PythonExportExtractor } from './python.js';

export type { LanguageExportExtractor } from './types.js';

/**
 * Registry of language export extractors
 * 
 * Maps each supported language to its export extractor implementation.
 * When adding a new language:
 * 1. Create a new extractor class implementing LanguageExportExtractor
 * 2. Add it to this registry
 * 3. Update SupportedLanguage type in ../types.ts
 */
const extractorRegistry: Record<SupportedLanguage, LanguageExportExtractor> = {
  typescript: new TypeScriptExportExtractor(),
  javascript: new JavaScriptExportExtractor(),
  php: new PHPExportExtractor(),
  python: new PythonExportExtractor(),
};

/**
 * Get the export extractor for a specific language
 * 
 * @param language - Programming language
 * @returns Language-specific export extractor
 * @throws Error if language is not supported (defensive check for runtime safety)
 * 
 * Note: While TypeScript's type system guarantees all SupportedLanguage values
 * have corresponding extractors, this runtime check provides defense against:
 * - Type system bypasses (e.g., `as any` casting elsewhere)
 * - JavaScript consumers without type checking
 * - Future refactoring errors during registry modifications
 */
export function getExtractor(language: SupportedLanguage): LanguageExportExtractor {
  const extractor = extractorRegistry[language];
  
  // Defensive runtime check - see function documentation
  if (!extractor) {
    throw new Error(`No export extractor available for language: ${language}`);
  }
  
  return extractor;
}

/**
 * Check if a language has an export extractor implementation
 * 
 * @param language - Programming language
 * @returns True if extractor exists
 */
export function hasExtractor(language: SupportedLanguage): boolean {
  return language in extractorRegistry;
}

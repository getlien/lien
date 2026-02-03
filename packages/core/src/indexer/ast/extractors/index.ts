import type { SupportedLanguage } from '../types.js';
import type { LanguageExportExtractor } from './types.js';
import { getLanguage, languageExists } from '../languages/registry.js';

export type { LanguageExportExtractor } from './types.js';

/**
 * Get the export extractor for a specific language.
 * Delegates to the language registry.
 *
 * @param language - Programming language
 * @returns Language-specific export extractor
 */
export function getExtractor(language: SupportedLanguage): LanguageExportExtractor {
  return getLanguage(language).exportExtractor;
}

/**
 * Check if a language has an export extractor implementation
 *
 * @param language - Programming language
 * @returns True if extractor exists
 */
export function hasExtractor(language: string): boolean {
  return languageExists(language);
}

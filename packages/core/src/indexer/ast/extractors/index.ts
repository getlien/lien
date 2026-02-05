import type { SupportedLanguage } from '../types.js';
import type { LanguageExportExtractor, LanguageImportExtractor } from './types.js';
import { getLanguage, languageExists } from '../languages/registry.js';

export type { LanguageExportExtractor, LanguageImportExtractor } from './types.js';

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
 * Get the import extractor for a specific language.
 * Delegates to the language registry.
 *
 * @param language - Programming language
 * @returns Language-specific import extractor, or undefined if not implemented
 */
export function getImportExtractor(language: SupportedLanguage): LanguageImportExtractor | undefined {
  return getLanguage(language).importExtractor;
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

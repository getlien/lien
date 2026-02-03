import type { SupportedLanguage } from '../types.js';
import type { LanguageTraverser } from './types.js';
import { getLanguage } from '../languages/registry.js';

export type { LanguageTraverser, DeclarationFunctionInfo } from './types.js';

/**
 * Get the traverser for a specific language.
 * Delegates to the language registry.
 *
 * @param language - Programming language
 * @returns Language-specific traverser
 */
export function getTraverser(language: SupportedLanguage): LanguageTraverser {
  return getLanguage(language).traverser;
}

/**
 * Check if a language has a traverser implementation
 *
 * @param language - Programming language
 * @returns True if traverser exists
 */
export function hasTraverser(language: SupportedLanguage): boolean {
  try {
    getLanguage(language);
    return true;
  } catch {
    return false;
  }
}

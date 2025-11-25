import type { SupportedLanguage } from '../types.js';
import type { LanguageTraverser } from './types.js';
import { TypeScriptTraverser, JavaScriptTraverser } from './typescript.js';

export type { LanguageTraverser, DeclarationFunctionInfo } from './types.js';

/**
 * Registry of language traversers
 * 
 * Maps each supported language to its traverser implementation.
 * When adding a new language:
 * 1. Create a new traverser class implementing LanguageTraverser
 * 2. Add it to this registry
 * 3. Update SupportedLanguage type in ../types.ts
 */
const traverserRegistry: Record<SupportedLanguage, LanguageTraverser> = {
  typescript: new TypeScriptTraverser(),
  javascript: new JavaScriptTraverser(),
};

/**
 * Get the traverser for a specific language
 * 
 * @param language - Programming language
 * @returns Language-specific traverser
 * @throws Error if language is not supported
 */
export function getTraverser(language: SupportedLanguage): LanguageTraverser {
  const traverser = traverserRegistry[language];
  
  if (!traverser) {
    throw new Error(`No traverser available for language: ${language}`);
  }
  
  return traverser;
}

/**
 * Check if a language has a traverser implementation
 * 
 * @param language - Programming language
 * @returns True if traverser exists
 */
export function hasTraverser(language: SupportedLanguage): boolean {
  return language in traverserRegistry;
}


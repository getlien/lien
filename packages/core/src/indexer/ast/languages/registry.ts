import { extname } from 'path';
import type { LanguageDefinition } from './types.js';
import { typescriptDefinition } from './typescript.js';
import { javascriptDefinition } from './javascript.js';
import { phpDefinition } from './php.js';
import { pythonDefinition } from './python.js';

/**
 * All registered language definitions.
 * To add a new language, create a definition file and add it here.
 */
const definitions: LanguageDefinition[] = [
  typescriptDefinition,
  javascriptDefinition,
  phpDefinition,
  pythonDefinition,
];

/**
 * Supported languages for AST parsing.
 *
 * NOTE: This list is manually maintained and must be kept in sync with `definitions`.
 */
export type SupportedLanguage = 'typescript' | 'javascript' | 'php' | 'python';

/**
 * Registry keyed by language id.
 */
const languageRegistry = new Map<string, LanguageDefinition>(
  definitions.map(def => [def.id, def])
);

/**
 * Extension-to-language lookup table built from definitions.
 */
const extensionMap = new Map<string, SupportedLanguage>();
for (const def of definitions) {
  for (const ext of def.extensions) {
    extensionMap.set(ext, def.id);
  }
}

/**
 * Get the full language definition for a supported language.
 *
 * @throws Error if language is not registered
 */
export function getLanguage(language: SupportedLanguage): LanguageDefinition {
  const def = languageRegistry.get(language);
  if (!def) {
    throw new Error(`No language definition registered for: ${language}`);
  }
  return def;
}

/**
 * Detect which AST-supported language a file belongs to, based on extension.
 *
 * @returns SupportedLanguage or null if not AST-supported
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = extname(filePath).slice(1).toLowerCase();
  return extensionMap.get(ext) ?? null;
}

/**
 * Check if a language is registered (non-throwing).
 */
export function languageExists(language: string): boolean {
  return languageRegistry.has(language);
}

/**
 * Get all registered language definitions.
 */
export function getAllLanguages(): readonly LanguageDefinition[] {
  return definitions.slice();
}

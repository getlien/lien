import { extname } from 'path';
import type { LanguageDefinition } from './types.js';
import { typescriptDefinition } from './typescript.js';
import { javascriptDefinition } from './javascript.js';
import { phpDefinition } from './php.js';
import { pythonDefinition } from './python.js';
import { rustDefinition } from './rust.js';
import { goDefinition } from './go.js';

/**
 * All registered language definitions.
 * To add a new language, create a definition file and add it here.
 */
const definitions: LanguageDefinition[] = [
  typescriptDefinition,
  javascriptDefinition,
  phpDefinition,
  pythonDefinition,
  rustDefinition,
  goDefinition,
];

/**
 * Canonical list of supported language IDs.
 * SupportedLanguage type is derived from this array.
 * To add a new language: add its ID here, then add its definition to `definitions` below.
 */
export const LANGUAGE_IDS = ['typescript', 'javascript', 'php', 'python', 'rust', 'go'] as const;
export type SupportedLanguage = (typeof LANGUAGE_IDS)[number];

/**
 * Registry keyed by language id.
 */
const languageRegistry = new Map<string, LanguageDefinition>();
const extensionMap = new Map<string, SupportedLanguage>();

for (const def of definitions) {
  if (languageRegistry.has(def.id)) {
    throw new Error(`Duplicate language ID in registry: ${def.id}`);
  }
  languageRegistry.set(def.id, def);

  for (const ext of def.extensions) {
    if (extensionMap.has(ext)) {
      throw new Error(
        `Duplicate extension "${ext}" registered by "${def.id}" (already claimed by "${extensionMap.get(ext)}")`,
      );
    }
    extensionMap.set(ext, def.id);
  }
}

// Validate LANGUAGE_IDS has no duplicates and every ID has a definition
if (new Set(LANGUAGE_IDS).size !== LANGUAGE_IDS.length) {
  const dupes = [...new Set(LANGUAGE_IDS.filter((id, i) => LANGUAGE_IDS.indexOf(id) !== i))];
  throw new Error(`LANGUAGE_IDS contains duplicate entries: ${dupes.join(', ')}`);
}
for (const id of LANGUAGE_IDS) {
  if (!languageRegistry.has(id)) {
    throw new Error(`Language "${id}" is in LANGUAGE_IDS but has no definition in the registry`);
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

/**
 * Get all file extensions supported by registered languages.
 * Cached after first call.
 */
let extensionCache: string[] | null = null;

export function getSupportedExtensions(): string[] {
  if (!extensionCache) {
    extensionCache = definitions.flatMap(d => d.extensions);
  }
  return extensionCache;
}

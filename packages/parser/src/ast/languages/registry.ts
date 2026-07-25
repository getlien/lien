import { extname } from 'path';
import type { LanguageDefinition } from './types.js';
import { typescriptDefinition } from './typescript.js';
import { javascriptDefinition } from './javascript.js';
import { phpDefinition } from './php.js';
import { pythonDefinition } from './python.js';
import { rustDefinition } from './rust.js';
import { goDefinition } from './go.js';
import { javaDefinition } from './java.js';
import { csharpDefinition } from './csharp.js';
import { rubyDefinition } from './ruby.js';
import { kotlinDefinition } from './kotlin.js';
import { swiftDefinition } from './swift.js';

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
  javaDefinition,
  csharpDefinition,
  rubyDefinition,
  kotlinDefinition,
  swiftDefinition,
];

/**
 * Canonical list of supported language IDs.
 * SupportedLanguage type is derived from this array.
 * To add a new language: add its ID here, then add its definition to `definitions` below.
 */
export const LANGUAGE_IDS = [
  'typescript',
  'javascript',
  'php',
  'python',
  'rust',
  'go',
  'java',
  'csharp',
  'ruby',
  'kotlin',
  'swift',
] as const;
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
 * True when `language`'s typical test files import their subject as a whole
 * module rather than a specific file/symbol path (see
 * `LanguageDefinition.wholeModuleImports`), so import-based test-association
 * matching can never resolve a test file to the specific source file(s) it
 * covers — a structural gap (#869), not a fixable matching bug. Callers use
 * this to give an honest "not determinable" signal instead of a misleading
 * "no coverage" one. Only Swift sets this today.
 */
export function hasWholeModuleImports(language: SupportedLanguage): boolean {
  return getLanguage(language).wholeModuleImports === true;
}

/**
 * True when `language` lets a nested namespace body reference an *enclosing*
 * namespace's members unqualified, with no `using`/`import` directive at all
 * (see `LanguageDefinition.enclosingNamespaceAccess`). C# confirmed (#875):
 * import-based test-association has no per-file signal for a test file that
 * only reaches its subject this way. Distinct from `hasWholeModuleImports` —
 * a language can have working per-file import matching for its *explicit*
 * imports (C# does, #866/#868) while still having this gap for the implicit
 * case, so callers must not conflate the two. Only C# sets this today.
 */
export function hasEnclosingNamespaceAccess(language: SupportedLanguage): boolean {
  return getLanguage(language).enclosingNamespaceAccess === true;
}

/**
 * True when `language`'s bare, potentially multi-segment import specifiers
 * always name a single file rather than a package directory whose files are
 * all implicitly members (see `LanguageDefinition.singleFileImports`, #887).
 * Only Ruby sets this today; every other language (notably Go, whose
 * `import "pkg/sub"` names a directory) leaves it unset and keeps the
 * permissive package-directory matching `matchesFile` has always done.
 */
export function hasSingleFileImports(language: SupportedLanguage): boolean {
  return getLanguage(language).singleFileImports === true;
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

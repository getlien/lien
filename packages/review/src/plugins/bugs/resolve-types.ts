/**
 * Type context resolution for LLM prompts.
 *
 * Resolves imported type/interface definitions so the LLM has actual signatures
 * rather than hallucinating them.
 */

import type { CodeChunk } from '@liendev/parser';
import { truncateContent } from './formatting.js';

export const MAX_TYPE_CONTEXT_CHARS = 5_000;
export const TYPE_SYMBOL_TYPES_SET = new Set(['class', 'interface', 'type']);

/** Collect all imported symbol names from a set of chunks. */
export function collectImportedSymbolNames(chunks: CodeChunk[]): Set<string> {
  const symbols = new Set<string>();
  for (const chunk of chunks) {
    if (!chunk.metadata.importedSymbols) continue;
    for (const syms of Object.values(chunk.metadata.importedSymbols)) {
      syms.forEach(s => symbols.add(s));
    }
  }
  return symbols;
}

/**
 * Resolve imported type/interface definitions for chunks shown to the LLM.
 * Prevents the LLM from hallucinating signatures by providing actual definitions.
 */
export function resolveTypeContext(chunks: CodeChunk[], repoChunks?: CodeChunk[]): string {
  if (!repoChunks) return '';

  const importedSymbols = collectImportedSymbolNames(chunks);
  if (importedSymbols.size === 0) return '';

  // Find type/interface/class definitions that match imported names
  const seen = new Set<string>();
  const typeDefs = repoChunks
    .filter(c => {
      const { symbolName, symbolType } = c.metadata;
      if (!symbolName || !symbolType || !TYPE_SYMBOL_TYPES_SET.has(symbolType)) return false;
      if (!importedSymbols.has(symbolName)) return false;
      const key = `${c.metadata.file}::${symbolName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(c => `// ${c.metadata.file}\n${truncateContent(c.content, 500)}`);

  // Cap total chars
  const capped: string[] = [];
  let totalChars = 0;
  for (const def of typeDefs) {
    if (totalChars + def.length > MAX_TYPE_CONTEXT_CHARS) break;
    capped.push(def);
    totalChars += def.length;
  }

  if (capped.length === 0) return '';
  return `\n## Type Definitions\n\nThese are the actual type signatures used in the code above. Use these — do NOT guess.\n\n\`\`\`\n${capped.join('\n\n')}\n\`\`\`\n`;
}

import type { CodeChunk } from '@liendev/parser';

/**
 * Compact codebase fingerprint derived from AST chunk metadata.
 * Computed once per review run; serialized into ~200 tokens for the LLM prompt.
 */
export interface CodebaseFingerprint {
  paradigm: {
    functionCount: number;
    methodCount: number;
    classCount: number;
    /** 0.0 = pure OOP, 1.0 = pure functional */
    ratio: number;
    dominantStyle: 'functional' | 'oop' | 'mixed';
  };
  naming: {
    functions: 'camelCase' | 'snake_case' | 'PascalCase' | 'mixed';
    classes: 'PascalCase' | 'camelCase' | 'snake_case' | 'mixed';
    summary: string;
  };
  moduleStructure: {
    barrelFileCount: number;
    averageImportDepth: number;
    structure: 'flat' | 'moderate' | 'nested';
  };
  asyncPattern: 'async/await' | 'promises' | 'callbacks' | 'sync' | 'mixed';
  languages: Record<string, number>;
  totalChunks: number;
}

const BARREL_BASENAME = /^(index|__init__|mod)\./;

const NAMING_PATTERNS = {
  SCREAMING_SNAKE: /^[A-Z][A-Z0-9_]+$/,
  PascalCase: /^[A-Z][a-zA-Z0-9]*$/,
  snake_case: /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/,
  camelCase: /^[a-z][a-zA-Z0-9]*$/,
} as const;

type NamingConvention = 'camelCase' | 'snake_case' | 'PascalCase';

const EMPTY_FINGERPRINT: CodebaseFingerprint = {
  paradigm: { functionCount: 0, methodCount: 0, classCount: 0, ratio: 0.5, dominantStyle: 'mixed' },
  naming: { functions: 'camelCase', classes: 'PascalCase', summary: 'unknown (no symbols)' },
  moduleStructure: { barrelFileCount: 0, averageImportDepth: 0, structure: 'flat' },
  asyncPattern: 'sync',
  languages: {},
  totalChunks: 0,
};

export function computeFingerprint(chunks: CodeChunk[]): CodebaseFingerprint {
  if (chunks.length === 0) return { ...EMPTY_FINGERPRINT };

  return {
    paradigm: computeParadigm(chunks),
    naming: computeNaming(chunks),
    moduleStructure: computeModuleStructure(chunks),
    asyncPattern: computeAsyncPattern(chunks),
    languages: computeLanguages(chunks),
    totalChunks: chunks.length,
  };
}

const PARADIGM_TYPES = new Set(['function', 'method', 'class', 'interface']);

function countSymbolTypes(chunks: CodeChunk[]): Record<string, number> {
  const counts: Record<string, number> = { function: 0, method: 0, class: 0 };
  for (const chunk of chunks) {
    const st = chunk.metadata.symbolType;
    if (st === 'class' || st === 'interface') counts.class++;
    else if (st && PARADIGM_TYPES.has(st)) counts[st]++;
  }
  return counts;
}

function computeParadigm(chunks: CodeChunk[]): CodebaseFingerprint['paradigm'] {
  const counts = countSymbolTypes(chunks);
  const { function: functionCount, method: methodCount, class: classCount } = counts;

  const total = functionCount + methodCount + classCount;
  const ratio = total === 0 ? 0.5 : functionCount / total;
  const dominantStyle = ratio >= 0.7 ? 'functional' : ratio <= 0.3 ? 'oop' : 'mixed';

  return { functionCount, methodCount, classCount, ratio, dominantStyle };
}

function classifyName(name: string): NamingConvention | null {
  if (name.length < 2) return null;
  if (NAMING_PATTERNS.SCREAMING_SNAKE.test(name)) return null; // constants, skip
  if (NAMING_PATTERNS.PascalCase.test(name)) return 'PascalCase';
  if (NAMING_PATTERNS.snake_case.test(name)) return 'snake_case';
  if (NAMING_PATTERNS.camelCase.test(name)) return 'camelCase';
  return null;
}

function dominantConvention(
  counts: Record<NamingConvention, number>,
): 'camelCase' | 'snake_case' | 'PascalCase' | 'mixed' {
  const total = counts.camelCase + counts.snake_case + counts.PascalCase;
  if (total === 0) return 'mixed';

  for (const convention of ['camelCase', 'snake_case', 'PascalCase'] as const) {
    if (counts[convention] / total > 0.5) return convention;
  }
  return 'mixed';
}

function computeNaming(chunks: CodeChunk[]): CodebaseFingerprint['naming'] {
  const fnCounts: Record<NamingConvention, number> = { camelCase: 0, snake_case: 0, PascalCase: 0 };
  const clsCounts: Record<NamingConvention, number> = {
    camelCase: 0,
    snake_case: 0,
    PascalCase: 0,
  };

  for (const chunk of chunks) {
    const { symbolName, symbolType } = chunk.metadata;
    if (!symbolName) continue;

    const convention = classifyName(symbolName);
    if (!convention) continue;

    if (symbolType === 'function' || symbolType === 'method') {
      fnCounts[convention]++;
    } else if (symbolType === 'class' || symbolType === 'interface') {
      clsCounts[convention]++;
    }
  }

  const functions = dominantConvention(fnCounts);
  const classes = dominantConvention(clsCounts);

  return { functions, classes, summary: buildNamingSummary(functions, classes) };
}

function buildNamingSummary(functions: string, classes: string): string {
  if (functions === 'mixed' && classes === 'mixed') return 'mixed naming conventions';
  if (functions === classes) return `${functions} functions and classes`;
  return `${functions} functions, ${classes} classes`;
}

function computeModuleStructure(chunks: CodeChunk[]): CodebaseFingerprint['moduleStructure'] {
  const chunksByFile = groupChunksByFile(chunks);
  const barrelFileCount = countBarrelFiles(chunksByFile);
  const averageImportDepth = computeAverageImportDepth(chunks);
  const structure =
    averageImportDepth < 2.0 ? 'flat' : averageImportDepth > 3.0 ? 'nested' : 'moderate';

  return { barrelFileCount, averageImportDepth, structure };
}

function groupChunksByFile(chunks: CodeChunk[]): Map<string, CodeChunk[]> {
  const map = new Map<string, CodeChunk[]>();
  for (const chunk of chunks) {
    const existing = map.get(chunk.metadata.file);
    if (existing) existing.push(chunk);
    else map.set(chunk.metadata.file, [chunk]);
  }
  return map;
}

function collectFileSymbols(fileChunks: CodeChunk[]): {
  exports: Set<string>;
  imports: Set<string>;
} {
  const exports = new Set<string>();
  const imports = new Set<string>();

  for (const chunk of fileChunks) {
    if (chunk.metadata.exports) {
      for (const exp of chunk.metadata.exports) exports.add(exp);
    }
    const allImported = Object.values(chunk.metadata.importedSymbols ?? {}).flat();
    for (const sym of allImported) imports.add(sym);
  }

  return { exports, imports };
}

function isBarrelFile(file: string, exports: Set<string>, imports: Set<string>): boolean {
  const basename = file.split('/').pop() || '';
  if (BARREL_BASENAME.test(basename)) return true;
  return [...exports].some(exp => imports.has(exp));
}

function countBarrelFiles(chunksByFile: Map<string, CodeChunk[]>): number {
  let count = 0;

  for (const [file, fileChunks] of chunksByFile) {
    const { exports, imports } = collectFileSymbols(fileChunks);
    if (exports.size === 0) continue;
    if (isBarrelFile(file, exports, imports)) count++;
  }

  return count;
}

function computeAverageImportDepth(chunks: CodeChunk[]): number {
  const depths: number[] = [];
  for (const chunk of chunks) {
    if (!chunk.metadata.imports) continue;
    for (const imp of chunk.metadata.imports) {
      if (imp.startsWith('.')) depths.push(imp.split('/').length - 1);
    }
  }
  return depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;
}

function classifyChunkAsync(chunk: CodeChunk): 'async' | 'promise' | 'callback' | null {
  const sig = chunk.metadata.signature || '';
  if (sig.includes('async ')) return 'async';
  if (isPromisePattern(sig, chunk.content)) return 'promise';
  if (isCallbackPattern(sig)) return 'callback';
  return null;
}

function computeAsyncPattern(chunks: CodeChunk[]): CodebaseFingerprint['asyncPattern'] {
  let asyncAwaitCount = 0;
  let promiseCount = 0;
  let callbackCount = 0;

  const fnChunks = chunks.filter(
    c => c.metadata.symbolType === 'function' || c.metadata.symbolType === 'method',
  );

  for (const chunk of fnChunks) {
    const kind = classifyChunkAsync(chunk);
    if (kind === 'async') asyncAwaitCount++;
    else if (kind === 'promise') promiseCount++;
    else if (kind === 'callback') callbackCount++;
  }

  return classifyAsyncPattern(asyncAwaitCount, promiseCount, callbackCount);
}

const isPromisePattern = (sig: string, content: string): boolean =>
  /Promise</.test(sig) || /\.then\(/.test(content);

const isCallbackPattern = (sig: string): boolean =>
  /callback|cb\b|done\b|next\b/.test(sig) && /function/.test(sig);

function classifyAsyncPattern(
  asyncAwait: number,
  promises: number,
  callbacks: number,
): CodebaseFingerprint['asyncPattern'] {
  const total = asyncAwait + promises + callbacks;
  if (total === 0) return 'sync';
  if (asyncAwait > 0.6 * total) return 'async/await';
  if (promises > 0.6 * total) return 'promises';
  if (callbacks > 0.6 * total) return 'callbacks';
  return 'mixed';
}

function computeLanguages(chunks: CodeChunk[]): Record<string, number> {
  const langCounts: Record<string, number> = {};
  for (const chunk of chunks) {
    const lang = chunk.metadata.language;
    langCounts[lang] = (langCounts[lang] || 0) + 1;
  }

  const total = chunks.length;
  const languages: Record<string, number> = {};
  for (const [lang, count] of Object.entries(langCounts)) {
    languages[lang] = Math.max(1, Math.round((count / total) * 100));
  }
  return languages;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function serializeFingerprint(fp: CodebaseFingerprint): string {
  const lines: string[] = ['## Codebase Fingerprint'];

  // Paradigm
  const total = fp.paradigm.functionCount + fp.paradigm.methodCount + fp.paradigm.classCount;
  const pctFn = total > 0 ? Math.round((fp.paradigm.functionCount / total) * 100) : 0;
  lines.push(
    `- Paradigm: ${capitalize(fp.paradigm.dominantStyle)} (${pctFn}% standalone functions, ${100 - pctFn}% class methods/classes)`,
  );

  // Naming
  lines.push(`- Naming: ${fp.naming.summary}`);

  // Modules
  const barrelNote =
    fp.moduleStructure.barrelFileCount > 0
      ? `, ${fp.moduleStructure.barrelFileCount} barrel/index files`
      : '';
  lines.push(
    `- Modules: ${fp.moduleStructure.structure} structure (avg import depth: ${fp.moduleStructure.averageImportDepth.toFixed(1)})${barrelNote}`,
  );

  // Async (omit if sync)
  if (fp.asyncPattern !== 'sync') {
    lines.push(`- Async: ${fp.asyncPattern}`);
  }

  // Languages
  const langEntries = Object.entries(fp.languages)
    .sort(([, a], [, b]) => b - a)
    .map(([lang, pct]) => `${lang} ${pct}%`)
    .join(', ');
  lines.push(`- Languages: ${langEntries}`);

  return lines.join('\n');
}

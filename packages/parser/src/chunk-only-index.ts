import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';
import type { CodeChunk } from './types.js';
import { chunkFile } from './chunker.js';
import { NativeBindingLoadError } from './ast/parser.js';
import { scanCodebase } from './scanner.js';
import { detectEcosystems, getEcosystemExcludePatterns } from './ecosystem-presets.js';
import {
  MAX_CHUNKABLE_FILE_SIZE_BYTES,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_INDEX_INCLUDE_PATTERNS,
  getParseStageConcurrency,
} from './constants.js';

const DEFAULT_CONCURRENCY = 4;

export interface ChunkOnlyOptions {
  /** Explicit list of files to index (skips full repo scan when provided) */
  filesToIndex?: string[];
  /** Concurrency for file processing */
  concurrency?: number;
  /** Chunk size in lines */
  chunkSize?: number;
  /** Chunk overlap in lines */
  chunkOverlap?: number;
}

export interface ChunkOnlyResult {
  success: boolean;
  filesIndexed: number;
  chunksCreated: number;
  durationMs: number;
  chunks: CodeChunk[];
  error?: string;
}

/** Scan files by auto-detecting ecosystem presets */
async function scanFilesToIndex(rootDir: string): Promise<string[]> {
  const ecosystems = await detectEcosystems(rootDir);
  const ecosystemExcludes = getEcosystemExcludePatterns(ecosystems);

  return scanCodebase({
    rootDir,
    includePatterns: DEFAULT_INDEX_INCLUDE_PATTERNS,
    excludePatterns: ecosystemExcludes,
  });
}

/** Normalize a file path to relative form */
function normalizeToRelativePath(file: string, rootDir: string): string {
  if (path.isAbsolute(file)) {
    return path.relative(rootDir, file);
  }
  return file;
}

/**
 * Process a single file for chunk-only indexing.
 */
async function chunkFileForCollection(
  file: string,
  rootDir: string,
  config: { chunkSize: number; chunkOverlap: number },
): Promise<CodeChunk[]> {
  try {
    const absolutePath = path.isAbsolute(file) ? file : path.join(rootDir, file);
    const relativePath = normalizeToRelativePath(file, rootDir);

    // Size cap before read (#1025's cap, mirrored for the chunk-only path).
    // Reading first would defeat the point: an 8 MB file costs ~1 GB of RSS
    // to chunk and then fails AST parsing on the native parser's napi string
    // limit, silently degrading to line-based chunks whose complexity metrics
    // are meaningless. `lien index` has always skipped these; the pure path
    // must too, or `lien complexity` reports on files `lien index` excluded.
    const { size } = await fs.stat(absolutePath);
    if (size > MAX_CHUNKABLE_FILE_SIZE_BYTES) return [];

    const content = await fs.readFile(absolutePath, 'utf-8');

    const chunks = chunkFile(relativePath, content, {
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      useAST: true,
      astFallback: 'line-based',
      workspaceRoot: rootDir,
    });

    return chunks;
  } catch (error) {
    // A native-binding load failure is systemic, not per-file: the binding
    // can't load for ANY file, so every AST-language file throws the same
    // error here. Swallowing it per-file would let performChunkOnlyIndex
    // report success on a corpus containing only the format-specific chunkers'
    // output (markdown/Liquid/Vue) -- a silently partial index. Re-throw so
    // the run fails loudly; performChunkOnlyIndex's outer handler catches it
    // once and surfaces the actionable message. Mirrors the same re-throw in
    // chunker.ts; see NativeBindingLoadError in ast/parser.ts.
    if (error instanceof NativeBindingLoadError) {
      throw error;
    }
    console.error(
      `[parser] Failed to process ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

/**
 * Chunk every file concurrently, preserving REQUEST order in the output.
 *
 * Each file writes into its own slot and the slots are flattened in `files`
 * order. The obvious alternative — pushing into one shared array from
 * concurrent tasks — makes chunk order I/O-completion order, which is not
 * stable run to run. That matters downstream: `analyzeDependencies` builds
 * its `dependents` list from a Map keyed in chunk order, so
 * `lien complexity --format json` emitted a different byte stream on every
 * run of an unchanged tree. `cli-commands.md` documents diffing that JSON
 * against a committed baseline, and SARIF result order feeds code-scanning
 * alert identity; both need determinism.
 *
 * `filesProcessed` counts files ATTEMPTED, not files that yielded chunks — an
 * unreadable or oversized file still counts. Existing behaviour; see the
 * ENOENT case in chunk-only-index.test.ts.
 */
async function chunkAllFiles(
  files: string[],
  rootDir: string,
  config: { chunkSize: number; chunkOverlap: number; concurrency: number },
): Promise<{ chunks: CodeChunk[]; filesProcessed: number }> {
  const perFile: CodeChunk[][] = new Array(files.length);
  let filesProcessed = 0;

  // CPU-bound parse stage (chunkFile) — cap independent of the requested
  // concurrency; see getParseStageConcurrency's doc comment / ADR-013.
  const limit = pLimit(getParseStageConcurrency(config.concurrency));
  await Promise.all(
    files.map((file, i) =>
      limit(async () => {
        perFile[i] = await chunkFileForCollection(file, rootDir, config);
        filesProcessed++;
      }),
    ),
  );

  return { chunks: perFile.flat(), filesProcessed };
}

/**
 * Perform chunk-only indexing (no embeddings or VectorDB).
 * Returns raw chunks in-memory for direct analysis.
 */
export async function performChunkOnlyIndex(
  rootDir: string,
  options: ChunkOnlyOptions = {},
): Promise<ChunkOnlyResult> {
  const startTime = Date.now();

  try {
    const files = options.filesToIndex ?? (await scanFilesToIndex(rootDir));

    if (files.length === 0) {
      return {
        success: false,
        filesIndexed: 0,
        chunksCreated: 0,
        durationMs: Date.now() - startTime,
        chunks: [],
        error: 'No files found to index',
      };
    }

    const { chunks: allChunks, filesProcessed } = await chunkAllFiles(files, rootDir, {
      chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
      chunkOverlap: options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
      concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    });

    return {
      success: true,
      filesIndexed: filesProcessed,
      chunksCreated: allChunks.length,
      durationMs: Date.now() - startTime,
      chunks: allChunks,
    };
  } catch (error) {
    return {
      success: false,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      chunks: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

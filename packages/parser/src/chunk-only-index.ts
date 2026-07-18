import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';
import type { CodeChunk } from './types.js';
import { chunkFile } from './chunker.js';
import { NativeBindingLoadError } from './ast/parser.js';
import { scanCodebase } from './scanner.js';
import { detectEcosystems, getEcosystemExcludePatterns } from './ecosystem-presets.js';
import {
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
  output: CodeChunk[],
): Promise<boolean> {
  try {
    const absolutePath = path.isAbsolute(file) ? file : path.join(rootDir, file);
    const relativePath = normalizeToRelativePath(file, rootDir);
    const content = await fs.readFile(absolutePath, 'utf-8');

    const chunks = chunkFile(relativePath, content, {
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      useAST: true,
      astFallback: 'line-based',
      workspaceRoot: rootDir,
    });

    if (chunks.length > 0) {
      output.push(...chunks);
      return true;
    }
    return false;
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
    return false;
  }
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

    const config = {
      chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
      chunkOverlap: options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
    };

    const allChunks: CodeChunk[] = [];
    let filesProcessed = 0;

    // CPU-bound parse stage (chunkFile) — cap independent of the requested
    // concurrency; see getParseStageConcurrency's doc comment / ADR-013.
    const limit = pLimit(getParseStageConcurrency(options.concurrency ?? DEFAULT_CONCURRENCY));
    await Promise.all(
      files.map(file =>
        limit(async () => {
          await chunkFileForCollection(file, rootDir, config, allChunks);
          filesProcessed++;
        }),
      ),
    );

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

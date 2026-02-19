import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';
import type { CodeChunk } from './types.js';
import { chunkFile } from './chunker.js';
import { scanCodebase } from './scanner.js';
import { detectEcosystems, getEcosystemExcludePatterns } from './ecosystem-presets.js';
import { extractRepoId } from './utils/repo-id.js';
import { DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP } from './constants.js';

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
    includePatterns: [
      '**/*.{ts,tsx,js,jsx,mjs,cjs,vue,py,php,go,rs,java,kt,swift,rb,cs,liquid,scala,c,cpp,cc,cxx,h,hpp}',
      '**/*.md',
      '**/*.mdx',
      '**/*.markdown',
    ],
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
  config: { chunkSize: number; chunkOverlap: number; repoId?: string },
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
      repoId: config.repoId,
    });

    if (chunks.length > 0) {
      output.push(...chunks);
      return true;
    }
    return false;
  } catch (error) {
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
      repoId: extractRepoId(rootDir),
    };

    const allChunks: CodeChunk[] = [];
    let filesProcessed = 0;

    const limit = pLimit(options.concurrency ?? DEFAULT_CONCURRENCY);
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

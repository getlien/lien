import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetFilesContextSchema } from '../schemas/index.js';
import { normalizePath, matchesFile, getCanonicalPath, isTestFile } from '../utils/path-matching.js';
import type { ToolContext, MCPToolResult } from '../types.js';

/**
 * Maximum number of chunks to scan for test association analysis.
 * Larger codebases may have incomplete results if they exceed this limit.
 */
const SCAN_LIMIT = 10000;

/**
 * Handle get_files_context tool calls.
 * Gets context for one or more files including dependencies and test coverage.
 */
export async function handleGetFilesContext(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, embeddings, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    GetFilesContextSchema,
    async (validatedArgs) => {
      // Normalize input: convert single string to array
      const filepaths = Array.isArray(validatedArgs.filepaths)
        ? validatedArgs.filepaths
        : [validatedArgs.filepaths];

      const isSingleFile = !Array.isArray(validatedArgs.filepaths);

      log(`Getting context for: ${filepaths.join(', ')}`);

      // Check if index has been updated and reconnect if needed
      await checkAndReconnect();

      // Compute workspace root for path matching
      const workspaceRoot = process.cwd().replace(/\\/g, '/');

      // Batch embedding calls for all filepaths at once to reduce latency
      const fileEmbeddings = await Promise.all(filepaths.map(fp => embeddings.embed(fp)));

      // Batch all initial file searches in parallel
      const allFileSearches = await Promise.all(
        fileEmbeddings.map((embedding, i) =>
          vectorDB.search(embedding, 50, filepaths[i])
        )
      );

      // Filter results to only include chunks from each target file
      // Use exact matching with getCanonicalPath to avoid false positives
      const fileChunksMap = filepaths.map((filepath, i) => {
        const allResults = allFileSearches[i];
        const targetCanonical = getCanonicalPath(filepath, workspaceRoot);

        return allResults.filter(r => {
          const chunkCanonical = getCanonicalPath(r.metadata.file, workspaceRoot);
          return chunkCanonical === targetCanonical;
        });
      });

      // Batch related chunk operations if includeRelated is true
      let relatedChunksMap: any[][] = [];
      if (validatedArgs.includeRelated) {
        // Get files that have chunks (need first chunk for related search)
        const filesWithChunks = fileChunksMap
          .map((chunks, i) => ({ chunks, filepath: filepaths[i], index: i }))
          .filter(({ chunks }) => chunks.length > 0);

        if (filesWithChunks.length > 0) {
          // Batch embedding calls for all first chunks
          const relatedEmbeddings = await Promise.all(
            filesWithChunks.map(({ chunks }) => embeddings.embed(chunks[0].content))
          );

          // Batch all related chunk searches
          const relatedSearches = await Promise.all(
            relatedEmbeddings.map((embedding, i) =>
              vectorDB.search(embedding, 5, filesWithChunks[i].chunks[0].content)
            )
          );

          // Map back to original indices
          relatedChunksMap = Array.from({ length: filepaths.length }, () => []);
          filesWithChunks.forEach(({ filepath, index }, i) => {
            const related = relatedSearches[i];
            const targetCanonical = getCanonicalPath(filepath, workspaceRoot);
            // Filter out chunks from the same file using exact matching
            relatedChunksMap[index] = related.filter(r => {
              const chunkCanonical = getCanonicalPath(r.metadata.file, workspaceRoot);
              return chunkCanonical !== targetCanonical;
            });
          });
        }
      }

      // Compute test associations for each file
      // Scan once for all files to avoid repeated database queries (performance optimization)
      const allChunks = await vectorDB.scanWithFilter({ limit: SCAN_LIMIT });

      // Warn if we hit the limit (similar to get_dependents tool)
      if (allChunks.length === SCAN_LIMIT) {
        log(`Scanned ${SCAN_LIMIT} chunks (limit reached). Test associations may be incomplete for large codebases.`, 'warning');
      }

      // Path normalization cache to avoid repeated string operations
      const pathCache = new Map<string, string>();
      const normalizePathCached = (path: string): string => {
        if (pathCache.has(path)) return pathCache.get(path)!;
        const normalized = normalizePath(path, workspaceRoot);
        pathCache.set(path, normalized);
        return normalized;
      };

      // Compute test associations for each file using the same scan result
      const testAssociationsMap = filepaths.map((filepath) => {
        const normalizedTarget = normalizePathCached(filepath);

        // Find chunks that:
        // 1. Are from test files
        // 2. Import the target file
        const testFiles = new Set<string>();
        for (const chunk of allChunks) {
          const chunkFile = getCanonicalPath(chunk.metadata.file, workspaceRoot);

          // Skip if not a test file
          if (!isTestFile(chunkFile)) continue;

          // Check if this test file imports the target
          const imports = chunk.metadata.imports || [];
          for (const imp of imports) {
            const normalizedImport = normalizePathCached(imp);
            if (matchesFile(normalizedImport, normalizedTarget)) {
              testFiles.add(chunkFile);
              break;
            }
          }
        }

        return Array.from(testFiles);
      });

      // Combine file chunks with related chunks and test associations
      const filesData: Record<string, { chunks: any[]; testAssociations: string[] }> = {};
      filepaths.forEach((filepath, i) => {
        const fileChunks = fileChunksMap[i];
        const relatedChunks = relatedChunksMap[i] || [];

        // Deduplicate chunks (by canonical file path + line range)
        // Use canonical paths to avoid duplicates from absolute vs relative paths
        const seenChunks = new Set<string>();
        const dedupedChunks = [...fileChunks, ...relatedChunks].filter(chunk => {
          const canonicalFile = getCanonicalPath(chunk.metadata.file, workspaceRoot);
          const chunkId = `${canonicalFile}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
          if (seenChunks.has(chunkId)) return false;
          seenChunks.add(chunkId);
          return true;
        });

        filesData[filepath] = {
          chunks: dedupedChunks,
          testAssociations: testAssociationsMap[i],
        };
      });

      log(`Found ${Object.values(filesData).reduce((sum, f) => sum + f.chunks.length, 0)} total chunks`);

      // Return format depends on single vs multi file
      if (isSingleFile) {
        // Single file: return old format for backward compatibility
        const filepath = filepaths[0];
        return {
          indexInfo: getIndexMetadata(),
          file: filepath,
          chunks: filesData[filepath].chunks,
          testAssociations: filesData[filepath].testAssociations,
        };
      } else {
        // Multiple files: return new format
        return {
          indexInfo: getIndexMetadata(),
          files: filesData,
        };
      }
    }
  )(args);
}

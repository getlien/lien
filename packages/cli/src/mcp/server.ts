import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tools } from './tools.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { GitStateTracker } from '../git/tracker.js';
import { indexMultipleFiles, indexSingleFile } from '../indexer/incremental.js';
import { configService } from '../config/service.js';
import { ManifestManager } from '../indexer/manifest.js';
import { isGitAvailable, isGitRepo } from '../git/utils.js';
import { FileWatcher } from '../watcher/index.js';
import { VERSION_CHECK_INTERVAL_MS } from '../constants.js';
import { wrapToolHandler } from './utils/tool-wrapper.js';
import { normalizePath, matchesFile, getCanonicalPath, isTestFile } from './utils/path-matching.js';
import {
  SemanticSearchSchema,
  FindSimilarSchema,
  GetFilesContextSchema,
  ListFunctionsSchema,
  GetDependentsSchema,
} from './schemas/index.js';
import { LienError, LienErrorCode } from '../errors/index.js';

// Get version from package.json dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

let packageJson: { name: string; version: string };
try {
  packageJson = require(join(__dirname, '../package.json'));
} catch {
  packageJson = require(join(__dirname, '../../package.json'));
}

export interface MCPServerOptions {
  rootDir: string;
  verbose?: boolean;
  watch?: boolean;
}

/**
 * Complexity metrics for a single dependent file.
 */
interface FileComplexity {
  filepath: string;
  avgComplexity: number;
  maxComplexity: number;
  complexityScore: number; // Sum of all complexities
  chunksWithComplexity: number;
}

/**
 * Aggregate complexity metrics for all dependents.
 */
interface ComplexityMetrics {
  averageComplexity: number;
  maxComplexity: number;
  filesWithComplexityData: number;
  highComplexityDependents: Array<{
    filepath: string;
    maxComplexity: number;
    avgComplexity: number;
  }>;
  complexityRiskBoost: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Risk level thresholds for dependent count.
 * Based on impact analysis: more dependents = higher risk of breaking changes.
 */
const DEPENDENT_COUNT_THRESHOLDS = {
  LOW: 5,       // Few dependents, safe to change
  MEDIUM: 15,   // Moderate impact, review dependents
  HIGH: 30,     // High impact, careful planning needed
} as const;

/**
 * Complexity thresholds for risk assessment.
 * Based on cyclomatic complexity: higher complexity = harder to change safely.
 */
const COMPLEXITY_THRESHOLDS = {
  HIGH_COMPLEXITY_DEPENDENT: 10,  // Individual file is complex
  CRITICAL_AVG: 15,              // Average complexity indicates systemic complexity
  CRITICAL_MAX: 25,              // Peak complexity indicates hotspot
  HIGH_AVG: 10,                  // Moderately complex on average
  HIGH_MAX: 20,                  // Some complex functions exist
  MEDIUM_AVG: 6,                 // Slightly above simple code
  MEDIUM_MAX: 15,                // Occasional branching
} as const;

/**
 * Maximum number of chunks to scan for dependency analysis.
 * Larger codebases may have incomplete results if they exceed this limit.
 */
const SCAN_LIMIT = 10000;

export async function startMCPServer(options: MCPServerOptions): Promise<void> {
  const { rootDir, verbose, watch } = options;
  
  // Log to stderr (stdout is reserved for MCP protocol)
  const log = (message: string) => {
    if (verbose) {
      console.error(`[Lien MCP] ${message}`);
    }
  };
  
  log('Initializing MCP server...');
  
  // Initialize embeddings and vector DB
  const embeddings = new LocalEmbeddings();
  const vectorDB = new VectorDB(rootDir);
  
  try {
    log('Loading embedding model...');
    await embeddings.initialize();
    
    log('Loading vector database...');
    await vectorDB.initialize();
    
    log('Embeddings and vector DB ready');
  } catch (error) {
    console.error(`Failed to initialize: ${error}`);
    process.exit(1);
  }
  
  // Create MCP server
  const server = new Server(
    {
      name: 'lien',
      version: packageJson.version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  
  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));
  
  // Helper function to check version and reconnect if needed
  const checkAndReconnect = async () => {
    try {
      const versionChanged = await vectorDB.checkVersion();
      if (versionChanged) {
        log('Index version changed, reconnecting to database...');
        await vectorDB.reconnect();
        log('Reconnected to updated index');
      }
    } catch (error) {
      // Log but don't throw - fall back to existing connection
      log(`Version check failed: ${error}`);
    }
  };
  
  // Helper to get current index metadata for responses
  const getIndexMetadata = () => ({
    indexVersion: vectorDB.getCurrentVersion(),
    indexDate: vectorDB.getVersionDate(),
  });
  
  // Start background polling for version changes (every 2 seconds)
  // This ensures we reconnect as soon as possible after reindex, even if no tool calls are made
  const versionCheckInterval = setInterval(async () => {
    await checkAndReconnect();
  }, VERSION_CHECK_INTERVAL_MS);
  
  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    log(`Handling tool call: ${name}`);
    
    try {
      switch (name) {
      case 'semantic_search':
        return await wrapToolHandler(
          SemanticSearchSchema,
          async (validatedArgs) => {
            log(`Searching for: "${validatedArgs.query}"`);
            
            // Check if index has been updated and reconnect if needed
            await checkAndReconnect();
            
            const queryEmbedding = await embeddings.embed(validatedArgs.query);
            const results = await vectorDB.search(queryEmbedding, validatedArgs.limit, validatedArgs.query);
            
            log(`Found ${results.length} results`);
            
            return {
              indexInfo: getIndexMetadata(),
              results,
            };
          }
        )(args);
      
      case 'find_similar':
        return await wrapToolHandler(
          FindSimilarSchema,
          async (validatedArgs) => {
            log(`Finding similar code...`);
            
            // Check if index has been updated and reconnect if needed
            await checkAndReconnect();
            
            const codeEmbedding = await embeddings.embed(validatedArgs.code);
            // Pass code as query for relevance boosting
            const results = await vectorDB.search(codeEmbedding, validatedArgs.limit, validatedArgs.code);
            
            log(`Found ${results.length} similar chunks`);
            
            return {
              indexInfo: getIndexMetadata(),
              results,
            };
          }
        )(args);
      
      case 'get_files_context':
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
              log(`WARNING: Scanned ${SCAN_LIMIT} chunks (limit reached). Test associations may be incomplete for large codebases.`);
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
              const allChunks = [...fileChunks, ...relatedChunks].filter(chunk => {
                const canonicalFile = getCanonicalPath(chunk.metadata.file, workspaceRoot);
                const chunkId = `${canonicalFile}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
                if (seenChunks.has(chunkId)) return false;
                seenChunks.add(chunkId);
                return true;
              });
              
              filesData[filepath] = { 
                chunks: allChunks,
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
      
      case 'list_functions':
        return await wrapToolHandler(
          ListFunctionsSchema,
          async (validatedArgs) => {
            log('Listing functions with symbol metadata...');
            
            // Check if index has been updated and reconnect if needed
            await checkAndReconnect();
            
            let results;
            let usedMethod = 'symbols';
            
            try {
              // Try using symbol-based query first (v0.5.0+)
              results = await vectorDB.querySymbols({
                language: validatedArgs.language,
                pattern: validatedArgs.pattern,
                limit: 50,
              });
              
              // If no results and pattern was provided, it might be an old index
              // Fall back to content scanning
              if (results.length === 0 && (validatedArgs.language || validatedArgs.pattern)) {
                log('No symbol results, falling back to content scan...');
                results = await vectorDB.scanWithFilter({
                  language: validatedArgs.language,
                  pattern: validatedArgs.pattern,
                  limit: 50,
                });
                usedMethod = 'content';
              }
            } catch (error) {
              // If querySymbols fails (e.g., old index without symbol fields), fall back
              log(`Symbol query failed, falling back to content scan: ${error}`);
              results = await vectorDB.scanWithFilter({
                language: validatedArgs.language,
                pattern: validatedArgs.pattern,
                limit: 50,
              });
              usedMethod = 'content';
            }
            
            log(`Found ${results.length} matches using ${usedMethod} method`);
            
            return {
              indexInfo: getIndexMetadata(),
              method: usedMethod,
              results,
              note: usedMethod === 'content' 
                ? 'Using content search. Run "lien reindex" to enable faster symbol-based queries.'
                : undefined,
            };
          }
        )(args);
      
      case 'get_dependents':
        return await wrapToolHandler(
          GetDependentsSchema,
          async (validatedArgs) => {
            log(`Finding dependents of: ${validatedArgs.filepath}`);
            
            // Check if index has been updated and reconnect if needed
            await checkAndReconnect();
            
            // Get all chunks - they include imports metadata
            const allChunks = await vectorDB.scanWithFilter({ limit: SCAN_LIMIT });
            
            // Warn if we hit the limit (results may be truncated)
            if (allChunks.length === SCAN_LIMIT) {
              log(`WARNING: Scanned ${SCAN_LIMIT} chunks (limit reached). Results may be incomplete for large codebases.`);
            }
            
            log(`Scanning ${allChunks.length} chunks for imports...`);
            
            // Compute workspace root once (used by normalizePath and getCanonicalPath)
            const workspaceRoot = process.cwd().replace(/\\/g, '/');
            
            // Path normalization cache to avoid repeated string operations
            const pathCache = new Map<string, string>();
            const normalizePathCached = (path: string): string => {
              if (pathCache.has(path)) return pathCache.get(path)!;
              const normalized = normalizePath(path, workspaceRoot);
              pathCache.set(path, normalized);
              return normalized;
            };
            
            // Build import-to-chunk index for O(n) instead of O(n*m) lookup
            // Key: normalized import path, Value: array of chunks that import it
            const importIndex = new Map<string, typeof allChunks>();
            for (const chunk of allChunks) {
              const imports = chunk.metadata.imports || [];
              for (const imp of imports) {
                const normalizedImport = normalizePathCached(imp);
                if (!importIndex.has(normalizedImport)) {
                  importIndex.set(normalizedImport, []);
                }
                importIndex.get(normalizedImport)!.push(chunk);
              }
            }
            
            // Find all chunks that import the target file using index + fuzzy matching
            const normalizedTarget = normalizePathCached(validatedArgs.filepath);
            const dependentChunks: typeof allChunks = [];
            // Track chunks we've already added to avoid duplicates when the same chunk
            // matches via multiple strategies (e.g., both direct lookup and fuzzy match)
            const seenChunkIds = new Set<string>();
            
            // First: Try direct index lookup (fastest path)
            if (importIndex.has(normalizedTarget)) {
              for (const chunk of importIndex.get(normalizedTarget)!) {
                // Use file + line range as unique chunk identifier
                const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
                if (!seenChunkIds.has(chunkId)) {
                  dependentChunks.push(chunk);
                  seenChunkIds.add(chunkId);
                }
              }
            }
            
            // Second: Fuzzy match against all unique import paths in the index
            // This handles relative imports and path variations
            for (const [normalizedImport, chunks] of importIndex.entries()) {
              // Skip exact match (already processed in direct lookup above)
              if (normalizedImport !== normalizedTarget && matchesFile(normalizedImport, normalizedTarget)) {
                for (const chunk of chunks) {
                  // Use file + line range as unique chunk identifier
                  const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
                  if (!seenChunkIds.has(chunkId)) {
                    dependentChunks.push(chunk);
                    seenChunkIds.add(chunkId);
                  }
                }
              }
            }
            
            // Group chunks by file for complexity analysis
            // Use canonical paths (with extensions) for the final output to show users actual file names.
            // Multiple chunks from the same file are grouped together for accurate complexity metrics.
            const chunksByFile = new Map<string, typeof dependentChunks>();
            for (const chunk of dependentChunks) {
              const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
              const existing = chunksByFile.get(canonical) || [];
              existing.push(chunk);
              chunksByFile.set(canonical, existing);
            }
            
            // Calculate complexity metrics per file (using module-level interfaces)
            const fileComplexities: FileComplexity[] = [];
            
            for (const [filepath, chunks] of chunksByFile.entries()) {
              const complexities = chunks
                .map(c => c.metadata.complexity)
                .filter((c): c is number => typeof c === 'number' && c > 0);
              
              if (complexities.length > 0) {
                const sum = complexities.reduce((a, b) => a + b, 0);
                const avg = sum / complexities.length;
                // Math.max is safe here because complexities.length > 0 is guaranteed by the if condition
                const max = Math.max(...complexities);
                
                fileComplexities.push({
                  filepath,
                  avgComplexity: Math.round(avg * 10) / 10, // Round to 1 decimal
                  maxComplexity: max,
                  complexityScore: sum,
                  chunksWithComplexity: complexities.length,
                });
              }
            }
            
            // Calculate overall complexity metrics (always return for consistent response shape)
            let complexityMetrics: ComplexityMetrics;
            
            if (fileComplexities.length > 0) {
              const allAvgs = fileComplexities.map(f => f.avgComplexity);
              const allMaxes = fileComplexities.map(f => f.maxComplexity);
              const totalAvg = allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length;
              // Math.max is safe here: allMaxes is non-empty because fileComplexities has entries
              const globalMax = Math.max(...allMaxes);
              
              // Identify high-complexity dependents
              const highComplexityDependents = fileComplexities
                .filter(f => f.maxComplexity > COMPLEXITY_THRESHOLDS.HIGH_COMPLEXITY_DEPENDENT)
                .sort((a, b) => b.maxComplexity - a.maxComplexity)
                .slice(0, 5) // Top 5
                .map(f => ({
                  filepath: f.filepath,
                  maxComplexity: f.maxComplexity,
                  avgComplexity: f.avgComplexity,
                }));
              
              // Calculate complexity-based risk boost
              let complexityRiskBoost: 'low' | 'medium' | 'high' | 'critical' = 'low';
              if (totalAvg > COMPLEXITY_THRESHOLDS.CRITICAL_AVG || globalMax > COMPLEXITY_THRESHOLDS.CRITICAL_MAX) {
                complexityRiskBoost = 'critical';
              } else if (totalAvg > COMPLEXITY_THRESHOLDS.HIGH_AVG || globalMax > COMPLEXITY_THRESHOLDS.HIGH_MAX) {
                complexityRiskBoost = 'high';
              } else if (totalAvg > COMPLEXITY_THRESHOLDS.MEDIUM_AVG || globalMax > COMPLEXITY_THRESHOLDS.MEDIUM_MAX) {
                complexityRiskBoost = 'medium';
              }
              
              complexityMetrics = {
                averageComplexity: Math.round(totalAvg * 10) / 10,
                maxComplexity: globalMax,
                filesWithComplexityData: fileComplexities.length,
                highComplexityDependents,
                complexityRiskBoost,
              };
            } else {
              // No complexity data available - return empty structure for consistent response shape
              complexityMetrics = {
                averageComplexity: 0,
                maxComplexity: 0,
                filesWithComplexityData: 0,
                highComplexityDependents: [],
                complexityRiskBoost: 'low',
              };
            }
            
            // Use chunksByFile keys for the dependents list (already canonical and deduplicated)
            const uniqueFiles = Array.from(chunksByFile.keys()).map(filepath => ({
              filepath,
              isTestFile: isTestFile(filepath),
            }));
            
            // Calculate risk level based on dependent count (using module-level thresholds)
            const count = uniqueFiles.length;
            let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 
              count === 0 ? 'low' :
              count <= DEPENDENT_COUNT_THRESHOLDS.LOW ? 'low' :
              count <= DEPENDENT_COUNT_THRESHOLDS.MEDIUM ? 'medium' :
              count <= DEPENDENT_COUNT_THRESHOLDS.HIGH ? 'high' : 'critical';
            
            // Boost risk level if complexity is high
            // Use explicit risk ordering for maintainability
            const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 } as const;
            if (RISK_ORDER[complexityMetrics.complexityRiskBoost] > RISK_ORDER[riskLevel]) {
              riskLevel = complexityMetrics.complexityRiskBoost;
            }
            
            log(`Found ${count} dependent files (risk: ${riskLevel}${complexityMetrics.filesWithComplexityData > 0 ? ', complexity-boosted' : ''})`);
            
            // Build warning if scan limit was reached (results may be incomplete)
            let note: string | undefined;
            if (allChunks.length === SCAN_LIMIT) {
              note = `Warning: Scanned ${SCAN_LIMIT} chunks (limit reached). Results may be incomplete for large codebases. Some dependents might not be listed.`;
            }
            
            return {
              indexInfo: getIndexMetadata(),
              filepath: validatedArgs.filepath,
              dependentCount: count,
              riskLevel,
              dependents: uniqueFiles,
              complexityMetrics,
              note,
            };
          }
        )(args);
      
      default:
        throw new LienError(
          `Unknown tool: ${name}`,
          LienErrorCode.INVALID_INPUT,
          { requestedTool: name, availableTools: tools.map(t => t.name) },
          'medium',
          false,
          false
        );
      }
    } catch (error) {
      // Handle errors at the switch level (e.g., unknown tool)
      if (error instanceof LienError) {
        return {
          isError: true,
          content: [{
            type: 'text' as const,
            text: JSON.stringify(error.toJSON(), null, 2),
          }],
        };
      }
      
      // Unexpected error
      console.error(`Unexpected error handling tool call ${name}:`, error);
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            code: LienErrorCode.INTERNAL_ERROR,
            tool: name,
          }, null, 2),
        }],
      };
    }
  });
  
  // Load configuration for auto-indexing, git detection, and file watching
  const config = await configService.load(rootDir);
  
  // Check if this is the first run (no data in index) and auto-index if needed
  const hasIndex = await vectorDB.hasData();
  
  if (!hasIndex && config.mcp.autoIndexOnFirstRun) {
    log('📦 No index found - running initial indexing...');
    log('⏱️  This may take 5-20 minutes depending on project size');
    
    try {
      // Import indexCodebase function
      const { indexCodebase } = await import('../indexer/index.js');
      await indexCodebase({ rootDir, verbose: true });
      log('✅ Initial indexing complete!');
    } catch (error) {
      log(`⚠️  Initial indexing failed: ${error}`);
      log('You can manually run: lien index');
      // Don't exit - server can still start, just won't have data
    }
  } else if (!hasIndex) {
    log('⚠️  No index found. Auto-indexing is disabled in config.');
    log('Run "lien index" to index your codebase.');
  }
  
  // Initialize git detection if enabled
  let gitTracker: GitStateTracker | null = null;
  let gitPollInterval: NodeJS.Timeout | null = null;
  let fileWatcher: FileWatcher | null = null;
  
  if (config.gitDetection.enabled) {
    const gitAvailable = await isGitAvailable();
    const isRepo = await isGitRepo(rootDir);
    
    if (gitAvailable && isRepo) {
      log('✓ Detected git repository');
      gitTracker = new GitStateTracker(rootDir, vectorDB.dbPath);
      
      // Check for git changes on startup
      try {
        log('Checking for git changes...');
        const changedFiles = await gitTracker.initialize();
        
        if (changedFiles && changedFiles.length > 0) {
          log(`🌿 Git changes detected: ${changedFiles.length} files changed`);
          log('Reindexing changed files...');
          
          const count = await indexMultipleFiles(
            changedFiles,
            vectorDB,
            embeddings,
            config,
            { verbose }
          );
          
          log(`✓ Reindexed ${count} files`);
        } else {
          log('✓ Index is up to date with git state');
        }
      } catch (error) {
        log(`Warning: Failed to check git state on startup: ${error}`);
      }
      
      // Start background polling for git changes
      log(`✓ Git detection enabled (checking every ${config.gitDetection.pollIntervalMs / 1000}s)`);
      
      gitPollInterval = setInterval(async () => {
        try {
          const changedFiles = await gitTracker!.detectChanges();
          
          if (changedFiles && changedFiles.length > 0) {
            log(`🌿 Git change detected: ${changedFiles.length} files changed`);
            log('Reindexing in background...');
            
            // Don't await - run in background
            indexMultipleFiles(
              changedFiles,
              vectorDB,
              embeddings,
              config,
              { verbose }
            ).then(count => {
              log(`✓ Background reindex complete: ${count} files`);
            }).catch(error => {
              log(`Warning: Background reindex failed: ${error}`);
            });
          }
        } catch (error) {
          log(`Warning: Git detection check failed: ${error}`);
        }
      }, config.gitDetection.pollIntervalMs);
    } else {
      if (!gitAvailable) {
        log('Git not available - git detection disabled');
      } else if (!isRepo) {
        log('Not a git repository - git detection disabled');
      }
    }
  } else {
    log('Git detection disabled by configuration');
  }
  
  // Initialize file watching if enabled
  // Priority: CLI flag if explicitly set (true/false), otherwise use config default
  const fileWatchingEnabled = watch !== undefined ? watch : config.fileWatching.enabled;
  
  if (fileWatchingEnabled) {
    log('👀 Starting file watcher...');
    fileWatcher = new FileWatcher(rootDir, config);
    
    try {
      await fileWatcher.start(async (event) => {
        const { type, filepath } = event;
        
        if (type === 'unlink') {
          // File deleted
          log(`🗑️  File deleted: ${filepath}`);
          try {
            await vectorDB.deleteByFile(filepath);
            
            // Update manifest
            const manifest = new ManifestManager(vectorDB.dbPath);
            await manifest.removeFile(filepath);
            
            log(`✓ Removed ${filepath} from index`);
          } catch (error) {
            log(`Warning: Failed to remove ${filepath}: ${error}`);
          }
        } else {
          // File added or changed
          const action = type === 'add' ? 'added' : 'changed';
          log(`📝 File ${action}: ${filepath}`);
          
          // Reindex in background
          indexSingleFile(filepath, vectorDB, embeddings, config, { verbose })
            .catch((error) => {
              log(`Warning: Failed to reindex ${filepath}: ${error}`);
            });
        }
      });
      
      const watchedCount = fileWatcher.getWatchedFiles().length;
      log(`✓ File watching enabled (watching ${watchedCount} files)`);
    } catch (error) {
      log(`Warning: Failed to start file watcher: ${error}`);
      fileWatcher = null;
    }
  }
  
  // Handle shutdown gracefully
  const cleanup = async () => {
    log('Shutting down MCP server...');
    clearInterval(versionCheckInterval);
    if (gitPollInterval) {
      clearInterval(gitPollInterval);
    }
    if (fileWatcher) {
      await fileWatcher.stop();
    }
    process.exit(0);
  };
  
  // Listen for termination signals
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  
  // Connect to stdio transport
  const transport = new StdioServerTransport();
  
  // Use SDK's transport callbacks for parent process detection
  // This avoids conflicts with the transport's stdin management
  transport.onclose = () => {
    log('Transport closed, parent process likely terminated');
    cleanup().catch(() => process.exit(0));
  };
  
  transport.onerror = (error) => {
    log(`Transport error: ${error}`);
    // Transport will close after error, onclose will handle cleanup
  };
  
  await server.connect(transport);
  
  log('MCP server started and listening on stdio');
}


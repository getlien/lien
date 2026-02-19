import type { LanceDBConnection, LanceDBTable } from './lancedb-types.js';
import type { ChunkMetadata } from '@liendev/parser';
import { DatabaseError } from '../errors/index.js';
import { VECTOR_DB_MAX_BATCH_SIZE, VECTOR_DB_MIN_BATCH_SIZE } from '../constants.js';

/**
 * Batch of data to be inserted into the vector database
 */
interface BatchToProcess {
  vectors: Float32Array[];
  metadatas: ChunkMetadata[];
  contents: string[];
}

/**
 * Database record format for LanceDB storage
 */
interface DatabaseRecord {
  vector: number[];
  content: string;
  file: string;
  startLine: number;
  endLine: number;
  type: string;
  language: string;
  functionNames: string[];
  classNames: string[];
  interfaceNames: string[];
  symbolName: string;
  symbolType: string;
  parentClass: string;
  complexity: number;
  cognitiveComplexity: number;
  parameters: string[];
  signature: string;
  imports: string[];
  // Halstead metrics (v0.19.0)
  halsteadVolume: number;
  halsteadDifficulty: number;
  halsteadEffort: number;
  halsteadBugs: number;
  // Symbol-level dependency tracking (v0.23.0)
  exports: string[];
  importedSymbolPaths: string[]; // Import paths (keys from importedSymbols map)
  importedSymbolNames: string[]; // JSON-encoded symbol arrays (values from importedSymbols map)
  callSiteSymbols: string[]; // Called symbol names
  callSiteLines: number[]; // Line numbers of calls (parallel array)
}

/**
 * Arrow type inference placeholder for empty string arrays.
 * Used to prevent schema inference failures when no data is present.
 * Filtered out during deserialization via hasValidStringEntries().
 */
const ARROW_EMPTY_STRING_PLACEHOLDER = [''];

/**
 * Serialize importedSymbols map into parallel arrays for Arrow storage.
 * Returns { paths: string[], names: string[] } where names[i] is JSON-encoded array
 * of symbols imported from paths[i].
 *
 * Note: For missing data, this function uses ARROW_EMPTY_STRING_PLACEHOLDER.
 * This is required for Arrow type inference - empty arrays cause schema inference failures.
 */
function serializeImportedSymbols(importedSymbols?: Record<string, string[]>): {
  paths: string[];
  names: string[];
} {
  if (!importedSymbols || Object.keys(importedSymbols).length === 0) {
    return { paths: ARROW_EMPTY_STRING_PLACEHOLDER, names: ARROW_EMPTY_STRING_PLACEHOLDER };
  }
  const entries = Object.entries(importedSymbols);
  return {
    paths: entries.map(([path]) => path),
    names: entries.map(([, symbols]) => JSON.stringify(symbols)),
  };
}

/**
 * Arrow type inference placeholder for empty number arrays.
 * Used to prevent schema inference failures when no data is present.
 * Filtered out during deserialization via hasValidNumberEntries().
 */
const ARROW_EMPTY_NUMBER_PLACEHOLDER = [0];

/**
 * Serialize callSites into parallel arrays for Arrow storage.
 *
 * Note: Uses ARROW_EMPTY_STRING_PLACEHOLDER and ARROW_EMPTY_NUMBER_PLACEHOLDER
 * for missing data. This is required for Arrow type inference - empty arrays cause
 * schema inference failures.
 */
function serializeCallSites(callSites?: Array<{ symbol: string; line: number }>): {
  symbols: string[];
  lines: number[];
} {
  if (!callSites || callSites.length === 0) {
    return { symbols: ARROW_EMPTY_STRING_PLACEHOLDER, lines: ARROW_EMPTY_NUMBER_PLACEHOLDER };
  }
  return {
    symbols: callSites.map(c => c.symbol),
    lines: callSites.map(c => c.line),
  };
}

/**
 * Transform a chunk's data into a database record.
 * Serializes complex metadata fields and handles missing/empty data by providing
 * placeholder values for Arrow type inference.
 */
function transformChunkToRecord(
  vector: Float32Array,
  content: string,
  metadata: ChunkMetadata,
): DatabaseRecord {
  const importedSymbolsSerialized = serializeImportedSymbols(metadata.importedSymbols);
  const callSitesSerialized = serializeCallSites(metadata.callSites);

  return {
    vector: Array.from(vector),
    content,
    file: metadata.file,
    startLine: metadata.startLine,
    endLine: metadata.endLine,
    type: metadata.type,
    language: metadata.language,
    // Ensure arrays have at least empty string for Arrow type inference
    functionNames: getNonEmptyArray(metadata.symbols?.functions),
    classNames: getNonEmptyArray(metadata.symbols?.classes),
    interfaceNames: getNonEmptyArray(metadata.symbols?.interfaces),
    // AST-derived metadata (v0.13.0)
    symbolName: metadata.symbolName || '',
    symbolType: metadata.symbolType || '',
    parentClass: metadata.parentClass || '',
    complexity: metadata.complexity || 0,
    cognitiveComplexity: metadata.cognitiveComplexity || 0,
    parameters: getNonEmptyArray(metadata.parameters),
    signature: metadata.signature || '',
    imports: getNonEmptyArray(metadata.imports),
    // Halstead metrics (v0.19.0)
    halsteadVolume: metadata.halsteadVolume || 0,
    halsteadDifficulty: metadata.halsteadDifficulty || 0,
    halsteadEffort: metadata.halsteadEffort || 0,
    halsteadBugs: metadata.halsteadBugs || 0,
    // Symbol-level dependency tracking (v0.23.0)
    exports: getNonEmptyArray(metadata.exports),
    importedSymbolPaths: importedSymbolsSerialized.paths,
    importedSymbolNames: importedSymbolsSerialized.names,
    callSiteSymbols: callSitesSerialized.symbols,
    callSiteLines: callSitesSerialized.lines,
  };
}

/**
 * Returns the array if non-empty, otherwise returns [''] for Arrow type inference
 */
function getNonEmptyArray(arr: string[] | undefined): string[] {
  return arr && arr.length > 0 ? arr : [''];
}

/**
 * Split a batch in half for retry logic
 */
function splitBatchInHalf(batch: BatchToProcess): [BatchToProcess, BatchToProcess] {
  const half = Math.floor(batch.vectors.length / 2);
  return [
    {
      vectors: batch.vectors.slice(0, half),
      metadatas: batch.metadatas.slice(0, half),
      contents: batch.contents.slice(0, half),
    },
    {
      vectors: batch.vectors.slice(half),
      metadatas: batch.metadatas.slice(half),
      contents: batch.contents.slice(half),
    },
  ];
}

/**
 * Transform all chunks in a batch to database records
 */
function transformBatchToRecords(batch: BatchToProcess): DatabaseRecord[] {
  return batch.vectors.map((vector, i) =>
    transformChunkToRecord(vector, batch.contents[i], batch.metadatas[i]),
  );
}

/**
 * Validate batch insert inputs.
 * @throws {DatabaseError} If validation fails
 */
function validateBatchInputs(
  db: LanceDBConnection | null,
  vectors: Float32Array[],
  metadatas: ChunkMetadata[],
  contents: string[],
): asserts db is LanceDBConnection {
  if (!db) {
    throw new DatabaseError('Vector database not initialized');
  }

  if (vectors.length !== metadatas.length || vectors.length !== contents.length) {
    throw new DatabaseError('Vectors, metadatas, and contents arrays must have the same length', {
      vectorsLength: vectors.length,
      metadatasLength: metadatas.length,
      contentsLength: contents.length,
    });
  }
}

/**
 * Chunk arrays into batches of specified size.
 * Returns array of [vectors, metadatas, contents] tuples for each batch.
 */
function chunkIntoBatches(
  vectors: Float32Array[],
  metadatas: ChunkMetadata[],
  contents: string[],
  batchSize: number,
): Array<[Float32Array[], ChunkMetadata[], string[]]> {
  if (vectors.length <= batchSize) {
    return [[vectors, metadatas, contents]];
  }

  const batches: Array<[Float32Array[], ChunkMetadata[], string[]]> = [];
  for (let i = 0; i < vectors.length; i += batchSize) {
    const end = Math.min(i + batchSize, vectors.length);
    batches.push([vectors.slice(i, end), metadatas.slice(i, end), contents.slice(i, end)]);
  }
  return batches;
}

/**
 * Insert a batch of vectors into the database
 *
 * @returns The table instance after insertion, or null only when:
 *          - vectors.length === 0 AND table === null (no-op case)
 *          For non-empty batches, always returns a valid table or throws.
 * @throws {DatabaseError} If database not initialized or insertion fails
 */
export async function insertBatch(
  db: LanceDBConnection | null,
  table: LanceDBTable | null,
  tableName: string,
  vectors: Float32Array[],
  metadatas: ChunkMetadata[],
  contents: string[],
): Promise<LanceDBTable | null> {
  validateBatchInputs(db, vectors, metadatas, contents);

  // Handle empty batch gracefully - return table as-is (could be null)
  if (vectors.length === 0) {
    return table;
  }

  // Process batches
  const batches = chunkIntoBatches(vectors, metadatas, contents, VECTOR_DB_MAX_BATCH_SIZE);

  let currentTable = table;
  for (const [batchVectors, batchMetadatas, batchContents] of batches) {
    currentTable = await insertBatchInternal(
      db,
      currentTable,
      tableName,
      batchVectors,
      batchMetadatas,
      batchContents,
    );
  }

  if (!currentTable) {
    throw new DatabaseError('Failed to create table during batch insert');
  }
  return currentTable;
}

/**
 * Internal method to insert a single batch with iterative retry logic.
 * Uses a queue-based approach to handle batch splitting on failure.
 *
 * @returns Always returns a valid LanceDBTable or throws DatabaseError
 */
async function insertBatchInternal(
  db: LanceDBConnection,
  table: LanceDBTable | null,
  tableName: string,
  vectors: Float32Array[],
  metadatas: ChunkMetadata[],
  contents: string[],
): Promise<LanceDBTable> {
  const queue: BatchToProcess[] = [{ vectors, metadatas, contents }];
  const failedBatches: BatchToProcess[] = [];
  let currentTable = table;
  let lastError: Error | undefined;

  while (queue.length > 0) {
    const batch = queue.shift()!;
    const insertResult = await tryInsertBatch(db, currentTable, tableName, batch);

    if (insertResult.success) {
      currentTable = insertResult.table;
    } else {
      lastError = insertResult.error;
      handleBatchFailure(batch, queue, failedBatches);
    }
  }

  throwIfBatchesFailed(failedBatches, lastError);

  if (!currentTable) {
    throw new DatabaseError('Failed to create table during batch insert');
  }

  return currentTable;
}

/**
 * Result of attempting to insert a batch
 */
interface InsertResult {
  success: boolean;
  table: LanceDBTable | null;
  error?: Error;
}

/**
 * Attempt to insert a batch of records into the database.
 * Errors are captured and returned (not thrown) to support retry logic.
 */
async function tryInsertBatch(
  db: LanceDBConnection,
  currentTable: LanceDBTable | null,
  tableName: string,
  batch: BatchToProcess,
): Promise<InsertResult> {
  try {
    const records = transformBatchToRecords(batch);

    if (!currentTable) {
      // LanceDB's createTable/add accept Record<string, unknown>[] — DatabaseRecord
      // satisfies this shape but TypeScript can't verify it structurally, so we cast once.
      const newTable = await db.createTable(
        tableName,
        records as unknown as Record<string, unknown>[],
      );
      return { success: true, table: newTable };
    } else {
      await currentTable.add(records as unknown as Record<string, unknown>[]);
      return { success: true, table: currentTable };
    }
  } catch (error) {
    // Error is captured for retry logic - will be included in final error if all retries fail
    return { success: false, table: currentTable, error: error as Error };
  }
}

/**
 * Handle a failed batch insertion by either splitting and retrying or marking as failed
 */
function handleBatchFailure(
  batch: BatchToProcess,
  queue: BatchToProcess[],
  failedBatches: BatchToProcess[],
): void {
  if (batch.vectors.length > VECTOR_DB_MIN_BATCH_SIZE) {
    // Split and retry
    const [firstHalf, secondHalf] = splitBatchInHalf(batch);
    queue.push(firstHalf, secondHalf);
  } else {
    // Can't split further, mark as failed
    failedBatches.push(batch);
  }
}

/**
 * Throw an error if any batches failed after all retry attempts.
 * Includes the last error encountered for debugging.
 */
function throwIfBatchesFailed(failedBatches: BatchToProcess[], lastError?: Error): void {
  if (failedBatches.length === 0) return;

  const totalFailed = failedBatches.reduce((sum, batch) => sum + batch.vectors.length, 0);
  throw new DatabaseError(`Failed to insert ${totalFailed} record(s) after retry attempts`, {
    failedBatches: failedBatches.length,
    totalRecords: totalFailed,
    sampleFile: failedBatches[0].metadatas[0].file,
    lastError: lastError?.message,
  });
}

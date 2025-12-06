import { ChunkMetadata } from '../indexer/types.js';
import { DatabaseError } from '../errors/index.js';
import { VECTOR_DB_MAX_BATCH_SIZE, VECTOR_DB_MIN_BATCH_SIZE } from '../constants.js';

// TODO: Replace with proper types from lancedb-types.ts
// Currently using 'any' because tests use incomplete mocks that don't satisfy full LanceDB interface
// Proper types: Awaited<ReturnType<typeof lancedb.connect>> and Awaited<ReturnType<Connection['openTable']>>
type LanceDBConnection = any;
type LanceDBTable = any;

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
  parameters: string[];
  signature: string;
  imports: string[];
}

/**
 * Transform a chunk's data into a database record.
 * Handles missing/empty metadata by providing defaults for Arrow type inference.
 */
function transformChunkToRecord(
  vector: Float32Array,
  content: string,
  metadata: ChunkMetadata
): DatabaseRecord {
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
    parameters: getNonEmptyArray(metadata.parameters),
    signature: metadata.signature || '',
    imports: getNonEmptyArray(metadata.imports),
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
    transformChunkToRecord(vector, batch.contents[i], batch.metadatas[i])
  );
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
  db: LanceDBConnection,
  table: LanceDBTable | null,
  tableName: string,
  vectors: Float32Array[],
  metadatas: ChunkMetadata[],
  contents: string[]
): Promise<LanceDBTable | null> {
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
  
  // Handle empty batch gracefully - return table as-is (could be null)
  if (vectors.length === 0) {
    return table;
  }
  
  // Split large batches into smaller chunks
  if (vectors.length > VECTOR_DB_MAX_BATCH_SIZE) {
    let currentTable = table;
    for (let i = 0; i < vectors.length; i += VECTOR_DB_MAX_BATCH_SIZE) {
      const batchVectors = vectors.slice(i, Math.min(i + VECTOR_DB_MAX_BATCH_SIZE, vectors.length));
      const batchMetadata = metadatas.slice(i, Math.min(i + VECTOR_DB_MAX_BATCH_SIZE, vectors.length));
      const batchContents = contents.slice(i, Math.min(i + VECTOR_DB_MAX_BATCH_SIZE, vectors.length));
      
      currentTable = await insertBatchInternal(db, currentTable, tableName, batchVectors, batchMetadata, batchContents);
    }
    if (!currentTable) {
      throw new DatabaseError('Failed to create table during batch insert');
    }
    return currentTable;
  } else {
    return insertBatchInternal(db, table, tableName, vectors, metadatas, contents);
  }
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
  contents: string[]
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
  batch: BatchToProcess
): Promise<InsertResult> {
  try {
    const records = transformBatchToRecords(batch);
    
    if (!currentTable) {
      const newTable = await db.createTable(tableName, records);
      return { success: true, table: newTable };
    } else {
      await currentTable.add(records);
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
  failedBatches: BatchToProcess[]
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
  throw new DatabaseError(
    `Failed to insert ${totalFailed} record(s) after retry attempts`,
    {
      failedBatches: failedBatches.length,
      totalRecords: totalFailed,
      sampleFile: failedBatches[0].metadatas[0].file,
      lastError: lastError?.message,
    }
  );
}


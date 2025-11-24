import { ChunkMetadata } from '../indexer/types.js';
import { DatabaseError } from '../errors/index.js';
import { VECTOR_DB_MAX_BATCH_SIZE, VECTOR_DB_MIN_BATCH_SIZE } from '../constants.js';

type LanceDBConnection = any;
type LanceDBTable = any;

/**
 * Insert a batch of vectors into the database
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
 */
async function insertBatchInternal(
  db: LanceDBConnection,
  table: LanceDBTable | null,
  tableName: string,
  vectors: Float32Array[],
  metadatas: ChunkMetadata[],
  contents: string[]
): Promise<LanceDBTable | null> {
  interface BatchToProcess {
    vectors: Float32Array[];
    metadatas: ChunkMetadata[];
    contents: string[];
  }
  
  const queue: BatchToProcess[] = [{ vectors, metadatas, contents }];
  const failedRecords: BatchToProcess[] = [];
  let currentTable = table;
  
  // Process batches iteratively
  while (queue.length > 0) {
    const batch = queue.shift();
    if (!batch) break; // Should never happen due to while condition, but satisfies type checker
    
    try {
      const records = batch.vectors.map((vector, i) => ({
        vector: Array.from(vector),
        content: batch.contents[i],
        file: batch.metadatas[i].file,
        startLine: batch.metadatas[i].startLine,
        endLine: batch.metadatas[i].endLine,
        type: batch.metadatas[i].type,
        language: batch.metadatas[i].language,
        // Ensure arrays have at least empty string for Arrow type inference
        functionNames: (batch.metadatas[i].symbols?.functions && batch.metadatas[i].symbols.functions.length > 0) ? batch.metadatas[i].symbols.functions : [''],
        classNames: (batch.metadatas[i].symbols?.classes && batch.metadatas[i].symbols.classes.length > 0) ? batch.metadatas[i].symbols.classes : [''],
        interfaceNames: (batch.metadatas[i].symbols?.interfaces && batch.metadatas[i].symbols.interfaces.length > 0) ? batch.metadatas[i].symbols.interfaces : [''],
        // AST-derived metadata (v0.13.0)
        symbolName: batch.metadatas[i].symbolName || '',
        symbolType: batch.metadatas[i].symbolType || '',
        parentClass: batch.metadatas[i].parentClass || '',
        complexity: batch.metadatas[i].complexity || 0,
        parameters: (batch.metadatas[i].parameters && batch.metadatas[i].parameters.length > 0) ? batch.metadatas[i].parameters : [''],
        signature: batch.metadatas[i].signature || '',
        imports: (batch.metadatas[i].imports && batch.metadatas[i].imports.length > 0) ? batch.metadatas[i].imports : [''],
      }));
      
      // Create table if it doesn't exist, otherwise add to existing table
      if (!currentTable) {
        currentTable = await db.createTable(tableName, records);
      } else {
        await currentTable.add(records);
      }
    } catch (error) {
      // If batch has more than min size records, split and retry
      if (batch.vectors.length > VECTOR_DB_MIN_BATCH_SIZE) {
        const half = Math.floor(batch.vectors.length / 2);
        
        // Split in half and add back to queue
        queue.push({
          vectors: batch.vectors.slice(0, half),
          metadatas: batch.metadatas.slice(0, half),
          contents: batch.contents.slice(0, half),
        });
        queue.push({
          vectors: batch.vectors.slice(half),
          metadatas: batch.metadatas.slice(half),
          contents: batch.contents.slice(half),
        });
      } else {
        // Small batch failed - collect for final error report
        failedRecords.push(batch);
      }
    }
  }
  
  // If any small batches failed, throw error with details
  if (failedRecords.length > 0) {
    const totalFailed = failedRecords.reduce((sum, batch) => sum + batch.vectors.length, 0);
    throw new DatabaseError(
      `Failed to insert ${totalFailed} record(s) after retry attempts`,
      {
        failedBatches: failedRecords.length,
        totalRecords: totalFailed,
        sampleFile: failedRecords[0].metadatas[0].file,
      }
    );
  }
  
  if (!currentTable) {
    throw new DatabaseError('Failed to create table during batch insert');
  }
  return currentTable;
}


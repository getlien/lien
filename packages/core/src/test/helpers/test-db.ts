import { SqliteBackend } from '../../vectordb/sqlite/sqlite-backend.js';
import { openDatabase, STORE_META, STRUCTURAL_DB_FILENAME } from '../../vectordb/sqlite/schema.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Creates a temporary test directory for database operations
 */
export async function createTestDir(): Promise<string> {
  const tmpBase = path.join(os.tmpdir(), 'lien-test');
  await fs.mkdir(tmpBase, { recursive: true });

  const testDir = path.join(
    tmpBase,
    `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  );
  await fs.mkdir(testDir, { recursive: true });

  return testDir;
}

/**
 * Cleans up a test directory
 */
export async function cleanupTestDir(testDir: string): Promise<void> {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
    console.warn(`Failed to cleanup test directory ${testDir}:`, error);
  }
}

/**
 * Creates a SqliteBackend instance for testing with automatic cleanup.
 * Name kept as createTestVectorDB for the large test fan-out that imports it.
 */
export async function createTestVectorDB(): Promise<{
  db: SqliteBackend;
  cleanup: () => Promise<void>;
}> {
  const testDir = await createTestDir();
  const db = new SqliteBackend(testDir);
  await db.initialize();

  const cleanup = async () => {
    db.close();
    await cleanupTestDir(testDir);
  };

  return { db, cleanup };
}

/**
 * Rewind an already-built index to the state of one written BEFORE
 * reverse-dependency counts were tracked (#1071's `dependent_counts` table and
 * #1072's `dependentCountsComputed` flag): chunks intact, counts absent.
 *
 * That state is not otherwise reachable from a test — the current indexer always
 * writes both — and it is the one whole-index state where every
 * `dependentCount` reads 0 for a reason that has nothing to do with the code, so
 * `search_code` must report it rather than assert the zeros. Lives here rather
 * than in the consuming package so the SQL stays next to the schema it depends
 * on, and so no test package needs its own `better-sqlite3` dependency.
 *
 * `indexDir` is the backend's `dbPath` (`getIndexDir(projectRoot)`).
 */
export function simulatePreCountTrackingIndex(indexDir: string): void {
  const db = openDatabase(path.join(indexDir, STRUCTURAL_DB_FILENAME));
  try {
    db.exec('DELETE FROM dependent_counts');
    db.prepare('DELETE FROM store_meta WHERE k = ?').run(STORE_META.DEPENDENT_COUNTS_COMPUTED);
  } finally {
    db.close();
  }
}

/**
 * Creates a test file in a directory
 */
export async function createTestFile(
  dir: string,
  filename: string,
  content: string,
): Promise<string> {
  const filepath = path.join(dir, filename);
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, content, 'utf-8');
  return filepath;
}

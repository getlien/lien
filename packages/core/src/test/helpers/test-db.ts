import { SqliteBackend } from '../../vectordb/sqlite/sqlite-backend.js';
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { indexMultipleFiles } from './incremental.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { MockEmbeddings } from '../test/helpers/mock-embeddings.js';
import { createTestDir, cleanupTestDir } from '../test/helpers/test-db.js';

const execFileAsync = promisify(execFile);

async function git(repoDir: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: repoDir });
}

describe('incremental indexing across git branch switch', () => {
  let repoDir: string;
  let indexPath: string;
  let vectorDB: VectorDB;
  let embeddings: MockEmbeddings;

  beforeEach(async () => {
    repoDir = await createTestDir();
    indexPath = path.join(repoDir, '.lien');
    await fs.mkdir(indexPath, { recursive: true });

    await git(repoDir, 'init', '-q', '-b', 'main');
    await git(repoDir, 'config', 'user.email', 'test@lien.dev');
    await git(repoDir, 'config', 'user.name', 'Lien Test');
    await git(repoDir, 'config', 'commit.gpgsign', 'false');

    embeddings = new MockEmbeddings();
    vectorDB = new VectorDB(indexPath);
    await vectorDB.initialize();
    await embeddings.initialize();
  });

  afterEach(async () => {
    await cleanupTestDir(repoDir);
  });

  it('drops chunks for a file deleted on the new branch', async () => {
    // Arrange: commit a file on main and index it.
    const fooDir = path.join(repoDir, 'foo');
    await fs.mkdir(fooDir, { recursive: true });
    const fooPath = path.join(fooDir, 'bar.py');
    await fs.writeFile(fooPath, 'def quux():\n    return 42\n');
    await git(repoDir, 'add', '.');
    await git(repoDir, 'commit', '-q', '-m', 'add foo/bar.py');

    await indexMultipleFiles([fooPath], vectorDB, embeddings, { rootDir: repoDir });

    const before = await vectorDB.scanWithFilter({ file: 'foo/bar.py' });
    expect(before.length).toBeGreaterThan(0);

    // Act: branch off, delete the file, commit, and reindex via the deleted path.
    await git(repoDir, 'checkout', '-q', '-b', 'feature');
    await fs.unlink(fooPath);
    await git(repoDir, 'add', '-A');
    await git(repoDir, 'commit', '-q', '-m', 'remove foo/bar.py');

    await indexMultipleFiles([fooPath], vectorDB, embeddings, { rootDir: repoDir });

    // Assert: no chunks remain for the deleted file.
    const after = await vectorDB.scanWithFilter({ file: 'foo/bar.py' });
    expect(after).toEqual([]);
  });
});

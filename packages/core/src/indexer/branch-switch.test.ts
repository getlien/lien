import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { indexMultipleFiles } from './incremental.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { GitStateTracker } from '../git/tracker.js';
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

  it('indexes a file passed as a path relative to rootDir', async () => {
    // Regression for the Lien Review finding: fs ops in the indexer used the
    // raw filepath, so a relative path against a non-cwd rootDir failed silently.
    const fooDir = path.join(repoDir, 'foo');
    await fs.mkdir(fooDir, { recursive: true });
    await fs.writeFile(path.join(fooDir, 'bar.py'), 'def quux():\n    return 42\n');

    // Pass the path RELATIVE TO rootDir, not absolute. Process cwd is the lien
    // package dir at test time, so this is the precise scenario the fix covers.
    await indexMultipleFiles(['foo/bar.py'], vectorDB, embeddings, { rootDir: repoDir });

    const chunks = await vectorDB.scanWithFilter({ file: 'foo/bar.py' });
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('reconciles chunks via the GitStateTracker pipeline when switching to a branch without the file', async () => {
    // This is the user-reported scenario: file exists on `feature`, doesn't on `main`.
    // Switching feature → main must drop chunks for the file.
    //
    // Bypassing GitStateTracker (as the v1 test did) misses the production bug:
    // `git diff --name-only feature...main` is empty because `main` added nothing
    // relative to merge base, so the change handler never even sees `foo/bar.py`.

    // .lien/ holds the GitStateTracker's state file; mirror what real users do
    // by gitignoring it so subsequent `git checkout` ops aren't blocked.
    await fs.writeFile(path.join(repoDir, '.gitignore'), '.lien/\n');
    await git(repoDir, 'add', '.gitignore');
    await git(repoDir, 'commit', '-q', '-m', 'initial');

    const tracker = new GitStateTracker(repoDir, indexPath);
    await tracker.initialize();

    // Create feature, add foo/bar.py, commit.
    await git(repoDir, 'checkout', '-q', '-b', 'feature');
    const fooDir = path.join(repoDir, 'foo');
    await fs.mkdir(fooDir, { recursive: true });
    const fooPath = path.join(fooDir, 'bar.py');
    await fs.writeFile(fooPath, 'def quux():\n    return 42\n');
    await git(repoDir, 'add', '.');
    await git(repoDir, 'commit', '-q', '-m', 'add foo/bar.py on feature');

    // Simulate the watcher firing — detectChanges → indexMultipleFiles.
    const changedOntoFeature = await tracker.detectChanges();
    expect(changedOntoFeature).toBeTruthy();
    await indexMultipleFiles(changedOntoFeature!, vectorDB, embeddings, { rootDir: repoDir });

    const onFeature = await vectorDB.scanWithFilter({ file: 'foo/bar.py' });
    expect(onFeature.length).toBeGreaterThan(0);

    // Switch back to main. foo/bar.py vanishes from the working tree.
    await git(repoDir, 'checkout', '-q', 'main');

    const changedBackToMain = await tracker.detectChanges();
    await indexMultipleFiles(changedBackToMain ?? [], vectorDB, embeddings, { rootDir: repoDir });

    // Assert: no chunks remain for foo/bar.py on main.
    const onMain = await vectorDB.scanWithFilter({ file: 'foo/bar.py' });
    expect(onMain).toEqual([]);
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

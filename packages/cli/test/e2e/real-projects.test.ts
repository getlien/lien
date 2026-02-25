import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { VectorDB, LocalEmbeddings } from '@liendev/core';

/**
 * E2E Tests with Real Open Source Projects
 *
 * These tests validate that Lien works correctly on real-world codebases
 * by cloning popular open source projects and indexing them.
 *
 * **Running these tests:**
 * - Locally: `npm run test:e2e`
 * - CI: Runs automatically on push to main
 * - Individual language: `npm test -- real-projects.test.ts -t "Python"`
 *
 * **Why these projects:**
 * - Flask (Python): Popular web framework, well-structured, moderate size
 * - Zod (TypeScript): Schema validation library, clean codebase, modern TS
 * - Express (JavaScript): Most popular Node.js framework
 * - Monolog (PHP): Logging library, standard PHP patterns
 *
 * **Test strategy:**
 * 1. Clone project to /tmp/lien-e2e-tests/ (shallow clone for speed)
 * 2. Initialize Lien
 * 3. Index the project
 * 4. Validate results:
 *    - Files indexed > 0
 *    - Chunks created > files (AST chunking working)
 *    - No indexing errors
 *    - AST metadata present
 *    - Search works
 * 5. Cleanup temp directory (always, even on failure/interrupt)
 *
 * **Cleanup guarantees:**
 * - afterAll() hook cleans up after tests complete
 * - Process signal handlers (SIGINT/SIGTERM) clean up on Ctrl+C or kill
 * - Only /tmp/lien-e2e-tests/ is used (predictable location, easy to find)
 * - Cleanup runs even if tests fail or are interrupted
 */

const E2E_TIMEOUT = 180000; // 3 minutes per test (cloning + indexing + embeddings)

interface ProjectConfig {
  name: string;
  repo: string;
  branch: string;
  language: string;
  expectedMinFiles: number; // Minimum files to index
  expectedMinChunks: number; // Minimum chunks to create
  sampleSearchQuery: string; // Query that should find results
}

/**
 * Test projects for each supported language
 */
const TEST_PROJECTS: ProjectConfig[] = [
  {
    name: 'Requests',
    repo: 'https://github.com/psf/requests.git',
    branch: 'main',
    language: 'python',
    expectedMinFiles: 10, // Requests has clean structure with requests/*.py
    expectedMinChunks: 50, // Conservative estimate
    sampleSearchQuery: 'make http request',
  },
  {
    name: 'Zod',
    repo: 'https://github.com/colinhacks/zod.git',
    branch: 'main',
    language: 'typescript',
    expectedMinFiles: 30,
    expectedMinChunks: 100,
    sampleSearchQuery: 'validate schema',
  },
  {
    name: 'Express',
    repo: 'https://github.com/expressjs/express.git',
    branch: 'master',
    language: 'javascript',
    expectedMinFiles: 20,
    expectedMinChunks: 80,
    sampleSearchQuery: 'handle http request',
  },
  {
    name: 'Monolog',
    repo: 'https://github.com/Seldaek/monolog.git',
    branch: 'main',
    language: 'php',
    expectedMinFiles: 30,
    expectedMinChunks: 100,
    sampleSearchQuery: 'log message handler',
  },
  {
    name: 'Anyhow',
    repo: 'https://github.com/dtolnay/anyhow.git',
    branch: 'master',
    language: 'rust',
    expectedMinFiles: 5,
    expectedMinChunks: 15,
    sampleSearchQuery: 'error handling context',
  },
  {
    name: 'Chi',
    repo: 'https://github.com/go-chi/chi.git',
    branch: 'master',
    language: 'go',
    expectedMinFiles: 5,
    expectedMinChunks: 20,
    sampleSearchQuery: 'http router middleware',
  },
  {
    name: 'JavaPoet',
    repo: 'https://github.com/square/javapoet.git',
    branch: 'master',
    language: 'java',
    expectedMinFiles: 10,
    expectedMinChunks: 100,
    sampleSearchQuery: 'generate java source code',
  },
];

/**
 * Helper to execute CLI commands
 */
function runLienCommand(cwd: string, command: string): string {
  const lienCli = path.join(__dirname, '../../dist/index.js');
  try {
    return execSync(`node ${lienCli} ${command} 2>&1`, {
      cwd,
      encoding: 'utf-8',
    });
  } catch (error) {
    // Command failed, but we still want to see the output
    if (error instanceof Error && 'stdout' in error) {
      console.error(`Command failed: ${command}`);
      console.error(`Output: ${(error as any).stdout}`);
      return (error as any).stdout || '';
    }
    throw error;
  }
}

/**
 * Helper to get the actual index location (same logic as VectorDB)
 */
function getIndexPath(projectDir: string): string {
  // Resolve to real path (e.g. /tmp -> /private/tmp on macOS)
  // This matches what process.cwd() returns when Lien runs
  const realPath = fsSync.realpathSync(projectDir);
  const projectName = path.basename(realPath);
  const pathHash = crypto.createHash('md5').update(realPath).digest('hex').substring(0, 8);

  return path.join(os.homedir(), '.lien', 'indices', `${projectName}-${pathHash}`);
}

/**
 * Helper to get index statistics from the manifest
 */
function getIndexStats(projectDir: string): { files: number; chunks: number } {
  try {
    // Get the actual index location (Lien stores in ~/.lien/indices/)
    const indexPath = getIndexPath(projectDir);
    const manifestPath = path.join(indexPath, 'manifest.json');
    const manifestContent = fsSync.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);

    // Manifest.files is an object/dictionary, not an array
    const filesObject = manifest.files || {};
    const fileEntries = Object.values(filesObject);

    const files = fileEntries.length;
    const chunks = fileEntries.reduce(
      (total: number, file: any) => total + (file.chunkCount || 0),
      0,
    );

    return { files, chunks };
  } catch (error) {
    // Fallback: try to parse from index output if manifest isn't available yet
    console.warn('Could not read manifest, returning 0:', error);
    return { files: 0, chunks: 0 };
  }
}

/**
 * Helper to validate AST metadata in index
 */
async function validateASTMetadata(projectDir: string): Promise<boolean> {
  // Check that manifest exists and has AST metadata
  const indexPath = getIndexPath(projectDir);
  const manifestPath = path.join(indexPath, 'manifest.json');

  try {
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);

    // Manifest.files is an object/dictionary, check if any file has chunks with AST metadata
    // We don't have chunk details in the manifest, so we just verify files exist
    // The real validation is that chunks > files (which proves AST chunking worked)
    const filesObject = manifest.files || {};
    const fileEntries = Object.values(filesObject);

    // If we have files and multiple chunks, AST metadata is working
    const totalChunks = fileEntries.reduce(
      (total: number, file: any) => total + (file.chunkCount || 0),
      0,
    );

    // AST chunking should create more chunks than files (functions/methods extracted)
    return totalChunks > fileEntries.length;
  } catch {
    return false;
  }
}

/**
 * Module-level state for test cleanup
 * Placed at module scope to ensure proper cleanup even with parallel test execution
 */
const testDirs: string[] = [];

/**
 * Cleanup function that removes all test directories
 */
async function cleanup() {
  for (const dir of testDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up: ${dir}`);
    } catch (error) {
      console.warn(`Failed to cleanup ${dir}:`, error);
    }
  }
}

/**
 * Register signal handlers at module scope for proper cleanup
 * This ensures cleanup even if tests are interrupted (Ctrl+C, kill, etc.)
 * Only enabled in local dev (not CI where process management differs)
 *
 * Uses process.on() instead of process.once() to handle multiple signals
 * (e.g., impatient users pressing Ctrl+C multiple times)
 */
let cleanupInProgress = false;

if (!process.env.CI) {
  const exitHandler = async (signal: string) => {
    if (cleanupInProgress) {
      // Already cleaning up, force exit on second signal
      console.log(`\nReceived ${signal} again, forcing exit...`);
      process.exit(1);
    }

    cleanupInProgress = true;
    console.log(`\n\nReceived ${signal}, cleaning up test directories...`);
    await cleanup();
    process.exit(0);
  };

  process.on('SIGINT', () => exitHandler('SIGINT'));
  process.on('SIGTERM', () => exitHandler('SIGTERM'));
}

describe('E2E: Real Open Source Projects', () => {
  let embeddings: LocalEmbeddings;

  // Initialize embeddings once for all projects (expensive operation)
  beforeAll(async () => {
    embeddings = new LocalEmbeddings();
    await embeddings.initialize();
  }, E2E_TIMEOUT);

  // Cleanup after all tests complete
  afterAll(async () => {
    await cleanup();
  });

  // Create a test for each project
  TEST_PROJECTS.forEach(project => {
    describe(`${project.name} (${project.language})`, () => {
      let projectDir: string;

      beforeAll(async () => {
        // Create temp directory using OS temp dir for cross-platform compatibility
        // Linux/macOS: /tmp/lien-e2e-tests or /var/folders/.../lien-e2e-tests
        // Windows: C:\Users\<user>\AppData\Local\Temp\lien-e2e-tests
        const tempBase = path.join(os.tmpdir(), 'lien-e2e-tests');
        await fs.mkdir(tempBase, { recursive: true });
        projectDir = path.join(tempBase, `${project.name.toLowerCase()}-${Date.now()}`);
        testDirs.push(projectDir);

        console.log(`\n📦 Cloning ${project.name} to ${projectDir}...`);

        // Shallow clone for speed (depth=1)
        execSync(`git clone --depth 1 --branch ${project.branch} ${project.repo} ${projectDir}`, {
          stdio: 'pipe',
        });

        console.log(`✓ Cloned ${project.name}`);
      }, E2E_TIMEOUT);

      it('should have cloned project files', () => {
        // Verify project was cloned successfully
        const files = fsSync.readdirSync(projectDir);
        expect(files.length).toBeGreaterThan(0);

        console.log(`📁 ${project.name} structure:`, files.slice(0, 10).join(', '));
      });

      it(
        'should initialize Lien successfully',
        async () => {
          const output = runLienCommand(projectDir, 'init --editor cursor');

          // init creates .cursor/mcp.json with lien MCP server entry
          expect(output).toContain('.cursor/mcp.json');

          // Verify .cursor/mcp.json was created with lien entry
          const mcpConfigPath = path.join(projectDir, '.cursor', 'mcp.json');
          const mcpConfig = JSON.parse(await fs.readFile(mcpConfigPath, 'utf-8'));
          expect(mcpConfig.mcpServers?.lien).toBeDefined();
        },
        E2E_TIMEOUT,
      );

      it(
        'should index the project without errors',
        () => {
          console.log(`\n🔍 Indexing ${project.name}...`);

          const output = runLienCommand(projectDir, 'index');
          console.log(`Index output:\n${output.substring(0, 500)}`);

          // Should complete successfully (check for success indicators)
          const hasSuccess =
            output.includes('Indexed') || output.includes('✔') || output.includes('Manifest saved');
          expect(hasSuccess).toBe(true);

          // Should not have errors
          expect(output.toLowerCase()).not.toContain('error');
          expect(output.toLowerCase()).not.toContain('failed');

          // Verify manifest was created (in ~/.lien/indices/)
          const indexPath = getIndexPath(projectDir);
          const manifestPath = path.join(indexPath, 'manifest.json');
          const manifestExists = fsSync.existsSync(manifestPath);

          if (!manifestExists) {
            console.error(`❌ Manifest not created at: ${manifestPath}`);
            console.error(`Index output was:\n${output}`);
            console.error(`Index path: ${indexPath}`);

            // Check if index directory exists
            if (fsSync.existsSync(indexPath)) {
              const indexFiles = fsSync.readdirSync(indexPath);
              console.error(`Index directory contents:`, indexFiles);
            } else {
              console.error(`Index directory does not exist`);
            }
          }

          expect(manifestExists).toBe(true);

          console.log(`✓ Indexed ${project.name}`);
        },
        E2E_TIMEOUT,
      );

      it('should index minimum expected number of files', async () => {
        const stats = getIndexStats(projectDir);

        console.log(`📊 ${project.name} stats: ${stats.files} files, ${stats.chunks} chunks`);

        // If this fails, the project structure may have changed.
        // Check: ls {projectDir} to see actual structure
        if (stats.files === 0) {
          console.error(`❌ No files indexed for ${project.name}!`);
          console.error(`   Project directory: ${projectDir}`);
          console.error(`   Check project structure and include patterns in config`);

          // Show what files exist
          try {
            const findPyFiles = execSync(`find . -name "*.py" -type f | head -20`, {
              cwd: projectDir,
              encoding: 'utf-8',
            });
            console.error(`   Python files found:\n${findPyFiles}`);
          } catch (e) {
            console.error(`   Could not find Python files`);
          }
        }

        expect(stats.files).toBeGreaterThanOrEqual(project.expectedMinFiles);
      });

      it('should create chunks with AST metadata', () => {
        const stats = getIndexStats(projectDir);

        // AST chunking should create more chunks than files (functions/methods extracted)
        // Unless no files were indexed (in which case we should fail earlier)
        if (stats.files > 0) {
          expect(stats.chunks).toBeGreaterThan(stats.files);
        }
        expect(stats.chunks).toBeGreaterThanOrEqual(project.expectedMinChunks);
      });

      it('should have AST metadata for code chunks', async () => {
        const hasMetadata = await validateASTMetadata(projectDir);

        expect(hasMetadata).toBe(true);
      });

      it('should show status after indexing', () => {
        const output = runLienCommand(projectDir, 'status');

        // Should report index exists
        expect(output).toContain('Exists');

        // Should show index files count
        expect(output).toMatch(/Index files:\s+\d+/);
      });

      it(
        'should analyze complexity without errors',
        () => {
          const output = runLienCommand(projectDir, 'complexity --format json');

          // Extract JSON from output (complexity command may include banner text before JSON)
          const jsonStart = output.indexOf('{');
          expect(jsonStart).toBeGreaterThanOrEqual(0);

          const report = JSON.parse(output.substring(jsonStart));

          expect(report.summary).toBeDefined();
          expect(report.summary.filesAnalyzed).toBeGreaterThan(0);
          expect(typeof report.summary.avgComplexity).toBe('number');

          console.log(
            `🧮 ${project.name} complexity: ${report.summary.filesAnalyzed} files, ` +
              `avg ${report.summary.avgComplexity.toFixed(1)}, ` +
              `${report.summary.totalViolations} violations`,
          );
        },
        E2E_TIMEOUT,
      );

      it(
        'should find symbols via querySymbols',
        async () => {
          const db = await VectorDB.load(fsSync.realpathSync(projectDir));

          // Query for functions — every project should have at least some
          const functions = await db.querySymbols({ symbolType: 'function', limit: 10 });

          console.log(`🔣 ${project.name} symbols: ${functions.length} functions found`);

          expect(functions.length).toBeGreaterThan(0);

          // Every result should have a symbolName and valid symbol type
          for (const r of functions) {
            expect(r.metadata.symbolName).toBeTruthy();
            expect(['function', 'method']).toContain(r.metadata.symbolType);
            expect(r.metadata.file).toBeTruthy();
          }
        },
        E2E_TIMEOUT,
      );

      it(
        'should retrieve chunks for a specific file',
        async () => {
          // Pick a file from the manifest
          const indexPath = getIndexPath(projectDir);
          const manifest = JSON.parse(
            fsSync.readFileSync(path.join(indexPath, 'manifest.json'), 'utf-8'),
          );
          const indexedFiles = Object.keys(manifest.files);
          expect(indexedFiles.length).toBeGreaterThan(0);

          const targetFile = indexedFiles[0];
          const db = await VectorDB.load(fsSync.realpathSync(projectDir));
          const results = await db.scanWithFilter({ file: [targetFile], limit: 50 });

          console.log(
            `📄 ${project.name} file context: ${results.length} chunks for ${targetFile}`,
          );

          expect(results.length).toBeGreaterThan(0);

          // All results should reference the target file
          for (const r of results) {
            expect(r.metadata.file).toBe(targetFile);
            expect(r.content).toBeTruthy();
            expect(r.metadata.startLine).toBeGreaterThanOrEqual(0);
          }
        },
        E2E_TIMEOUT,
      );

      it(
        'should have import/export metadata in chunks',
        async () => {
          const db = await VectorDB.load(fsSync.realpathSync(projectDir));
          const results = await db.scanWithFilter({ limit: 100 });

          // At least some chunks should have imports populated
          const chunksWithImports = results.filter(
            r => r.metadata.imports && r.metadata.imports.length > 0,
          );

          // At least some chunks should have exports populated
          const chunksWithExports = results.filter(
            r => r.metadata.exports && r.metadata.exports.length > 0,
          );

          console.log(
            `📦 ${project.name} metadata: ${chunksWithImports.length}/${results.length} chunks with imports, ` +
              `${chunksWithExports.length}/${results.length} with exports`,
          );

          // Every real-world project has imports
          expect(chunksWithImports.length).toBeGreaterThan(0);
          expect(chunksWithExports.length).toBeGreaterThan(0);
        },
        E2E_TIMEOUT,
      );

      it(
        'should find similar code from an indexed chunk',
        async () => {
          const db = await VectorDB.load(fsSync.realpathSync(projectDir));

          // Get a function chunk to use as the similarity query
          const [sample] = await db.querySymbols({ symbolType: 'function', limit: 1 });
          expect(sample).toBeDefined();

          const vector = await embeddings.embed(sample.content);
          const results = await db.search(vector, 5);

          console.log(
            `🔍 ${project.name} find_similar: ${results.length} results, ` +
              `top score: ${results[0]?.score.toFixed(3)}`,
          );

          expect(results.length).toBeGreaterThan(0);

          // Top result should be the same or very similar chunk
          expect(results[0].metadata.file).toBeTruthy();
          expect(['highly_relevant', 'relevant']).toContain(results[0].relevance);
        },
        E2E_TIMEOUT,
      );

      it(
        'should return relevant results for semantic search',
        async () => {
          const db = await VectorDB.load(fsSync.realpathSync(projectDir));
          const queryVector = await embeddings.embed(project.sampleSearchQuery);
          const results = await db.search(queryVector, 5, project.sampleSearchQuery);

          console.log(
            `🔎 Search "${project.sampleSearchQuery}" returned ${results.length} results`,
          );
          if (results.length > 0) {
            console.log(
              `   Top result: ${results[0].metadata.file} (${results[0].relevance}, score: ${results[0].score.toFixed(3)})`,
            );
          }

          expect(results.length).toBeGreaterThan(0);

          // Top result should be at least loosely related
          expect(['highly_relevant', 'relevant', 'loosely_related']).toContain(
            results[0].relevance,
          );

          // All results should have valid metadata
          for (const result of results) {
            expect(result.metadata.file).toBeTruthy();
            expect(result.content).toBeTruthy();
          }
        },
        E2E_TIMEOUT,
      );

      it(
        'should handle reindexing without errors',
        () => {
          console.log(`\n🔄 Reindexing ${project.name}...`);

          const output = runLienCommand(projectDir, 'index');

          // Check for success (either "Indexed" or "Incremental reindex")
          const hasSuccess =
            output.includes('Indexed') ||
            output.includes('Incremental reindex complete') ||
            output.includes('✔');
          expect(hasSuccess).toBe(true);
          expect(output.toLowerCase()).not.toContain('error');

          // Stats should be similar to first index
          const stats = getIndexStats(projectDir);
          expect(stats.files).toBeGreaterThanOrEqual(project.expectedMinFiles);
        },
        E2E_TIMEOUT,
      );
    });
  });
});

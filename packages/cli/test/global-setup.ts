import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Vitest globalSetup: redirect Lien's global store for the whole test run.
 *
 * Every code path that resolves `~/.lien/` (VectorDB indices, global config,
 * `lien path --store`) goes through `getLienHome()` in `@liendev/parser`,
 * which honors the `LIEN_HOME` environment variable. Setting it once here —
 * before any test file or worker starts — means no individual test needs to
 * remember to isolate or clean up its index directory: everything created
 * during this run (including CLI subprocesses spawned by the e2e suite,
 * which inherit `process.env`) lands under one throwaway temp dir that gets
 * deleted in teardown.
 *
 * This also covers `test/e2e/real-projects.test.ts` and
 * `test/benchmarks/performance.test.ts`, which shell out to the built CLI —
 * the child process inherits `LIEN_HOME` from this process's environment.
 */
export default async function setup() {
  const lienHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-home-'));
  process.env.LIEN_HOME = lienHome;

  return async () => {
    delete process.env.LIEN_HOME;
    await fs.rm(lienHome, { recursive: true, force: true });
  };
}

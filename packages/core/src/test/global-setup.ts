import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Vitest globalSetup: redirect Lien's global store for the whole test run.
 *
 * Every code path that resolves `~/.lien/` (VectorDB indices, global config)
 * goes through `getLienHome()` in `@liendev/parser`, which honors the
 * `LIEN_HOME` environment variable. Setting it once here — before any test
 * file or worker starts — means no individual test needs to remember to
 * isolate or clean up its index directory: everything created during this
 * run lands under one throwaway temp dir that gets deleted in teardown.
 *
 * Without this, tests that construct `VectorDB`/`createVectorDB` against a
 * tmp `projectRoot` still end up writing into the REAL `~/.lien/indices/`,
 * because the store path is derived from `os.homedir()`, not from
 * `projectRoot` itself — the tmp dir only supplies the name+hash used to
 * build the leaf directory name.
 */
export default async function setup() {
  const lienHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-home-'));
  process.env.LIEN_HOME = lienHome;

  return async () => {
    delete process.env.LIEN_HOME;
    await fs.rm(lienHome, { recursive: true, force: true });
  };
}

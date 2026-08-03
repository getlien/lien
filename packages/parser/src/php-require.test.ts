import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { requireTargetExists } from './php-require.js';

describe('requireTargetExists', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-php-require-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeFile(relPath: string, content: string): Promise<void> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  it('is false when workspaceRoot is undefined -- nothing to check against', () => {
    expect(requireTargetExists('vendor/autoload.php', undefined)).toBe(false);
  });

  it('is true when the specifier names a real file under workspaceRoot', async () => {
    await writeFile('vendor/autoload.php', '<?php\n');
    expect(requireTargetExists('vendor/autoload.php', testDir)).toBe(true);
  });

  it('is false when the specifier names no real file (never fabricate an edge)', () => {
    expect(requireTargetExists('vendor/autoload.php', testDir)).toBe(false);
  });

  it('is false when a sibling file exists but the exact resolved path does not (no fuzzy leniency)', async () => {
    await writeFile('vendor/other.php', '<?php\n');
    expect(requireTargetExists('vendor/autoload.php', testDir)).toBe(false);
  });

  it('is false when the specifier names a real DIRECTORY, not a file -- PHP cannot require a directory (Lien Review finding)', async () => {
    // fs.existsSync would return true here (a real reproduction of the bug):
    // `require 'vendor'` where `vendor/` exists on disk as a directory must
    // never fabricate an edge, since PHP's require/include can only ever
    // load a FILE at runtime, never a directory.
    await writeFile('vendor/autoload.php', '<?php\n');
    expect(requireTargetExists('vendor', testDir)).toBe(false);
  });

  it('is false when the specifier climbs outside workspaceRoot via .. segments, even if the target exists on disk (CodeRabbit path-traversal finding)', async () => {
    // A sibling directory of testDir (both directly under os.tmpdir()) with
    // a real file in it -- proving the escape would otherwise succeed, since
    // path.join alone doesn't clamp the result to stay inside workspaceRoot.
    const siblingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-php-require-outside-'));
    try {
      const siblingFile = path.join(siblingDir, 'secret.php');
      await fs.writeFile(siblingFile, '<?php\n');

      const escaped = `../${path.basename(siblingDir)}/secret.php`;
      expect(requireTargetExists(escaped, testDir)).toBe(false);
    } finally {
      await fs.rm(siblingDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('is true for a real file whose NAME starts with two dots, not a parent-directory escape (Lien Review finding)', async () => {
    // path.relative('/project', '/project/..foo.php') returns the literal
    // string '..foo.php' -- it starts with '..' as a substring without
    // being a parent-directory escape at all. A naive `startsWith('..')`
    // check would wrongly reject this real, in-project file; the boundary
    // check must test for an actual parent SEGMENT (`..` + path.sep, or the
    // bare '..' itself), not merely a leading '..' substring.
    await writeFile('..foo.php', '<?php\n');
    expect(requireTargetExists('..foo.php', testDir)).toBe(true);
  });

  it('is true for a nested, multi-level legitimate specifier (WordPress-shaped fixture, regression guard for the boundary check)', async () => {
    // The boundary check must not over-reject a real, deeply-nested path --
    // #1063's WordPress measurement (336 edges, 175 statically-resolved
    // sites) depends on this still holding. `wp-admin/includes/admin.php`
    // mirrors the real corpus shape (dependent files sit two directories
    // below the project root).
    await writeFile('wp-admin/includes/admin.php', '<?php\n');
    expect(requireTargetExists('wp-admin/includes/admin.php', testDir)).toBe(true);
  });

  it('is true for a specifier containing internal .. segments that net out INSIDE workspaceRoot (dirname(__DIR__)-shaped, not yet fully normalized)', async () => {
    // resolveRelativeImport normalizes a resolved specifier before it ever
    // reaches this function, so in practice a clean already-normalized path
    // arrives here (see the test above). This test exists to independently
    // confirm the boundary check itself -- path.relative + startsWith('..')
    // -- judges by the NET result of a traversal, not by the mere presence
    // of a `..` segment in the input string: a `dirname(__DIR__)`-shaped
    // specifier that climbs out of a subdirectory and back into a sibling
    // one, while never leaving workspaceRoot overall, must still resolve.
    await writeFile('wp-admin/wp-load.php', '<?php\n');
    expect(requireTargetExists('wp-admin/maint/../wp-load.php', testDir)).toBe(true);
  });
});

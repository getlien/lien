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
});

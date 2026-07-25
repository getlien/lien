import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveGoModulePrefix, resolveGoModuleImport, clearGoModuleCache } from './go-module.js';

describe('resolveGoModulePrefix', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-go-module-'));
  });

  afterEach(async () => {
    clearGoModuleCache();
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeFile(relPath: string, content: string): Promise<void> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  it('returns undefined when there is no go.mod at all', () => {
    expect(resolveGoModulePrefix(testDir)).toBeUndefined();
  });

  it('parses the module prefix (gin shape)', async () => {
    await writeFile('go.mod', 'module github.com/gin-gonic/gin\n\ngo 1.21\n');
    expect(resolveGoModulePrefix(testDir)).toBe('github.com/gin-gonic/gin');
  });

  it('parses the module line regardless of leading/trailing whitespace and later directives', async () => {
    await writeFile(
      'go.mod',
      '  module   github.com/foo/bar  \n\nrequire (\n\tgithub.com/x/y v1.0.0\n)\n',
    );
    expect(resolveGoModulePrefix(testDir)).toBe('github.com/foo/bar');
  });

  it('returns undefined when go.mod has no parseable module line', async () => {
    await writeFile('go.mod', 'go 1.21\n');
    expect(resolveGoModulePrefix(testDir)).toBeUndefined();
  });

  it('caches the prefix per workspace root', async () => {
    await writeFile('go.mod', 'module github.com/gin-gonic/gin\n');
    const first = resolveGoModulePrefix(testDir);
    await writeFile('go.mod', 'module github.com/other/repo\n');
    const second = resolveGoModulePrefix(testDir);

    expect(second).toBe(first);
    expect(second).toBe('github.com/gin-gonic/gin');
  });
});

describe('resolveGoModuleImport', () => {
  it('is a no-op when modulePrefix is undefined', () => {
    expect(resolveGoModuleImport('github.com/gin-gonic/gin/binding', undefined)).toBe(
      'github.com/gin-gonic/gin/binding',
    );
  });

  it('strips the module prefix from a cross-package import (gin repro from #867)', () => {
    expect(
      resolveGoModuleImport('github.com/gin-gonic/gin/binding', 'github.com/gin-gonic/gin'),
    ).toBe('binding');
  });

  it('leaves an import unchanged when it does not start with the module prefix (external dependency)', () => {
    expect(
      resolveGoModuleImport('github.com/stretchr/testify/assert', 'github.com/gin-gonic/gin'),
    ).toBe('github.com/stretchr/testify/assert');
  });

  it('does not false-positive strip a prefix that merely shares a string prefix without a path boundary', () => {
    // "github.com/gin-gonic/ginext" must not be treated as inside "github.com/gin-gonic/gin".
    expect(
      resolveGoModuleImport('github.com/gin-gonic/ginext/foo', 'github.com/gin-gonic/gin'),
    ).toBe('github.com/gin-gonic/ginext/foo');
  });

  it('leaves a bare same-module-root import (no further path segment) unchanged', () => {
    expect(resolveGoModuleImport('github.com/gin-gonic/gin', 'github.com/gin-gonic/gin')).toBe(
      'github.com/gin-gonic/gin',
    );
  });
});

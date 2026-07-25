import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractRepoId } from './repo-id.js';

describe('extractRepoId', () => {
  it('returns project name with path hash', () => {
    const result = extractRepoId('/home/user/my-project');
    const expectedHash = crypto
      .createHash('md5')
      .update('/home/user/my-project')
      .digest('hex')
      .substring(0, 8);
    expect(result).toBe(`my-project-${expectedHash}`);
  });

  it('produces different IDs for different paths with same project name', () => {
    const id1 = extractRepoId('/home/alice/my-project');
    const id2 = extractRepoId('/home/bob/my-project');
    expect(id1).not.toBe(id2);
    // Both start with the project name
    expect(id1.startsWith('my-project-')).toBe(true);
    expect(id2.startsWith('my-project-')).toBe(true);
  });

  it('produces stable IDs for the same path', () => {
    const id1 = extractRepoId('/home/user/project');
    const id2 = extractRepoId('/home/user/project');
    expect(id1).toBe(id2);
  });

  it('uses basename as project name', () => {
    const result = extractRepoId('/deeply/nested/path/cool-app');
    expect(result.startsWith('cool-app-')).toBe(true);
  });

  it('produces 8-character hex hash suffix', () => {
    const result = extractRepoId('/some/path');
    const parts = result.split('-');
    const hash = parts[parts.length - 1];
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  describe('symlink canonicalization (#858)', () => {
    const tmpDirs: string[] = [];

    afterEach(() => {
      for (const dir of tmpDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('yields the same id for a symlinked path and its physical target', () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lien-repo-id-'));
      tmpDirs.push(base);
      const physical = path.join(base, 'my-project');
      fs.mkdirSync(physical);
      const symlink = path.join(base, 'my-project-link');
      fs.symlinkSync(physical, symlink, 'dir');

      const idFromPhysical = extractRepoId(physical);
      const idFromSymlink = extractRepoId(symlink);

      expect(idFromSymlink).toBe(idFromPhysical);
    });

    it('resolves a symlink whose own directory segment is symlinked, not just the leaf', () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lien-repo-id-'));
      tmpDirs.push(base);
      const realParent = path.join(base, 'real-parent');
      fs.mkdirSync(realParent);
      const project = path.join(realParent, 'nested-project');
      fs.mkdirSync(project);
      const linkedParent = path.join(base, 'linked-parent');
      fs.symlinkSync(realParent, linkedParent, 'dir');

      const idViaRealParent = extractRepoId(project);
      const idViaLinkedParent = extractRepoId(path.join(linkedParent, 'nested-project'));

      expect(idViaLinkedParent).toBe(idViaRealParent);
    });

    it('falls back gracefully (no crash) for a path that does not exist', () => {
      const nonexistent = '/definitely/does/not/exist/my-project';
      expect(() => extractRepoId(nonexistent)).not.toThrow();
      const result = extractRepoId(nonexistent);
      expect(result.startsWith('my-project-')).toBe(true);
      // Stable and consistent with the plain path.resolve() fallback.
      expect(result).toBe(extractRepoId(nonexistent));
    });
  });
});

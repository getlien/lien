import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
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
});

import { describe, it, expect } from 'vitest';
import { _testing } from './file-change-handler.js';
import type { FileChangeEvent } from '../watcher/index.js';

const { isGitignoreFile, hasGitignoreChange } = _testing;

describe('isGitignoreFile', () => {
  it('should match .gitignore at root', () => {
    expect(isGitignoreFile('.gitignore')).toBe(true);
  });

  it('should match nested .gitignore', () => {
    expect(isGitignoreFile('packages/app/.gitignore')).toBe(true);
  });

  it('should not match files ending with .gitignore suffix', () => {
    expect(isGitignoreFile('foo.gitignore')).toBe(false);
    expect(isGitignoreFile('my.gitignore')).toBe(false);
  });

  it('should not match regular files', () => {
    expect(isGitignoreFile('src/index.ts')).toBe(false);
    expect(isGitignoreFile('README.md')).toBe(false);
  });
});

describe('hasGitignoreChange', () => {
  it('should detect .gitignore in batch added files', () => {
    const event: FileChangeEvent = {
      type: 'batch',
      filepath: '',
      added: ['src/index.ts', '.gitignore'],
      modified: [],
      deleted: [],
    };
    expect(hasGitignoreChange(event)).toBe(true);
  });

  it('should detect nested .gitignore in batch modified files', () => {
    const event: FileChangeEvent = {
      type: 'batch',
      filepath: '',
      added: [],
      modified: ['packages/app/.gitignore'],
      deleted: [],
    };
    expect(hasGitignoreChange(event)).toBe(true);
  });

  it('should detect .gitignore in batch deleted files', () => {
    const event: FileChangeEvent = {
      type: 'batch',
      filepath: '',
      added: [],
      modified: [],
      deleted: ['packages/app/.gitignore'],
    };
    expect(hasGitignoreChange(event)).toBe(true);
  });

  it('should return false for batch with no .gitignore changes', () => {
    const event: FileChangeEvent = {
      type: 'batch',
      filepath: '',
      added: ['src/index.ts'],
      modified: ['src/app.ts'],
      deleted: [],
    };
    expect(hasGitignoreChange(event)).toBe(false);
  });

  it('should not match files with .gitignore suffix in batch', () => {
    const event: FileChangeEvent = {
      type: 'batch',
      filepath: '',
      added: ['foo.gitignore'],
      modified: [],
      deleted: [],
    };
    expect(hasGitignoreChange(event)).toBe(false);
  });

  it('should detect .gitignore in single file events', () => {
    const event: FileChangeEvent = {
      type: 'change',
      filepath: '.gitignore',
    };
    expect(hasGitignoreChange(event)).toBe(true);
  });

  it('should return false for single file events with regular files', () => {
    const event: FileChangeEvent = {
      type: 'change',
      filepath: 'src/index.ts',
    };
    expect(hasGitignoreChange(event)).toBe(false);
  });
});

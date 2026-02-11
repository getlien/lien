import { describe, it, expect } from 'vitest';
import {
  toRelativePath,
  toAbsolutePath,
  makeRelative,
  makeAbsolute,
  isRelativePath,
  isAbsolutePath,
  type RelativePath,
  type AbsolutePath,
} from './paths.js';

describe('Path Type System', () => {
  describe('toRelativePath', () => {
    it('should accept valid relative paths', () => {
      expect(toRelativePath('src/index.ts')).toBe('src/index.ts');
      expect(toRelativePath('components/Button.tsx')).toBe('components/Button.tsx');
      expect(toRelativePath('.')).toBe('.');
      expect(toRelativePath('..')).toBe('..');
      expect(toRelativePath('../parent/file.ts')).toBe('../parent/file.ts');
    });

    it('should reject Unix absolute paths', () => {
      expect(() => toRelativePath('/absolute/path')).toThrow(
        'Expected relative path, got absolute: /absolute/path'
      );
      expect(() => toRelativePath('/usr/local/bin')).toThrow();
    });

    it('should reject Windows absolute paths', () => {
      expect(() => toRelativePath('C:\\Windows\\System32')).toThrow(
        'Expected relative path, got absolute: C:\\Windows\\System32'
      );
      expect(() => toRelativePath('D:\\Projects')).toThrow();
    });
  });

  describe('toAbsolutePath', () => {
    it('should accept valid Unix absolute paths', () => {
      expect(toAbsolutePath('/absolute/path')).toBe('/absolute/path');
      expect(toAbsolutePath('/usr/local/bin')).toBe('/usr/local/bin');
      expect(toAbsolutePath('/')).toBe('/');
    });

    it('should accept valid Windows absolute paths', () => {
      expect(toAbsolutePath('C:\\Windows\\System32')).toBe('C:\\Windows\\System32');
      expect(toAbsolutePath('D:\\Projects')).toBe('D:\\Projects');
    });

    it('should reject relative paths', () => {
      expect(() => toAbsolutePath('src/index.ts')).toThrow(
        'Expected absolute path, got relative: src/index.ts'
      );
      expect(() => toAbsolutePath('.')).toThrow();
      expect(() => toAbsolutePath('../parent')).toThrow();
    });
  });

  describe('makeRelative', () => {
    it('should convert absolute to relative (Unix)', () => {
      const rootDir = toAbsolutePath('/project/root');
      const absPath = toAbsolutePath('/project/root/src/index.ts');
      
      const result = makeRelative(absPath, rootDir);
      expect(result).toBe('src/index.ts');
    });

    it('should handle nested paths', () => {
      const rootDir = toAbsolutePath('/home/user/project');
      const absPath = toAbsolutePath('/home/user/project/packages/cli/src/index.ts');
      
      const result = makeRelative(absPath, rootDir);
      expect(result).toBe('packages/cli/src/index.ts');
    });

    it('should handle root directory itself', () => {
      const rootDir = toAbsolutePath('/project');
      const absPath = toAbsolutePath('/project');
      
      const result = makeRelative(absPath, rootDir);
      expect(result).toBe('');
    });
  });

  describe('makeAbsolute', () => {
    it('should convert relative to absolute (Unix)', () => {
      const rootDir = toAbsolutePath('/project/root');
      const relPath = toRelativePath('src/index.ts');
      
      const result = makeAbsolute(relPath, rootDir);
      expect(result).toBe('/project/root/src/index.ts');
    });

    it('should handle nested paths', () => {
      const rootDir = toAbsolutePath('/home/user/project');
      const relPath = toRelativePath('packages/cli/src/index.ts');
      
      const result = makeAbsolute(relPath, rootDir);
      expect(result).toBe('/home/user/project/packages/cli/src/index.ts');
    });

    it('should handle current directory', () => {
      const rootDir = toAbsolutePath('/project');
      const relPath = toRelativePath('.');
      
      const result = makeAbsolute(relPath, rootDir);
      expect(result).toBe('/project');
    });
  });

  describe('isRelativePath', () => {
    it('should return true for relative paths', () => {
      expect(isRelativePath('src/index.ts')).toBe(true);
      expect(isRelativePath('components/Button.tsx')).toBe(true);
      expect(isRelativePath('.')).toBe(true);
      expect(isRelativePath('..')).toBe(true);
      expect(isRelativePath('../parent')).toBe(true);
    });

    it('should return false for Unix absolute paths', () => {
      expect(isRelativePath('/absolute/path')).toBe(false);
      expect(isRelativePath('/usr/local/bin')).toBe(false);
      expect(isRelativePath('/')).toBe(false);
    });

    it('should return false for Windows absolute paths', () => {
      expect(isRelativePath('C:\\Windows')).toBe(false);
      expect(isRelativePath('D:\\Projects')).toBe(false);
    });
  });

  describe('isAbsolutePath', () => {
    it('should return true for Unix absolute paths', () => {
      expect(isAbsolutePath('/absolute/path')).toBe(true);
      expect(isAbsolutePath('/usr/local/bin')).toBe(true);
      expect(isAbsolutePath('/')).toBe(true);
    });

    it('should return true for Windows absolute paths', () => {
      expect(isAbsolutePath('C:\\Windows')).toBe(true);
      expect(isAbsolutePath('D:\\Projects')).toBe(true);
    });

    it('should return false for relative paths', () => {
      expect(isAbsolutePath('src/index.ts')).toBe(false);
      expect(isAbsolutePath('.')).toBe(false);
      expect(isAbsolutePath('../parent')).toBe(false);
    });
  });

  describe('Type safety at compile time', () => {
    it('should enforce type distinction between RelativePath and AbsolutePath', () => {
      const relPath: RelativePath = toRelativePath('src/index.ts');
      const absPath: AbsolutePath = toAbsolutePath('/absolute/path');
      
      // These types should be distinct at compile time
      // @ts-expect-error - Cannot assign RelativePath to AbsolutePath
      const _invalid1: AbsolutePath = relPath;
      // @ts-expect-error - Cannot assign AbsolutePath to RelativePath
      const _invalid2: RelativePath = absPath;
      
      // But both are still strings at runtime
      expect(typeof relPath).toBe('string');
      expect(typeof absPath).toBe('string');
    });
  });

  describe('Round-trip conversions', () => {
    it('should maintain path integrity through conversions', () => {
      const rootDir = toAbsolutePath('/project/root');
      const originalRel = toRelativePath('src/components/Button.tsx');
      
      // Convert: relative → absolute → relative
      const absolute = makeAbsolute(originalRel, rootDir);
      const backToRelative = makeRelative(absolute, rootDir);
      
      expect(backToRelative).toBe(originalRel);
    });

    it('should handle paths with dots', () => {
      const rootDir = toAbsolutePath('/project');
      const relPath = toRelativePath('./src/index.ts');
      
      const absPath = makeAbsolute(relPath, rootDir);
      // path.join normalizes './' away
      expect(absPath).toBe('/project/src/index.ts');
    });
  });
});


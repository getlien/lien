import { describe, it, expect } from 'vitest';
import { detectLanguage, getLanguage, languageExists, getAllLanguages } from './registry.js';
import type { SupportedLanguage } from './registry.js';

describe('Language Registry', () => {
  describe('detectLanguage', () => {
    it('should detect TypeScript files', () => {
      expect(detectLanguage('app.ts')).toBe('typescript');
      expect(detectLanguage('component.tsx')).toBe('typescript');
    });

    it('should detect JavaScript files', () => {
      expect(detectLanguage('index.js')).toBe('javascript');
      expect(detectLanguage('component.jsx')).toBe('javascript');
    });

    it('should detect PHP files', () => {
      expect(detectLanguage('controller.php')).toBe('php');
    });

    it('should detect Python files', () => {
      expect(detectLanguage('main.py')).toBe('python');
    });

    it('should detect Rust files', () => {
      expect(detectLanguage('main.rs')).toBe('rust');
    });

    it('should detect Go files', () => {
      expect(detectLanguage('main.go')).toBe('go');
    });

    it('should detect Java files', () => {
      expect(detectLanguage('Main.java')).toBe('java');
    });

    it('should return null for unsupported extensions', () => {
      expect(detectLanguage('style.css')).toBeNull();
      expect(detectLanguage('data.json')).toBeNull();
      expect(detectLanguage('README.md')).toBeNull();
      expect(detectLanguage('main.swift')).toBeNull();
    });

    it('should handle paths with directories', () => {
      expect(detectLanguage('src/utils/helper.ts')).toBe('typescript');
      expect(detectLanguage('/absolute/path/to/file.py')).toBe('python');
    });

    it('should be case-insensitive for extensions', () => {
      expect(detectLanguage('file.TS')).toBe('typescript');
      expect(detectLanguage('file.PY')).toBe('python');
    });
  });

  describe('getLanguage', () => {
    it('should return a definition for each supported language', () => {
      const languages: SupportedLanguage[] = [
        'typescript',
        'javascript',
        'php',
        'python',
        'rust',
        'go',
        'java',
      ];
      for (const lang of languages) {
        const def = getLanguage(lang);
        expect(def.id).toBe(lang);
        expect(def.extensions.length).toBeGreaterThan(0);
        expect(def.grammar).toBeDefined();
        expect(def.traverser).toBeDefined();
        expect(def.exportExtractor).toBeDefined();
        expect(def.complexity).toBeDefined();
      }
    });

    it('should throw for unregistered languages', () => {
      expect(() => getLanguage('swift' as SupportedLanguage)).toThrow(
        'No language definition registered for: swift',
      );
    });
  });

  describe('languageExists', () => {
    it('should return true for registered languages', () => {
      expect(languageExists('typescript')).toBe(true);
      expect(languageExists('python')).toBe(true);
    });

    it('should return false for unregistered languages', () => {
      expect(languageExists('swift')).toBe(false);
      expect(languageExists('')).toBe(false);
    });
  });

  describe('getAllLanguages', () => {
    it('should return all 7 registered languages', () => {
      const all = getAllLanguages();
      expect(all).toHaveLength(7);
      const ids = all.map(d => d.id);
      expect(ids).toContain('typescript');
      expect(ids).toContain('javascript');
      expect(ids).toContain('php');
      expect(ids).toContain('python');
      expect(ids).toContain('rust');
      expect(ids).toContain('go');
      expect(ids).toContain('java');
    });

    it('should return a defensive copy', () => {
      const a = getAllLanguages();
      const b = getAllLanguages();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it('should have no duplicate IDs or extensions', () => {
      const all = getAllLanguages();
      const ids = all.map(d => d.id);
      const extensions = all.flatMap(d => d.extensions);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(extensions).size).toBe(extensions.length);
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  LANGUAGE_IDS,
  detectLanguage,
  getLanguage,
  languageExists,
  getAllLanguages,
  hasWholeModuleImports,
  hasEnclosingNamespaceAccess,
  hasSingleFileImports,
  hasNamespaceStyleImports,
  hasSameDirectoryTestConvention,
  hasSamePackageTestConvention,
  hasDependentAttributionBlindSpot,
} from './registry.js';
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

    it('should detect C# files', () => {
      expect(detectLanguage('Program.cs')).toBe('csharp');
    });

    it('should detect Ruby files', () => {
      expect(detectLanguage('app/models/user.rb')).toBe('ruby');
    });

    it('should detect Swift files', () => {
      expect(detectLanguage('Sources/App/Order.swift')).toBe('swift');
    });

    it('should return null for unsupported extensions', () => {
      expect(detectLanguage('style.css')).toBeNull();
      expect(detectLanguage('data.json')).toBeNull();
      expect(detectLanguage('README.md')).toBeNull();
      expect(detectLanguage('main.scala')).toBeNull();
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
        'csharp',
        'ruby',
        'kotlin',
        'swift',
      ];
      for (const lang of languages) {
        const def = getLanguage(lang);
        expect(def.id).toBe(lang);
        expect(def.extensions.length).toBeGreaterThan(0);
        expect(def.traverser).toBeDefined();
        expect(def.exportExtractor).toBeDefined();
        expect(def.complexity).toBeDefined();
      }
    });

    it('should throw for unregistered languages', () => {
      expect(() => getLanguage('scala' as SupportedLanguage)).toThrow(
        'No language definition registered for: scala',
      );
    });
  });

  describe('languageExists', () => {
    it('should return true for registered languages', () => {
      expect(languageExists('typescript')).toBe(true);
      expect(languageExists('python')).toBe(true);
    });

    it('should return false for unregistered languages', () => {
      expect(languageExists('scala')).toBe(false);
      expect(languageExists('')).toBe(false);
    });
  });

  describe('getAllLanguages', () => {
    it('should return all 11 registered languages', () => {
      const all = getAllLanguages();
      expect(all).toHaveLength(11);
      const ids = all.map(d => d.id);
      expect(ids).toContain('typescript');
      expect(ids).toContain('javascript');
      expect(ids).toContain('php');
      expect(ids).toContain('python');
      expect(ids).toContain('rust');
      expect(ids).toContain('go');
      expect(ids).toContain('java');
      expect(ids).toContain('csharp');
      expect(ids).toContain('ruby');
      expect(ids).toContain('kotlin');
      expect(ids).toContain('swift');
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

  describe('hasWholeModuleImports', () => {
    it('is true for Swift (#869: confirmed whole-module import convention)', () => {
      expect(hasWholeModuleImports('swift')).toBe(true);
    });

    it('is false for every other registered language', () => {
      const others = getAllLanguages()
        .map(d => d.id)
        .filter(id => id !== 'swift');
      expect(others.length).toBeGreaterThan(0);
      others.forEach(id => {
        expect(hasWholeModuleImports(id)).toBe(false);
      });
    });
  });

  describe('hasEnclosingNamespaceAccess', () => {
    it('is true for C# (#875: confirmed enclosing-namespace resolution against AutoMapper)', () => {
      expect(hasEnclosingNamespaceAccess('csharp')).toBe(true);
    });

    it('is false for every other registered language', () => {
      const others = getAllLanguages()
        .map(d => d.id)
        .filter(id => id !== 'csharp');
      expect(others.length).toBeGreaterThan(0);
      others.forEach(id => {
        expect(hasEnclosingNamespaceAccess(id)).toBe(false);
      });
    });

    it('is independent of hasWholeModuleImports (C# is not a whole-module-import language)', () => {
      expect(hasWholeModuleImports('csharp')).toBe(false);
      expect(hasEnclosingNamespaceAccess('swift')).toBe(false);
    });
  });

  describe('hasSingleFileImports', () => {
    it('is true for Ruby (#887: a bare multi-segment require names one file, not a package directory)', () => {
      expect(hasSingleFileImports('ruby')).toBe(true);
    });

    it('is false for every other registered language, notably Go (package-directory semantics)', () => {
      expect(hasSingleFileImports('go')).toBe(false);
      const others = getAllLanguages()
        .map(d => d.id)
        .filter(id => id !== 'ruby');
      expect(others.length).toBeGreaterThan(0);
      others.forEach(id => {
        expect(hasSingleFileImports(id)).toBe(false);
      });
    });

    it('is independent of hasWholeModuleImports/hasEnclosingNamespaceAccess', () => {
      expect(hasWholeModuleImports('ruby')).toBe(false);
      expect(hasEnclosingNamespaceAccess('ruby')).toBe(false);
    });
  });

  describe('hasNamespaceStyleImports (#1028, made required by ADR-015/#1038)', () => {
    it('is true for PHP (PSR-4 case-insensitive, directory-mirroring namespaces)', () => {
      expect(hasNamespaceStyleImports('php')).toBe(true);
    });

    it('is false for every other registered language, notably C#/Java/Kotlin despite their own directory-mirroring package/namespace conventions', () => {
      expect(hasNamespaceStyleImports('csharp')).toBe(false);
      expect(hasNamespaceStyleImports('java')).toBe(false);
      expect(hasNamespaceStyleImports('kotlin')).toBe(false);
      const others = getAllLanguages()
        .map(d => d.id)
        .filter(id => id !== 'php');
      expect(others.length).toBeGreaterThan(0);
      others.forEach(id => {
        expect(hasNamespaceStyleImports(id)).toBe(false);
      });
    });

    it('is independent of hasWholeModuleImports/hasSingleFileImports', () => {
      expect(hasWholeModuleImports('php')).toBe(false);
      expect(hasSingleFileImports('php')).toBe(false);
    });
  });

  describe('ADR-015 (#1038): matcher-path fields are required and declared for all 11 languages', () => {
    const MATCHER_PATH_FLAGS = [
      'wholeModuleImports',
      'singleFileImports',
      'namespaceStyleImports',
    ] as const;

    it('every language declares a real boolean (never undefined) for all three fields', () => {
      // Runtime defense-in-depth for the compile-time `LanguageDefinition`
      // contract: this stays green even if some future refactor constructs a
      // definition dynamically (object spread, `Object.assign`, a JS
      // consumer bypassing TS) in a way that could silently smuggle an
      // `undefined` back in past `tsc`.
      getAllLanguages().forEach(def => {
        MATCHER_PATH_FLAGS.forEach(flag => {
          expect(typeof def[flag]).toBe('boolean');
        });
      });
    });

    it('cross-language policy: at most one of the three matcher-path flags is true per language', () => {
      // These three fields are alternative, largely mutually-exclusive
      // resolution strategies for a language's BARE import specifiers --
      // whole-module-only (Swift), single-file (Ruby), or case-insensitive
      // namespace-mirroring (PHP). A language genuinely needing two at once
      // would be a surprising enough finding to warrant its own discussion,
      // not a silent combination, so this is asserted as a policy, not
      // merely observed per-language.
      getAllLanguages().forEach(def => {
        const trueCount = MATCHER_PATH_FLAGS.filter(flag => def[flag] === true).length;
        expect(trueCount).toBeLessThanOrEqual(1);
      });
    });

    it('cross-language policy: these three escape hatches stay sparse -- at most one language sets each one', () => {
      // A tripwire, not a hard architectural limit: these flags exist
      // because a language's bare-import convention diverges from the
      // shared matcher's default. If a review ever needs to set a SECOND
      // language's flag true for the same field, that's a fine, deliberate
      // outcome -- but this test should fail loudly when it happens, forcing
      // a conscious bump here rather than a silent third/fourth escape hatch
      // accumulating unnoticed (the exact failure mode ADR-015/#1038 was
      // written to close off).
      MATCHER_PATH_FLAGS.forEach(flag => {
        const languagesSettingTrue = getAllLanguages().filter(def => def[flag] === true);
        expect(languagesSettingTrue.length).toBeLessThanOrEqual(1);
      });
      expect(
        getAllLanguages()
          .filter(d => d.wholeModuleImports)
          .map(d => d.id),
      ).toEqual(['swift']);
      expect(
        getAllLanguages()
          .filter(d => d.singleFileImports)
          .map(d => d.id),
      ).toEqual(['ruby']);
      expect(
        getAllLanguages()
          .filter(d => d.namespaceStyleImports)
          .map(d => d.id),
      ).toEqual(['php']);
    });
  });

  describe('hasSameDirectoryTestConvention', () => {
    it('is true for Go (#902: the dominant same-package _test.go convention)', () => {
      expect(hasSameDirectoryTestConvention('go')).toBe(true);
    });

    it('is false for every other registered language', () => {
      const others = getAllLanguages()
        .map(d => d.id)
        .filter(id => id !== 'go');
      expect(others.length).toBeGreaterThan(0);
      others.forEach(id => {
        expect(hasSameDirectoryTestConvention(id)).toBe(false);
      });
    });

    it('is independent of hasWholeModuleImports/hasEnclosingNamespaceAccess/hasSingleFileImports', () => {
      expect(hasWholeModuleImports('go')).toBe(false);
      expect(hasEnclosingNamespaceAccess('go')).toBe(false);
      expect(hasSingleFileImports('go')).toBe(false);
    });
  });

  describe('hasDependentAttributionBlindSpot (#1005)', () => {
    it('is true for C#, Java, Kotlin, and Swift', () => {
      expect(hasDependentAttributionBlindSpot('csharp')).toBe(true);
      expect(hasDependentAttributionBlindSpot('java')).toBe(true);
      expect(hasDependentAttributionBlindSpot('kotlin')).toBe(true);
      expect(hasDependentAttributionBlindSpot('swift')).toBe(true);
    });

    it('is false for every other registered language, notably Go despite its own same-directory test convention', () => {
      const others = getAllLanguages()
        .map(d => d.id)
        .filter(id => !['csharp', 'java', 'kotlin', 'swift'].includes(id));
      expect(others.length).toBeGreaterThan(0);
      others.forEach(id => {
        expect(hasDependentAttributionBlindSpot(id)).toBe(false);
      });
      // Go is the explicit exclusion: hasSameDirectoryTestConvention already
      // recovers a REAL association, so it must not also be swept into this
      // wider, honesty-only predicate.
      expect(hasSameDirectoryTestConvention('go')).toBe(true);
      expect(hasDependentAttributionBlindSpot('go')).toBe(false);
    });

    it('composes the three pre-existing flags for C#/Java/Swift, each for its own reason', () => {
      expect(hasEnclosingNamespaceAccess('csharp')).toBe(true);
      expect(hasSamePackageTestConvention('java')).toBe(true);
      expect(hasWholeModuleImports('swift')).toBe(true);
      // None of those three pre-existing flags are themselves true for Kotlin
      // -- it needs its own dedicated flag (`sameUnitAccessWithoutImport`).
      expect(hasEnclosingNamespaceAccess('kotlin')).toBe(false);
      expect(hasSamePackageTestConvention('kotlin')).toBe(false);
      expect(hasWholeModuleImports('kotlin')).toBe(false);
    });
  });
});

describe('LANGUAGE_IDS', () => {
  // Internal, deliberately: it was briefly exported from the package barrel so
  // the CLI could name the supported languages, and that broke the 0.80.3
  // release (#1160) -- the changeset named only `@liendev/lien`, so the
  // published CLI resolved a parser without the export and threw on import.
  // Callers use `getAllLanguages()` instead, which has been public for longer.
  //
  // `SupportedLanguage` is `(typeof LANGUAGE_IDS)[number]`, so removing an
  // entry still narrows a type the package publishes. These tests keep that
  // honest without exporting the array itself.
  const PUBLISHED = [
    'typescript',
    'javascript',
    'php',
    'python',
    'rust',
    'go',
    'java',
    'csharp',
    'ruby',
    'kotlin',
    'swift',
  ];

  it('still contains every language whose id has shipped', () => {
    // Membership, not deep equality: ADDING a language is fine and must not
    // fail this. Removing one, or renaming an id, is the breaking change.
    for (const id of PUBLISHED) expect(LANGUAGE_IDS).toContain(id);
  });

  it('matches what getAllLanguages reports, since that is what callers read', () => {
    // The CLI names the supported set from `getAllLanguages()`. If that ever
    // diverged from this array, the CLI would tell users something false.
    expect(
      getAllLanguages()
        .map(d => d.id)
        .sort(),
    ).toEqual([...LANGUAGE_IDS].sort());
  });

  it('has no duplicate ids', () => {
    expect(new Set(LANGUAGE_IDS).size).toBe(LANGUAGE_IDS.length);
  });

  it('agrees with languageExists, which reads the registry rather than this array', () => {
    // The two could drift: `languageExists` consults the Map built from the
    // definitions, while this array is written by hand.
    for (const id of LANGUAGE_IDS) expect(languageExists(id)).toBe(true);
    expect(getAllLanguages()).toHaveLength(LANGUAGE_IDS.length);
  });
});

import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  matchesFile,
  isTestFile,
  resolveRelativeImport,
  resolveWorkspaceImport,
  isUnresolvableWholeModuleImport,
  importMatchesTarget,
  hasSingleFileImportSemantics,
} from './path-matching.js';

/**
 * Test cases for path matching logic in get_dependents tool.
 *
 * Ensures path matching respects component boundaries to avoid false positives:
 * - "src/logger" should NOT match "src/logger-utils" ✓
 * - "logger" should NOT match "some-logger-package" ✓
 * - Matches occur only at proper boundaries (/, .)
 *
 * Covers extension normalization (.ts vs .js), relative imports,
 * and various edge cases for robust dependency detection.
 */
describe('matchesFile - Path Boundary Checking', () => {
  // Test helper: normalize paths without workspace root (not needed for unit tests)
  const normalize = (path: string): string => normalizePath(path, '/fake/workspace');

  const testMatchesFile = (
    importPath: string,
    targetPath: string,
    requireExactTailForMultiSegment = false,
  ): boolean => {
    const normalizedImport = normalize(importPath);
    const normalizedTarget = normalize(targetPath);
    return matchesFile(normalizedImport, normalizedTarget, requireExactTailForMultiSegment);
  };

  describe('should match valid imports', () => {
    it('should match exact path', () => {
      expect(testMatchesFile('src/logger', 'src/logger')).toBe(true);
      expect(testMatchesFile('src/logger.ts', 'src/logger')).toBe(true);
      expect(testMatchesFile('src/logger', 'src/logger.ts')).toBe(true);
    });

    it('should match path with extension', () => {
      expect(testMatchesFile('src/utils/logger.ts', 'src/utils/logger')).toBe(true);
      expect(testMatchesFile('src/utils/logger', 'src/utils/logger.ts')).toBe(true);
    });

    it('should match relative imports', () => {
      expect(testMatchesFile('./logger', 'logger')).toBe(true);
      expect(testMatchesFile('../logger', 'logger')).toBe(true);
      expect(testMatchesFile('./utils/logger', 'utils/logger')).toBe(true);
    });

    it('should match relative imports to full paths', () => {
      expect(testMatchesFile('./schemas/index.js', 'packages/cli/src/mcp/schemas/index.ts')).toBe(
        true,
      );
      expect(testMatchesFile('../schemas/index', 'src/mcp/schemas/index')).toBe(true);
    });

    it('should match the exact dogfooding scenario', () => {
      // After normalization (extension stripped):
      // import: ./schemas/index.js → ./schemas/index
      // target: packages/cli/src/mcp/schemas/index.ts → packages/cli/src/mcp/schemas/index
      const normalizeExt = (p: string) => p.replace(/\.(ts|tsx|js|jsx)$/, '');
      const imp = normalizeExt('./schemas/index.js');
      const target = normalizeExt('packages/cli/src/mcp/schemas/index.ts');
      expect(testMatchesFile(imp, target)).toBe(true);
    });

    it('should match nested paths', () => {
      expect(testMatchesFile('src/utils/logger', 'utils/logger')).toBe(true);
      expect(testMatchesFile('packages/cli/src/logger', 'src/logger')).toBe(true);
    });
  });

  describe('should NOT match false positives (the bug)', () => {
    it('should NOT match paths with similar prefixes', () => {
      expect(testMatchesFile('src/logger-utils', 'src/logger')).toBe(false);
      expect(testMatchesFile('src/logger', 'src/logger-utils')).toBe(false);
    });

    it('should NOT match paths with similar suffixes', () => {
      expect(testMatchesFile('some-logger-package', 'logger')).toBe(false);
      expect(testMatchesFile('my-logger', 'logger')).toBe(false);
    });

    it('should NOT match paths where pattern appears mid-component', () => {
      expect(testMatchesFile('src/mylogger', 'logger')).toBe(false);
      expect(testMatchesFile('src/loggerservice', 'logger')).toBe(false);
    });

    it('should NOT match package names with similar strings', () => {
      expect(testMatchesFile('@company/logger-service', 'logger')).toBe(false);
      expect(testMatchesFile('winston-logger', 'logger')).toBe(false);
    });

    it('should NOT match completely different files', () => {
      expect(testMatchesFile('src/database.ts', 'src/logger.ts')).toBe(false);
      expect(testMatchesFile('auth/handler', 'logger')).toBe(false);
    });

    it('should NOT match same filename in different directories', () => {
      expect(testMatchesFile('src/utils/validator.ts', 'lib/validator.ts')).toBe(false);
      expect(testMatchesFile('components/Button.tsx', 'ui/Button.tsx')).toBe(false);
      expect(testMatchesFile('auth/handler.ts', 'api/handler.ts')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle quoted imports', () => {
      expect(testMatchesFile('"src/logger"', 'src/logger')).toBe(true);
      expect(testMatchesFile("'src/logger'", 'src/logger')).toBe(true);
    });

    it('should handle Windows paths', () => {
      expect(testMatchesFile('src\\logger', 'src/logger')).toBe(true);
      expect(testMatchesFile('src\\utils\\logger', 'src/utils/logger')).toBe(true);
    });

    it('should handle whitespace', () => {
      expect(testMatchesFile(' src/logger ', 'src/logger')).toBe(true);
    });
  });

  describe('extension normalization (.ts vs .js)', () => {
    it('should match .ts files with .js imports (TypeScript ESM)', () => {
      expect(testMatchesFile('src/logger.js', 'src/logger.ts')).toBe(true);
      expect(testMatchesFile('./utils.js', './utils.ts')).toBe(true);
    });

    it('should match .tsx files with .js imports', () => {
      expect(testMatchesFile('components/Button.js', 'components/Button.tsx')).toBe(true);
    });

    it('should match files with any JS/TS extension combination', () => {
      expect(testMatchesFile('src/helper.js', 'src/helper.ts')).toBe(true);
      expect(testMatchesFile('src/helper.ts', 'src/helper.js')).toBe(true);
      expect(testMatchesFile('src/helper.jsx', 'src/helper.tsx')).toBe(true);
    });

    it('should match files without extensions to files with extensions', () => {
      expect(testMatchesFile('src/logger', 'src/logger.ts')).toBe(true);
      expect(testMatchesFile('src/logger.ts', 'src/logger')).toBe(true);
    });

    it('should NOT match different files despite same extension', () => {
      expect(testMatchesFile('src/logger.ts', 'src/utils.ts')).toBe(false);
      expect(testMatchesFile('auth/handler.js', 'api/handler.js')).toBe(false);
    });
  });

  describe('test file boundary checking', () => {
    it('should NOT match test files when searching for source file', () => {
      // After normalization: logger.test.ts → logger.test, logger.ts → logger
      // "logger" should NOT match "logger.test"
      expect(testMatchesFile('logger', 'logger.test')).toBe(false);
      expect(testMatchesFile('src/logger', 'src/logger.test')).toBe(false);
      expect(testMatchesFile('utils/validator', 'utils/validator.spec')).toBe(false);
    });

    it('should NOT match test files with extensions', () => {
      // These get normalized but should still not match
      expect(testMatchesFile('logger.ts', 'logger.test.ts')).toBe(false);
      expect(testMatchesFile('src/auth.ts', 'src/auth.spec.ts')).toBe(false);
    });
  });

  describe('PHP namespace matching', () => {
    it('should match PHP namespace to file path', () => {
      // PHP uses namespaces like App\Models\User which map to app/Models/User.php
      expect(testMatchesFile('App\\Models\\User', 'app/Models/User.php')).toBe(true);
      expect(testMatchesFile('App\\Models\\Collection', 'web/app/Models/Collection.php')).toBe(
        true,
      );
    });

    it('should match nested PHP namespaces', () => {
      expect(
        testMatchesFile(
          'Domain\\Hobbii\\Collections\\Services\\CollectionManager',
          'web/Domain/Hobbii/Collections/Services/CollectionManager.php',
        ),
      ).toBe(true);
    });

    it('should match case-insensitively for App namespace', () => {
      // Laravel convention: App namespace maps to app directory
      expect(
        testMatchesFile(
          'App\\Http\\Controllers\\UserController',
          'app/Http/Controllers/UserController.php',
        ),
      ).toBe(true);
    });

    it('should NOT match unrelated PHP namespaces', () => {
      expect(testMatchesFile('App\\Models\\User', 'app/Models/Product.php')).toBe(false);
      expect(testMatchesFile('App\\Services\\Auth', 'app/Models/User.php')).toBe(false);
    });

    it('should NOT apply PHP matching to non-namespace imports', () => {
      // Regular file paths should not use PHP namespace matching
      expect(testMatchesFile('src/models/user', 'src/models/product')).toBe(false);
    });
  });

  describe('Rust module matching', () => {
    it('should match Rust module path to file path', () => {
      // Rust uses `crate::auth` which gets converted to `auth`
      expect(testMatchesFile('auth', 'src/auth.rs')).toBe(true);
      expect(testMatchesFile('auth/middleware', 'src/auth/middleware.rs')).toBe(true);
    });

    it('should match Rust module in nested directory', () => {
      expect(testMatchesFile('models/user', 'src/models/user.rs')).toBe(true);
      expect(testMatchesFile('utils', 'src/utils.rs')).toBe(true);
    });

    it('should match Rust super-relative paths', () => {
      // `super::utils` converts to `../utils`
      expect(testMatchesFile('../utils', 'utils.rs')).toBe(true);
    });

    it('should normalize .rs extension', () => {
      expect(testMatchesFile('auth.rs', 'src/auth.rs')).toBe(true);
      expect(testMatchesFile('src/auth.rs', 'src/auth')).toBe(true);
    });

    it('should NOT match unrelated Rust modules', () => {
      expect(testMatchesFile('auth', 'src/models.rs')).toBe(false);
      expect(testMatchesFile('auth/middleware', 'src/auth/handler.rs')).toBe(false);
    });
  });

  describe('Python module matching', () => {
    it('should match Python dotted module to file path', () => {
      // Python uses dotted paths like django.http which map to django/http/*.py
      expect(testMatchesFile('django.http', 'django/http/response.py')).toBe(true);
      expect(testMatchesFile('django.http', 'django/http/__init__.py')).toBe(true);
    });

    it('should match exact Python module path', () => {
      expect(testMatchesFile('django.http.response', 'django/http/response.py')).toBe(true);
      expect(testMatchesFile('django.views.generic.base', 'django/views/generic/base.py')).toBe(
        true,
      );
    });

    it('should match Python module with prefix in target', () => {
      // When target has extra prefix directories
      expect(testMatchesFile('django.http', 'src/django/http/response.py')).toBe(true);
      expect(testMatchesFile('myapp.models', 'project/myapp/models/__init__.py')).toBe(true);
    });

    it('should match parent package to child modules', () => {
      // from django.http import HttpResponse - matches any module under django/http/
      expect(testMatchesFile('django.http', 'django/http/request.py')).toBe(true);
      expect(testMatchesFile('django.http', 'django/http/cookie.py')).toBe(true);
    });

    it('should NOT match unrelated Python modules', () => {
      expect(testMatchesFile('django.http', 'django/views/generic.py')).toBe(false);
      expect(testMatchesFile('django.db.models', 'django/http/response.py')).toBe(false);
    });

    it('should NOT apply Python matching to non-dotted imports', () => {
      // Regular file paths should not use Python module matching
      expect(testMatchesFile('src/models/user', 'src/models/product.py')).toBe(false);
    });

    it('should NOT apply Python matching to relative imports with dots', () => {
      // Relative paths starting with . should not trigger Python module matching
      expect(testMatchesFile('./utils.helper', 'utils/helper.py')).toBe(false);
      expect(testMatchesFile('../models.user', 'models/user.py')).toBe(false);
    });

    it('should NOT apply Python matching to file paths with dots', () => {
      // Paths containing slashes are file paths, not Python modules
      expect(testMatchesFile('src/utils.helper', 'utils/helper.py')).toBe(false);
    });

    it('should handle single-level Python modules', () => {
      // Single module without dots should still work if it's part of the path
      expect(testMatchesFile('django.utils', 'django/utils/__init__.py')).toBe(true);
      expect(testMatchesFile('django.utils', 'django/utils/timezone.py')).toBe(true);
    });
  });

  describe('bare identifier precision (#868)', () => {
    describe('repro canaries', () => {
      it('Go: a bare package-relative basename must not tail-match an unrelated deep import path', () => {
        // fs.go (top-level, unrelated) must NOT be credited with an import
        // that's actually internal/fs's (render/html.go imports
        // github.com/gin-gonic/gin/internal/fs).
        expect(testMatchesFile('github.com/gin-gonic/gin/internal/fs', 'fs')).toBe(false);
        // The real relationship (a multi-segment import matching its
        // multi-segment target) is untouched by this guard.
        expect(testMatchesFile('github.com/gin-gonic/gin/internal/fs', 'internal/fs')).toBe(true);
      });

      it('Go: still rejects the bare-target shape even after #867 strips the module prefix', () => {
        // #867 resolves the raw github.com/gin-gonic/gin/internal/fs import
        // down to internal/fs (module prefix stripped). A bare, unrelated
        // top-level "fs" target must still not tail-match it, even though
        // only a single directory segment ("internal/") now precedes the
        // match -- the same leniency that's correct for a bare *import*
        // (Rust's auth -> src/auth.rs convention, strategy 2) is NOT
        // legitimate for a bare *target* matched against a longer import
        // (strategy 1): there's no confirmed real-world case for it, and
        // it's exactly this bug's shape.
        expect(testMatchesFile('internal/fs', 'fs')).toBe(false);
        // The real relationship stays intact.
        expect(testMatchesFile('internal/fs', 'internal/fs')).toBe(true);
      });

      it('Ruby: a bare gem require must not fan out to every file under the gem directory', () => {
        // Every file under lib/sinatra/ must stop claiming a bare
        // `require 'sinatra'` as a match -- only the gem's own entry point
        // (lib/sinatra.rb) is a real match for a bare specifier.
        expect(testMatchesFile('sinatra', 'lib/sinatra/base')).toBe(false);
        expect(testMatchesFile('sinatra', 'lib/sinatra/main')).toBe(false);
        expect(testMatchesFile('sinatra', 'lib/sinatra/show_exceptions')).toBe(false);
        expect(testMatchesFile('sinatra', 'lib/sinatra/version')).toBe(false);
        // The gem's own entry point still matches.
        expect(testMatchesFile('sinatra', 'lib/sinatra')).toBe(true);
      });

      it('Swift: a bare system-framework import must not match an unrelated same-named file', () => {
        // `import Combine` (Apple's system framework) must not match
        // Source/Features/Combine.swift merely because the basenames
        // coincide.
        expect(testMatchesFile('Combine', 'Source/Features/Combine')).toBe(false);
      });
    });

    describe('legitimate bare-identifier matches stay intact', () => {
      it('keeps the single source-directory-prefix convention (Rust-style)', () => {
        // Already covered under "Rust module matching" above; restated here
        // to make the #868 guard's intent explicit: exactly one leading
        // directory segment before a bare identifier is still allowed.
        expect(testMatchesFile('auth', 'src/auth.rs')).toBe(true);
        expect(testMatchesFile('utils', 'src/utils.rs')).toBe(true);
      });

      it('keeps an exact bare-identifier match', () => {
        expect(testMatchesFile('logger', 'logger')).toBe(true);
      });

      it('keeps a relative import cleaned down to a bare identifier with a single prefix segment', () => {
        expect(testMatchesFile('./logger', 'logger')).toBe(true);
        expect(testMatchesFile('../logger', 'logger')).toBe(true);
      });

      it('#884: matchesFile itself is deliberately left unchanged for the Alamofire shape', () => {
        // `import Alamofire` vs. `Source/Alamofire.swift` sits inside the
        // exact same one-leading-segment window as the legitimate Rust
        // `auth` -> `src/auth.rs` case above -- matchesFile cannot tell them
        // apart, and #884's fix deliberately doesn't ask it to. The real fix
        // lives at the caller layer (isUnresolvableWholeModuleImport, tested
        // below), which stops wholeModuleImports-language callers from ever
        // handing this bare import to matchesFile in the first place.
        expect(testMatchesFile('Alamofire', 'Source/Alamofire')).toBe(true);
      });
    });
  });

  describe('two-segment bare require precision (#887, language-aware)', () => {
    it('Ruby (strict mode): a multi-segment bare require must not fan out to every file under its own directory', () => {
      // sinatra's bundled rack-protection: `require 'rack/protection'` must
      // match only the gem's own entry point, not every file nested under
      // rack-protection/lib/rack/protection/ -- the multi-segment shape of
      // the same #868/#883 single-segment bug (`sinatra` vs. `lib/sinatra/*`).
      // `requireExactTailForMultiSegment: true` is exactly what
      // `importMatchesTarget` derives for a `.rb` importer via
      // `hasSingleFileImportSemantics` (see below) -- passed explicitly here
      // to unit-test the matcher in isolation.
      expect(
        testMatchesFile('rack/protection', 'rack-protection/lib/rack/protection/csrf', true),
      ).toBe(false);
      expect(
        testMatchesFile('rack/protection', 'rack-protection/lib/rack/protection/base', true),
      ).toBe(false);
      // The gem's own entry point still matches.
      expect(testMatchesFile('rack/protection', 'rack-protection/lib/rack/protection', true)).toBe(
        true,
      );
    });

    it('Go (default/permissive mode): the identical multi-segment shape is a legitimate package-directory member match', () => {
      // A HIGH-severity regression caught in review: #877 normalizes
      // `import "mymodule/internal/fs"` down to the bare `internal/fs`
      // after module-prefix stripping. In Go that names a PACKAGE -- every
      // `.go` file inside the directory is a member, so `internal/fs` MUST
      // keep matching `internal/fs/fs.go` (and any other file in that
      // directory) under the default, non-strict mode real Go callers use.
      // An earlier version of this fix applied the Ruby-only anchor
      // unconditionally and broke exactly this case (67 → 9 dependent edges
      // on a real gin clone) before being caught and reworked.
      expect(testMatchesFile('internal/fs', 'internal/fs/fs.go')).toBe(true);
      expect(testMatchesFile('internal/fs', 'internal/fs/utils.go')).toBe(true);
      // Explicitly confirms the default parameter IS permissive (`false`).
      expect(testMatchesFile('internal/fs', 'internal/fs/fs.go', false)).toBe(true);
    });

    it('regression: the #868 single-segment guard is unaffected by the strict flag either way', () => {
      expect(testMatchesFile('sinatra', 'lib/sinatra')).toBe(true);
      expect(testMatchesFile('sinatra', 'lib/sinatra/base')).toBe(false);
      expect(testMatchesFile('sinatra', 'lib/sinatra', true)).toBe(true);
      expect(testMatchesFile('sinatra', 'lib/sinatra/base', true)).toBe(false);
    });

    it('regression: the Rust one-leading-segment source-prefix convention is unaffected', () => {
      expect(testMatchesFile('auth', 'src/auth.rs')).toBe(true);
    });

    it('regression: a genuine multi-segment import still matches its multi-segment target in both modes', () => {
      // Untouched by the #887 end-anchor extension -- these already reached
      // the end of the compared string before the fix, in either mode.
      expect(testMatchesFile('auth/middleware', 'src/auth/middleware.rs')).toBe(true);
      expect(testMatchesFile('auth/middleware', 'src/auth/middleware.rs', true)).toBe(true);
      expect(testMatchesFile('github.com/gin-gonic/gin/internal/fs', 'internal/fs')).toBe(true);
      expect(testMatchesFile('github.com/gin-gonic/gin/internal/fs', 'internal/fs', true)).toBe(
        true,
      );
    });
  });
});

/**
 * Test cases for the #884 caller-layer guard: bare whole-module imports
 * (Swift's `import ModuleName`) must never be handed to `matchesFile` by a
 * wholeModuleImports-language caller, because the only way such a bare
 * import can ever match a target is coincidental basename equality (the
 * Alamofire false-hub shape) -- see `isUnresolvableWholeModuleImport`'s own
 * doc comment for the full reasoning.
 */
describe('isUnresolvableWholeModuleImport (#884)', () => {
  it('suppresses the Alamofire shape: bare import == module name == target basename, 1 leading segment', () => {
    expect(isUnresolvableWholeModuleImport('Alamofire', 'Source/Alamofire.swift')).toBe(true);
    // Also true with zero leading segments (module file at the repo root).
    expect(isUnresolvableWholeModuleImport('Alamofire', 'Alamofire.swift')).toBe(true);
  });

  it('leaves the identical shape alone for a non-whole-module language (Rust auth -> src/auth.rs)', () => {
    // Same "bare identifier, one leading segment, basename match" shape as
    // Alamofire, but Rust doesn't set wholeModuleImports, so matchesFile's
    // legitimate source-directory-prefix convention must keep working --
    // this predicate must not suppress it.
    expect(isUnresolvableWholeModuleImport('auth', 'src/auth.rs')).toBe(false);
  });

  it('leaves other Swift bare imports alone that do not share the target basename', () => {
    // `import Combine` (system framework) is still a bare Swift import, but
    // the caller only ever asks this predicate about the (import, importer)
    // pair -- it doesn't take a target at all, since a wholeModuleImports
    // language's bare import is unusable for *any* target, not just a
    // basename-coincidental one (see the doc comment: matchesFile can only
    // ever win via the coincidental path for these imports, full stop).
    expect(isUnresolvableWholeModuleImport('Combine', 'Source/Features/Combine.swift')).toBe(true);
  });

  it('does not suppress a qualified/dotted or path-like Swift import', () => {
    // The guard is scoped to genuinely bare (slash-free) specifiers only --
    // a hypothetical qualified import (e.g. a submodule path containing a
    // separator) is left alone, matching #868/#883's own "only the bare-
    // identifier path" scope discipline.
    expect(isUnresolvableWholeModuleImport('Alamofire/Session', 'Source/Alamofire.swift')).toBe(
      false,
    );
  });

  it('does not suppress bare imports from non-Swift, non-whole-module files', () => {
    expect(isUnresolvableWholeModuleImport('logger', 'src/logger.ts')).toBe(false);
  });
});

/**
 * Test cases for the #886 consolidated primitive: `importMatchesTarget`
 * couples `isUnresolvableWholeModuleImport`'s guard to `matchesFile` so a
 * match-side caller can never invoke one without the other.
 */
describe('importMatchesTarget (#886)', () => {
  const normalize = (p: string): string => normalizePath(p, '/fake/workspace');

  it('matches like matchesFile would, for a non-whole-module language', () => {
    expect(importMatchesTarget('./logger', 'src/foo.ts', normalize('src/logger'), normalize)).toBe(
      true,
    );
    expect(
      importMatchesTarget('src/database.ts', 'src/foo.ts', normalize('src/logger.ts'), normalize),
    ).toBe(false);
  });

  it('suppresses the #884 Alamofire whole-module false-hub shape that matchesFile alone would match', () => {
    // matchesFile itself still matches this pair (#884's own regression pin) --
    // the guard is what makes the combined primitive reject it.
    expect(matchesFile(normalize('Alamofire'), normalize('Source/Alamofire.swift'))).toBe(true);
    expect(
      importMatchesTarget(
        'Alamofire',
        'Source/AlamofireTests.swift',
        normalize('Source/Alamofire.swift'),
        normalize,
      ),
    ).toBe(false);
  });

  it('leaves the identical bare-identifier shape alone for a non-whole-module language (Rust)', () => {
    expect(
      importMatchesTarget('auth', 'src/consumer.rs', normalize('src/auth.rs'), normalize),
    ).toBe(true);
  });

  it('rejects a real per-file relationship guarded by the whole-module language, not the pair', () => {
    // Swift's SwiftImportExtractor never emits anything but the bare module
    // name, so even a genuine same-file relationship reads as "not
    // determinable" rather than a match -- this is the same honest #869
    // outcome isUnresolvableWholeModuleImport documents, just reached through
    // the combined primitive instead of the open-coded pattern.
    expect(
      importMatchesTarget('Combine', 'Tests/CombineTests.swift', normalize('Combine'), normalize),
    ).toBe(false);
  });

  describe('#887 language-aware routing', () => {
    it('Ruby importer: rejects the rack/protection child-file fan-out, keeps the entry point', () => {
      const importerFile = 'rack-protection/spec/spec_helper.rb';
      expect(
        importMatchesTarget(
          'rack/protection',
          importerFile,
          normalize('rack-protection/lib/rack/protection/xss_header'),
          normalize,
        ),
      ).toBe(false);
      expect(
        importMatchesTarget(
          'rack/protection',
          importerFile,
          normalize('rack-protection/lib/rack/protection'),
          normalize,
        ),
      ).toBe(true);
    });

    it('Go importer: keeps matching every file inside its package directory (the caught regression)', () => {
      // The reviewer's proven-failing shape at an earlier revision of this
      // fix: a language-unaware unconditional end-anchor made this return
      // false, reversing #877 on a real gin clone (67 -> 9 dependent edges).
      const importerFile = 'render/html.go';
      expect(
        importMatchesTarget('internal/fs', importerFile, normalize('internal/fs/fs.go'), normalize),
      ).toBe(true);
      expect(
        importMatchesTarget(
          'internal/fs',
          importerFile,
          normalize('internal/fs/utils.go'),
          normalize,
        ),
      ).toBe(true);
    });
  });
});

describe('hasSingleFileImportSemantics (#887)', () => {
  it('is true for a Ruby importer file', () => {
    expect(hasSingleFileImportSemantics('rack-protection/lib/rack/protection/base.rb')).toBe(true);
  });

  it('is false for a Go importer file', () => {
    expect(hasSingleFileImportSemantics('render/html.go')).toBe(false);
  });

  it('is false for an importer file in an unrecognized/undetectable language', () => {
    expect(hasSingleFileImportSemantics('README.md')).toBe(false);
  });
});

/**
 * Test cases for test file detection.
 *
 * Bug: Simple string matching produced false positives:
 * - "contest.ts" matched ".test." ❌
 * - "latest/config.ts" matched "/test/" ❌
 * - "protest.ts" matched ".test." ❌
 *
 * Fix: Use precise regex patterns
 */
describe('isTestFile - Precise Test Detection', () => {
  describe('should correctly identify test files', () => {
    it('should match .test. files', () => {
      expect(isTestFile('src/auth.test.ts')).toBe(true);
      expect(isTestFile('components/Button.test.tsx')).toBe(true);
      expect(isTestFile('utils/validator.test.js')).toBe(true);
    });

    it('should match .spec. files', () => {
      expect(isTestFile('src/auth.spec.ts')).toBe(true);
      expect(isTestFile('e2e/login.spec.js')).toBe(true);
      expect(isTestFile('components/Button.spec.tsx')).toBe(true);
    });

    it('should match files in test/ directories', () => {
      expect(isTestFile('test/auth.ts')).toBe(true);
      expect(isTestFile('src/test/helper.ts')).toBe(true);
      expect(isTestFile('packages/cli/test/fixtures.ts')).toBe(true);
    });

    it('should match files in tests/ directories', () => {
      expect(isTestFile('tests/auth.ts')).toBe(true);
      expect(isTestFile('src/tests/helper.ts')).toBe(true);
    });

    it('should match files in __tests__/ directories', () => {
      expect(isTestFile('__tests__/auth.ts')).toBe(true);
      expect(isTestFile('src/__tests__/helper.ts')).toBe(true);
    });

    it('should match Windows paths', () => {
      expect(isTestFile('src\\auth.test.ts')).toBe(true);
      expect(isTestFile('test\\helper.ts')).toBe(true);
      expect(isTestFile('src\\__tests__\\utils.ts')).toBe(true);
    });
  });

  describe('should NOT match false positives (the bug)', () => {
    it('should NOT match files with "test" in the name', () => {
      expect(isTestFile('contest.ts')).toBe(false);
      expect(isTestFile('manifest.json')).toBe(false);
      expect(isTestFile('attest.js')).toBe(false);
      expect(isTestFile('protest-handler.ts')).toBe(false);
    });

    it('should NOT match directories with "test" in the path', () => {
      expect(isTestFile('latest/config.ts')).toBe(false);
      expect(isTestFile('greatest/helper.js')).toBe(false);
      expect(isTestFile('fastest-route/index.ts')).toBe(false);
    });

    it('should NOT match files where test is not a path component', () => {
      expect(isTestFile('mytest.ts')).toBe(false);
      expect(isTestFile('testing.js')).toBe(false);
      expect(isTestFile('testimonial.tsx')).toBe(false);
    });

    it('should NOT match regular source files', () => {
      expect(isTestFile('src/auth.ts')).toBe(false);
      expect(isTestFile('components/Button.tsx')).toBe(false);
      expect(isTestFile('utils/validator.js')).toBe(false);
      expect(isTestFile('index.ts')).toBe(false);
    });
  });

  describe('suffix and directory conventions (_spec/_test, spec/)', () => {
    it('should match _spec. and _test. suffix files (Ruby/Go conventions)', () => {
      expect(isTestFile('models/user_spec.rb')).toBe(true);
      expect(isTestFile('lib/calculator_test.rb')).toBe(true);
      expect(isTestFile('pkg/math_test.go')).toBe(true);
    });

    it('should match files in spec/ and specs/ directories', () => {
      expect(isTestFile('spec/models/user_spec.rb')).toBe(true);
      expect(isTestFile('app/specs/helper.rb')).toBe(true);
    });

    it('should not treat _spec/_test lookalikes as tests', () => {
      // No `_` boundary before test/spec
      expect(isTestFile('mytest.rb')).toBe(false);
      expect(isTestFile('respec/config.rb')).toBe(false);
      expect(isTestFile('spec.rb')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle files at root level', () => {
      expect(isTestFile('auth.test.ts')).toBe(true);
      expect(isTestFile('auth.ts')).toBe(false);
    });

    it('should handle deeply nested test files', () => {
      expect(isTestFile('packages/cli/src/mcp/tools.test.ts')).toBe(true);
      expect(isTestFile('a/b/c/d/e/test/helper.ts')).toBe(true);
    });

    it('should handle mixed separators', () => {
      expect(isTestFile('src/test\\helper.ts')).toBe(true);
      expect(isTestFile('src\\auth.test.ts')).toBe(true);
    });
  });

  describe('.NET conventions (glued Tests suffix, .cs-scoped)', () => {
    it('should match a directory segment ending in Tests', () => {
      expect(isTestFile('src/UnitTests/ConfigurationFeatureTest.cs')).toBe(true);
      expect(isTestFile('src/IntegrationTests/SomeFeature.cs')).toBe(true);
      expect(isTestFile('src/AutoMapper.DI.Tests/ContainerTests.cs')).toBe(true);
    });

    it('should match a filename ending in Test.cs or Tests.cs', () => {
      expect(isTestFile('src/UnitTests/ScopeTests.cs')).toBe(true);
      expect(isTestFile('src/UnitTests/ConfigurationFeatureTest.cs')).toBe(true);
      expect(isTestFile('FooTest.cs')).toBe(true);
      expect(isTestFile('FooTests.cs')).toBe(true);
    });

    it('should handle Windows paths for the directory convention', () => {
      expect(isTestFile('src\\UnitTests\\ConfigurationFeatureTest.cs')).toBe(true);
    });

    it('should NOT match lowercase test/contest lookalikes (case-sensitive guard)', () => {
      expect(isTestFile('src/AutoMapper/Latest.cs')).toBe(false);
      expect(isTestFile('src/AutoMapper/Contest.cs')).toBe(false);
      expect(isTestFile('latest/Config.cs')).toBe(false);
      expect(isTestFile('contest/Config.cs')).toBe(false);
    });

    it('should NOT affect non-.cs files with a glued Tests suffix', () => {
      expect(isTestFile('FooTests.ts')).toBe(false);
      expect(isTestFile('src/UnitTests/Helper.ts')).toBe(false);
    });

    it('should NOT match regular .cs source files', () => {
      expect(isTestFile('src/AutoMapper/Mapper.cs')).toBe(false);
      expect(isTestFile('src/AutoMapper/TypeMap.cs')).toBe(false);
    });
  });
});

describe('resolveRelativeImport', () => {
  it('resolves ./ against the importer directory', () => {
    expect(resolveRelativeImport('packages/parser/src/chunker.ts', './symbols')).toBe(
      'packages/parser/src/symbols',
    );
  });

  it('resolves ../ and collapses segments', () => {
    expect(resolveRelativeImport('packages/parser/src/ast/chunker.ts', '../utils/helpers')).toBe(
      'packages/parser/src/utils/helpers',
    );
  });

  it('resolves extensions through as-is (normalization happens later)', () => {
    expect(resolveRelativeImport('packages/parser/src/foo.ts', './bar.js')).toBe(
      'packages/parser/src/bar.js',
    );
  });

  it('handles absolute importer paths', () => {
    expect(resolveRelativeImport('/abs/repo/packages/a/src/x.ts', './y')).toBe(
      '/abs/repo/packages/a/src/y',
    );
  });

  it('normalizes Windows-style separators in the importer', () => {
    expect(resolveRelativeImport('packages\\parser\\src\\chunker.ts', './foo')).toBe(
      'packages/parser/src/foo',
    );
  });

  it('passes package specifiers through unchanged', () => {
    expect(resolveRelativeImport('packages/x/src/a.ts', '@liendev/core')).toBe('@liendev/core');
    expect(resolveRelativeImport('packages/x/src/a.ts', 'lodash')).toBe('lodash');
  });

  it('passes absolute specifiers through unchanged', () => {
    expect(resolveRelativeImport('packages/x/src/a.ts', '/abs/path')).toBe('/abs/path');
  });

  it('passes dotted Python-style imports through unchanged', () => {
    // `.module` does not start with `./` — Python relative imports are out of scope.
    expect(resolveRelativeImport('packages/x/src/a.py', '.module')).toBe('.module');
    expect(resolveRelativeImport('packages/x/src/a.py', '..pkg.thing')).toBe('..pkg.thing');
  });

  it('lets specifiers that escape the workspace stay as relative paths', () => {
    // Importer is 3 segments deep; the specifier climbs 4 levels out. The
    // resolver collapses what it can and keeps a leading `..` — downstream
    // matchesFile then treats it as a boundary-matched path without producing
    // false positives for unrelated in-workspace files.
    expect(resolveRelativeImport('packages/a/src/x.ts', '../../../../outside/thing')).toBe(
      '../outside/thing',
    );
  });

  it('prevents cross-package basename collisions (#525)', () => {
    // The scenario that motivated this fix: two files share a basename in different
    // packages. After resolution, their specifiers are distinct workspace-relative
    // paths — matchesFile no longer conflates them.
    const aResolved = resolveRelativeImport(
      'packages/cli/src/mcp/handlers/foo.ts',
      './dependency-analyzer',
    );
    const bResolved = resolveRelativeImport('packages/parser/src/bar.ts', './dependency-analyzer');
    expect(aResolved).toBe('packages/cli/src/mcp/handlers/dependency-analyzer');
    expect(bResolved).toBe('packages/parser/src/dependency-analyzer');
    expect(aResolved).not.toBe(bResolved);
  });
});

describe('resolveWorkspaceImport', () => {
  const workspacePackages = new Map([
    ['@liendev/parser', 'packages/parser/src/index.ts'],
    ['@liendev/core', 'packages/core/src/index.ts'],
  ]);

  it('resolves a bare specifier that matches a known workspace package', () => {
    expect(resolveWorkspaceImport('@liendev/parser', workspacePackages)).toBe(
      'packages/parser/src/index.ts',
    );
  });

  it('leaves external (non-workspace) package specifiers untouched', () => {
    expect(resolveWorkspaceImport('lodash', workspacePackages)).toBe('lodash');
    expect(resolveWorkspaceImport('react', workspacePackages)).toBe('react');
  });

  it('leaves an empty map (non-monorepo project) fully unaffected', () => {
    const empty = new Map<string, string>();
    expect(resolveWorkspaceImport('@liendev/parser', empty)).toBe('@liendev/parser');
    expect(resolveWorkspaceImport('./relative/path', empty)).toBe('./relative/path');
  });

  it('does not resolve deep/subpath imports into a workspace package (v1 scope)', () => {
    // Only the bare specifier is a map key; a subpath is a different string
    // and deliberately passes through unresolved.
    expect(resolveWorkspaceImport('@liendev/parser/dist/index', workspacePackages)).toBe(
      '@liendev/parser/dist/index',
    );
  });

  it('leaves already-relative-resolved specifiers untouched', () => {
    expect(resolveWorkspaceImport('packages/parser/src/foo', workspacePackages)).toBe(
      'packages/parser/src/foo',
    );
  });
});

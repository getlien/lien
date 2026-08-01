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
  hasPythonModuleSemantics,
} from './path-matching.js';
import { markRustModSpecifier } from './rust-mod-marker.js';

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

  describe('bare Python package import matching (#901)', () => {
    it('should match a bare package import to its own __init__.py', () => {
      // `import flask` (flat layout, no src/ prefix) -> flask/__init__.py
      expect(testMatchesFile('flask', 'flask/__init__.py')).toBe(true);
    });

    it('should match a bare package import to a direct module file', () => {
      expect(testMatchesFile('flask', 'flask.py')).toBe(true);
    });

    it('should match a bare package import to any child module (parent-package match)', () => {
      // `import flask` executes flask/__init__.py, which (for a barrel-style
      // package like Flask) eagerly imports its submodules -- so a bare
      // import genuinely reaches any file under the package, exactly like
      // the existing dotted "django.http" -> django/http/*.py behavior above.
      expect(testMatchesFile('flask', 'flask/app.py')).toBe(true);
      expect(testMatchesFile('flask', 'flask/blueprints.py')).toBe(true);
      expect(testMatchesFile('flask', 'flask/sansio/app.py')).toBe(true);
    });

    it('should NOT match a bare package import to an unrelated similarly-named sibling', () => {
      // A bare identifier is the highest false-positive-risk shape (#883):
      // "flask" must not spuriously match "flaskext" merely because the
      // string "flask" is a textual prefix of it.
      expect(testMatchesFile('flask', 'flaskext/app.py')).toBe(false);
      expect(testMatchesFile('flask', 'flask_sqlalchemy/app.py')).toBe(false);
    });

    it('should NOT match a bare package import nested arbitrarily deep elsewhere in the repo', () => {
      // Bare identifiers deliberately skip the suffix/source-prefix strategies
      // (matchesSuffixPythonModule/matchesWithSourcePrefix) that the dotted,
      // multi-segment case above relies on. matchesSuffixPythonModule IS
      // properly boundary-checked (its `endsWith('/' + moduleAsPath)` anchors
      // to a leading `/` and the end of the string) but places no cap at all
      // on how many directories may precede that match -- this repro's
      // "flask" nested under vendor/some/deep/ would otherwise match.
      // matchesWithSourcePrefix caps the leading side to at most one
      // directory and, since #918, anchors its right edge too, so the
      // "flask" vs "flaskext" textual-prefix hazard this comment used to
      // describe (see the previous test) no longer applies to it even
      // hypothetically. It still stays excluded from the bare-word branch
      // regardless: matchesSuffixPythonModule's uncapped leading side above
      // is reason enough on its own, and #883's precedent is to not widen
      // leniency for a short bare identifier without a confirmed real-world
      // case.
      expect(testMatchesFile('flask', 'vendor/some/deep/flask/app.py')).toBe(false);
    });

    it('should still require dotted imports to use the full strategy set (no regression)', () => {
      // Multi-segment dotted specifiers keep tolerating a single leading
      // "src/"-style directory via matchesWithSourcePrefix, same as before.
      expect(testMatchesFile('flask.json.tag', 'src/flask/json/tag.py')).toBe(true);
    });

    it('should match an already-resolved src-layout path via the generic boundary strategies', () => {
      // Once `resolvePythonSrcLayoutImport` (python-src-layout.ts) prepends
      // the detected src/ root, the specifier is a plain slash-path and no
      // longer reaches matchesPythonModule at all (it contains '/') -- the
      // existing language-agnostic boundary strategies handle it directly.
      expect(testMatchesFile('src/flask', 'src/flask/__init__.py')).toBe(true);
      expect(testMatchesFile('src/flask', 'src/flask/app.py')).toBe(true);
      expect(testMatchesFile('src/flask', 'src/flask/sansio/blueprints.py')).toBe(true);
      expect(testMatchesFile('src/flask', 'src/flaskext/app.py')).toBe(false);
    });
  });

  describe('matchesWithSourcePrefix right-edge anchoring (#918)', () => {
    describe('repro canaries: a candidate must not match as a bare textual prefix', () => {
      it('Utils vs UtilsHelper (the reported shape)', () => {
        expect(testMatchesFile('com.example.Utils', 'com/example/UtilsHelper')).toBe(false);
      });

      it('Op vs OpChain', () => {
        expect(testMatchesFile('com.example.Op', 'com/example/OpChain')).toBe(false);
      });

      it('Json vs JsonWriter', () => {
        expect(testMatchesFile('org.example.Json', 'org/example/JsonWriter')).toBe(false);
      });

      it('still rejects the same shape with the single "src/"-style leading directory matchesWithSourcePrefix allows', () => {
        // Confirms the fix is a right-edge check, not an accidental
        // over-tightening of the left-edge (leading-segment) allowance.
        expect(testMatchesFile('com.example.Utils', 'src/com/example/UtilsHelper')).toBe(false);
      });
    });

    describe('legitimate matches survive', () => {
      it('exact dotted module name to its own file', () => {
        expect(testMatchesFile('com.example.Utils', 'com/example/Utils.kt')).toBe(true);
      });

      it('dotted Python module to a real file one directory below a "src/"-style prefix', () => {
        expect(testMatchesFile('django.http', 'src/django/http/response.py')).toBe(true);
      });

      it('candidate immediately followed by an extension boundary rather than a path separator', () => {
        // `.min` is not one of getSupportedExtensions()'s AST-supported
        // extensions, so normalizePath's generic extension strip leaves it
        // in place -- this exercises the '.' branch of the right-edge check
        // directly, independent of any language's own extension-stripping.
        expect(testMatchesFile('com.example.Utils', 'src/com/example/Utils.min')).toBe(true);
      });
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

  describe('#929 Python-bare-module guard', () => {
    // The real hono/TypeScript repro: `src/utils/jwt/jwt.test.ts` directly
    // imports `./jws`, but `annotate`'s "Test coverage" line omitted it and
    // instead listed several unrelated test files -- every one of which
    // imports the package's own root barrel (`import { Hono } from '../..'`,
    // which resolves to the bare specifier `src`). `matchesFile`'s Strategy 5
    // (`matchesPythonModule`) treated that bare `src` as a Python package
    // import covering every file nested under `src/`, fabricating a match
    // against `src/utils/jwt/jws` for a test with no real relationship to it.
    const normalizedJws = normalize('src/utils/jwt/jws.ts');

    it('matchesFile alone still matches the bare-barrel pair (this function stays permissive by default)', () => {
      expect(matchesFile('src', normalizedJws)).toBe(true);
    });

    it('suppresses the bare-barrel false hub for a non-Python (TypeScript) importer', () => {
      expect(
        importMatchesTarget('src', 'src/adapter/deno/websocket.test.ts', normalizedJws, normalize),
      ).toBe(false);
    });

    it('leaves genuine Python bare-package matching alone for an actual Python importer', () => {
      expect(
        importMatchesTarget(
          'flask',
          'flask/tests/test_app.py',
          normalize('flask/app.py'),
          normalize,
        ),
      ).toBe(true);
    });
  });

  describe('#1021 Rust mod-derived single-file guard', () => {
    // Reproduces issue #1021's two fixtures directly against `importMatchesTarget`
    // -- the same primitive `findDependentChunks`'s fuzzy loop calls per
    // (chunk, rawSpecifier) entry, so this is the exact decision `get_dependents`
    // makes for each candidate dependent.

    it('fixture 1 (fabricated descendant edges): `mod thing;` in main.rs matches ONLY the real mod.rs sibling, never an undeclared/unrelated child', () => {
      const mainImportsThing = markRustModSpecifier('src/thing');
      const importerFile = 'src/main.rs';

      // src/thing/mod.rs -- real: mod.rs is the module's own file (`x/mod.rs`
      // convention).
      expect(
        importMatchesTarget(
          mainImportsThing,
          importerFile,
          normalize('src/thing/mod.rs'),
          normalize,
        ),
      ).toBe(true);

      // src/thing/sibling.rs -- FABRICATED before #1021: only reachable via
      // mod.rs's own `pub mod sibling;`, never via main.rs's `mod thing;`.
      expect(
        importMatchesTarget(
          mainImportsThing,
          importerFile,
          normalize('src/thing/sibling.rs'),
          normalize,
        ),
      ).toBe(false);

      // src/thing/undeclared.rs -- FABRICATED before #1021: nothing declares
      // `mod undeclared;` anywhere.
      expect(
        importMatchesTarget(
          mainImportsThing,
          importerFile,
          normalize('src/thing/undeclared.rs'),
          normalize,
        ),
      ).toBe(false);
    });

    it("fixture 1: mod.rs's `pub mod sibling;` still matches sibling.rs exactly (the real edge)", () => {
      expect(
        importMatchesTarget(
          markRustModSpecifier('src/thing/sibling'),
          'src/thing/mod.rs',
          normalize('src/thing/sibling.rs'),
          normalize,
        ),
      ).toBe(true);
    });

    it("fixture 2 (fabricated self-edges): a leaf file's own `mod helpers;` never matches the leaf file itself", () => {
      // src/engine.rs contains `mod helpers;` -> resolves to
      // src/engine/helpers (owning subdirectory named after the leaf file).
      // Computing get_dependents('src/engine.rs') must not fabricate a
      // self-edge from this.
      expect(
        importMatchesTarget(
          markRustModSpecifier('src/engine/helpers'),
          'src/engine.rs',
          normalize('src/engine.rs'),
          normalize,
        ),
      ).toBe(false);
    });

    it("fixture 2: lib.rs's `pub mod engine;` never matches engine/helpers.rs (only engine.rs does)", () => {
      // src/lib.rs contains `pub mod engine;` -> resolves to src/engine.
      // This must match engine.rs itself, but must NOT also match the
      // unrelated grandchild engine/helpers.rs.
      const libImportsEngine = markRustModSpecifier('src/engine');
      expect(
        importMatchesTarget(libImportsEngine, 'src/lib.rs', normalize('src/engine.rs'), normalize),
      ).toBe(true);
      expect(
        importMatchesTarget(
          libImportsEngine,
          'src/lib.rs',
          normalize('src/engine/helpers.rs'),
          normalize,
        ),
      ).toBe(false);
    });

    it("fixture 2: engine.rs's own `mod helpers;` still matches engine/helpers.rs exactly (the real edge)", () => {
      expect(
        importMatchesTarget(
          markRustModSpecifier('src/engine/helpers'),
          'src/engine.rs',
          normalize('src/engine/helpers.rs'),
          normalize,
        ),
      ).toBe(true);
    });

    it('leaves an UNMARKED Rust specifier on the identical string value fully permissive, unaffected by the marker guard', () => {
      // Same specifier value as fixture 1 ("src/thing"), but WITHOUT the
      // #1021 marker -- as if some hypothetical `use`-derived path had
      // resolved to this exact anchored string. Must keep matchesFile's
      // existing (package-directory-style) leniency exactly as before this
      // fix: the marker guard only ever narrows behavior for specifiers that
      // carry it, never for ones that don't.
      expect(
        importMatchesTarget(
          'src/thing',
          'src/main.rs',
          normalize('src/thing/sibling.rs'),
          normalize,
        ),
      ).toBe(true);
    });
  });
});

describe('hasPythonModuleSemantics (#929)', () => {
  it('is true for a Python importer file', () => {
    expect(hasPythonModuleSemantics('flask/tests/test_app.py')).toBe(true);
  });

  it('is false for a TypeScript importer file', () => {
    expect(hasPythonModuleSemantics('src/adapter/deno/websocket.test.ts')).toBe(false);
  });

  it('is false for an importer file in an unrecognized/undetectable language', () => {
    expect(hasPythonModuleSemantics('README.md')).toBe(false);
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

  describe('capitalized Tests/ directory convention, any language (#925)', () => {
    it('matches an exact "Tests" directory segment regardless of case (symfony/console repro)', () => {
      expect(isTestFile('Tests/Command/CommandTest.php')).toBe(true);
      expect(isTestFile('Tests/ArgumentResolver/ValueResolver/UidValueResolverTest.php')).toBe(
        true,
      );
    });

    it('matches an exact "Test"/"Spec"/"Specs" directory segment in any case', () => {
      expect(isTestFile('Test/helper.py')).toBe(true);
      expect(isTestFile('Spec/models/user.rb')).toBe(true);
      expect(isTestFile('Specs/models/user.rb')).toBe(true);
    });

    it('still requires an exact segment -- capitalization does not loosen the boundary guard', () => {
      expect(isTestFile('Latest/config.ts')).toBe(false);
      expect(isTestFile('Contest/config.ts')).toBe(false);
      expect(isTestFile('Testing/helper.ts')).toBe(false);
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

  it('passes a raw (unconverted) Python-style leading-dot specifier through unchanged', () => {
    // `.module` does not start with `./` — this function only ever sees a
    // real Python relative import in its converted `./`/`../`-prefixed form
    // (see `PythonImportExtractor.convertPythonRelativeImport` in
    // `ast/languages/python.ts`, #904), never this raw grammar-node text.
    // This case documents what happens if it somehow did: a no-op, same as
    // any other specifier that doesn't start with `./`/`../`.
    expect(resolveRelativeImport('packages/x/src/a.py', '.module')).toBe('.module');
    expect(resolveRelativeImport('packages/x/src/a.py', '..pkg.thing')).toBe('..pkg.thing');
  });

  it('resolves a Python-converted relative import against the importer directory (#904)', () => {
    // `from .globals import x` in src/flask/app.py -> extractor converts to
    // "./globals" -> resolves to the sibling module.
    expect(resolveRelativeImport('src/flask/app.py', './globals')).toBe('src/flask/globals');
    // `from ..globals import x` in src/flask/sansio/app.py -> "../globals".
    expect(resolveRelativeImport('src/flask/sansio/app.py', '../globals')).toBe(
      'src/flask/globals',
    );
  });

  it('strips a trailing slash left by a bare-dots relative import (#904)', () => {
    // `from . import x` in src/flask/json/__init__.py -> extractor converts
    // to "./" (empty remainder) -> path.posix.join/normalize would otherwise
    // leave a trailing slash that can never boundary-match a target path.
    expect(resolveRelativeImport('src/flask/json/__init__.py', './')).toBe('src/flask/json');
    // `from .. import x` in src/flask/sansio/foo.py -> "../".
    expect(resolveRelativeImport('src/flask/sansio/foo.py', '../')).toBe('src/flask');
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

  it('resolves a bare same-directory self-import (#935)', () => {
    // `import { x } from '.'` in JS/TS — the extractor stores the raw source
    // text verbatim (unlike Python, which converts its own bare-dot form to
    // "./" before this function ever runs), so a literal "." must resolve the
    // same way "./" already does: to the importer's own directory, with
    // nothing joined after it.
    expect(resolveRelativeImport('src/middleware/jsx-renderer/index.test.tsx', '.')).toBe(
      'src/middleware/jsx-renderer',
    );
  });

  it('resolves a bare parent-directory self-import (#935)', () => {
    expect(resolveRelativeImport('src/middleware/jsx-renderer/nested/foo.ts', '..')).toBe(
      'src/middleware/jsx-renderer',
    );
  });

  it('matches the real hono repro end-to-end via matchesFile (#935)', () => {
    // src/middleware/jsx-renderer/index.test.tsx: `import { jsxRenderer } from '.'`
    // must associate with src/middleware/jsx-renderer/index.ts.
    const resolved = resolveRelativeImport('src/middleware/jsx-renderer/index.test.tsx', '.');
    expect(matchesFile(resolved, 'src/middleware/jsx-renderer/index')).toBe(true);
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

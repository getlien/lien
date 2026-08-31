/**
 * Completeness guard: every signal module has tests SOMEWHERE.
 *
 * Parser's vitest config is `include: ['src/**\/*.test.ts']` — strictly
 * co-located — and this directory currently has almost none, because the 14
 * signal modules' 945 test-blocks still live in `packages/review/test/`. So
 * `npm run test -w @liendev/parser`, the fast inner loop CLAUDE.md prescribes,
 * exercises nearly none of this directory's ~9,200 LOC and reports green
 * regardless. Green-because-nothing-ran and green-because-it-passed are the
 * same shape unless something checks which one it is; that is this file.
 *
 * It accepts EITHER location, so it passes today and keeps passing after the
 * follow-up relocates those tests here. What it will not let happen is the
 * case that actually loses coverage: `packages/review` being deleted (it is
 * slated for deletion) while its signal tests are still the only ones there
 * are. That fails here, loudly, naming the modules left uncovered — instead of
 * a test suite that quietly gets smaller. As of this writing 14 of the 16
 * modules pass only via the `packages/review/test` branch, so a deletion
 * flips all 14 at once.
 *
 * Two limits, deliberately not fixed:
 *  - It asserts a test FILE EXISTS, not that the file tests anything. An empty
 *    one, or one that is entirely `it.skip`, satisfies it. That is adequate for
 *    the deletion case this targets; it is not a coverage guarantee, and should
 *    not be read as one.
 *  - It reads `../../../review/test`, outside its own package. Parser's tests
 *    only ever run from the monorepo, so this is theoretical — but a standalone
 *    `packages/parser` checkout fails this guard for the same reason a deletion
 *    does, and with the same message.
 *
 * On why those tests import across the package boundary: they reach these
 * modules' internals by relative path (`../../parser/src/signals/…`) rather than
 * through `@liendev/parser`, deliberately. Most of the directory's exports have
 * no consumer outside their own module, and parser is a PUBLISHED package — a
 * barrel wide enough for the tests would semver-lock ~70 internals and make
 * narrowing it later a breaking change. So the tests take the internals by a
 * path that never touches the public surface. That is a stopgap, not a home:
 * moving these tests into this directory removes the cross-package import
 * entirely, and is the follow-up this guard exists to protect.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, not `new URL(...).pathname` — the latter keeps a leading
// slash on Windows drive paths (`/C:/…`) and never percent-decodes, so a
// checkout in a directory with a space in its name would resolve to nowhere.
// Both failure modes make every `existsSync` below false, which would fail
// this guard spuriously on someone else's machine — a false alarm, which is
// the one thing a guard must never be.
const SIGNALS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_TEST_DIR = path.resolve(SIGNALS_DIR, '../../../review/test');

/**
 * Modules with no runtime behaviour to test — the one way a module can lack
 * tests without failing the guard.
 *
 * "Keep it tiny and justified" is not enough on its own: adding a name here is
 * otherwise indistinguishable from writing a test, which makes this the guard's
 * own escape hatch. The `TYPE_ONLY entries really have no runtime export` case
 * below checks the justification, so an exemption that isn't true fails.
 */
const TYPE_ONLY = new Set([
  // Interfaces only; every declaration is erased at compile time.
  'signal-context.ts',
]);

/** Matches a runtime (non-erased) export declaration. */
const RUNTIME_EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|var|class|enum)\s/m;

function signalModules(): string[] {
  // `recursive: true` matters: a plain readdir drops directory entries at the
  // `.ts` filter, so a module in a subdirectory would be invisible and the
  // guard would pass having silently skipped it. Paths come back relative to
  // SIGNALS_DIR (`nested/deep-signals.ts`), which the joins below handle.
  return fs
    .readdirSync(SIGNALS_DIR, { recursive: true })
    .map(entry => String(entry))
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !TYPE_ONLY.has(f))
    .sort();
}

describe('signal module test coverage', () => {
  it('finds at least one signal module to check (the guard itself is not vacuous)', () => {
    expect(signalModules().length).toBeGreaterThan(10);
  });

  it('every TYPE_ONLY entry really has no runtime export', () => {
    const violations = [...TYPE_ONLY].filter(f =>
      RUNTIME_EXPORT_RE.test(fs.readFileSync(path.join(SIGNALS_DIR, f), 'utf8')),
    );

    expect(
      violations,
      'A TYPE_ONLY module exports runtime behaviour, so it needs real tests rather ' +
        'than an exemption. Remove it from TYPE_ONLY and add a test file.',
    ).toEqual([]);
  });

  it('every signal module has a test file, co-located here or still in packages/review/test', () => {
    const uncovered = signalModules().filter(mod => {
      const testName = mod.replace(/\.ts$/, '.test.ts');
      const coLocated = fs.existsSync(path.join(SIGNALS_DIR, testName));
      const inReview = fs.existsSync(path.join(REVIEW_TEST_DIR, testName));
      return !coLocated && !inReview;
    });

    expect(
      uncovered,
      `These signal modules have no test file in either location. If packages/review ` +
        `was just deleted, its signal tests must move to packages/parser/src/signals/ ` +
        `first — they are the only tests these modules have.`,
    ).toEqual([]);
  });
});

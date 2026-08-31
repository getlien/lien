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
 * Modules with no runtime behaviour to test. Keep this list tiny and justified
 * — it is the one way a module can be missing tests without failing the guard.
 */
const TYPE_ONLY = new Set([
  // Interfaces only; every declaration is erased at compile time.
  'signal-context.ts',
]);

function signalModules(): string[] {
  return fs
    .readdirSync(SIGNALS_DIR)
    .filter(
      f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts' && !TYPE_ONLY.has(f),
    )
    .sort();
}

describe('signal module test coverage', () => {
  it('finds at least one signal module to check (the guard itself is not vacuous)', () => {
    expect(signalModules().length).toBeGreaterThan(10);
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

/**
 * Completeness guard: every signal module has a co-located test file.
 *
 * Parser's vitest config is `include: ['src/**\/*.test.ts']` — strictly
 * co-located — so a test that lives anywhere else does not run. For a while
 * this directory had almost no tests, because the 14 signal modules'
 * test-blocks lived in `packages/review/test/`. `npm run test -w
 * @liendev/parser` therefore exercised nearly none of this directory's ~9,200
 * LOC and reported green regardless. Green-because-nothing-ran and
 * green-because-it-passed are the same shape unless something checks which one
 * it is; that is this file.
 *
 * **Both halves of that history have now happened.** The tests moved here
 * (parser 2,030 → 2,520; the 12 `buildInitialMessage` prompt-injection blocks
 * were dropped, since they tested the review engine's rendering rather than the
 * signals), and then `packages/review` was deleted. This guard existed
 * specifically to make the second impossible before the first, and it did its
 * job: it is why the relocation shipped as its own PR.
 *
 * It used to accept EITHER location. That branch is gone, because the other
 * location is gone — and an `fs.existsSync` against a deleted directory is not
 * a neutral leftover, it is a hole: recreate `packages/review/test/` for any
 * reason and a signal module with no co-located test would pass. Co-located is
 * now the only place a test can be, so it is the only place this looks.
 *
 * One limit, deliberately not fixed: it asserts a test FILE EXISTS, not that
 * the file tests anything. An empty one, or one that is entirely `it.skip`,
 * satisfies it. That was adequate for the deletion this targeted; it is not a
 * coverage guarantee and should not be read as one.
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

  it('every signal module has a co-located test file', () => {
    const uncovered = signalModules().filter(
      mod => !fs.existsSync(path.join(SIGNALS_DIR, mod.replace(/\.ts$/, '.test.ts'))),
    );

    expect(
      uncovered,
      `These signal modules have no test file. Each is production code in a published ` +
        `package and drives \`lien review\`, so add \`<module>.test.ts\` beside it — ` +
        `parser's vitest config only collects \`src/**/*.test.ts\`, so a test anywhere ` +
        `else does not run.`,
    ).toEqual([]);
  });
});
